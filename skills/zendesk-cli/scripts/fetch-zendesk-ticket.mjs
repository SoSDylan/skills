#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const CONFIG_PATH = ".agents/zendesk.local.json";
const MAX_NON_MEDIA_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const API_TIMEOUT_MS = 30_000;
const ATTACHMENT_TIMEOUT_MS = 120_000;
const IMAGE_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg",
  ".jpg", ".png", ".svg", ".tif", ".tiff", ".webp",
]);
const VIDEO_EXTENSIONS = new Set([
  ".3g2", ".3gp", ".avi", ".m2ts", ".m4v", ".mkv", ".mov",
  ".mp4", ".mpeg", ".mpg", ".mts", ".ogv", ".ts", ".webm",
]);

function output(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

function fail(code, message) {
  output({ ok: false, code, error: message }, 1);
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function repositoryRoot() {
  try {
    return git(["rev-parse", "--show-toplevel"], process.cwd());
  } catch {
    throw new Error("Run this command from inside the repository being investigated.");
  }
}

function validateConfig(config) {
  for (const key of ["subdomain", "email", "apiToken"]) {
    if (typeof config[key] !== "string" || config[key].trim() === "") {
      throw new Error(`Missing non-empty ${key} in ${CONFIG_PATH}.`);
    }
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(config.subdomain)) {
    throw new Error(`Invalid subdomain in ${CONFIG_PATH}.`);
  }

  return {
    subdomain: config.subdomain.trim().toLowerCase(),
    email: config.email.trim(),
    apiToken: config.apiToken,
  };
}

async function loadConfig(root) {
  const configPath = path.join(root, CONFIG_PATH);
  let contents;
  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing ${CONFIG_PATH} in the current repository.`);
    }
    throw error;
  }

  try {
    git(["ls-files", "--error-unmatch", "--", CONFIG_PATH], root);
    throw new Error(`${CONFIG_PATH} is tracked by Git. Remove it from Git before continuing.`);
  } catch (error) {
    if (error.message?.includes("is tracked by Git")) throw error;
  }

  try {
    git(["check-ignore", "--quiet", "--", CONFIG_PATH], root);
  } catch {
    throw new Error(`${CONFIG_PATH} is not ignored by Git. Add it to .gitignore before continuing.`);
  }

  try {
    return validateConfig(JSON.parse(contents));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${CONFIG_PATH} is not valid JSON.`);
    }
    throw error;
  }
}

function validateTicketId(value) {
  if (!/^\d+$/.test(value ?? "")) {
    throw new Error("Usage: fetch-zendesk-ticket.mjs <numeric-ticket-id>");
  }
  return value;
}

function safeAttachmentName(attachment) {
  const original = path.basename(attachment.file_name || "attachment");
  const safe = original.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${attachment.id}-${safe || "attachment"}`;
}

function attachmentMediaKind(attachment) {
  const contentType = String(attachment.content_type ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";

  const extension = path.extname(attachment.file_name ?? "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

function zendeskAttachmentUrl(value, subdomain) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  return host === `${subdomain}.zendesk.com` ? url : null;
}

async function downloadAttachment(attachment, directory, config, authorization) {
  const mediaKind = attachmentMediaKind(attachment);
  const size = Number(attachment.size);
  if (!mediaKind && Number.isFinite(size) && size > MAX_NON_MEDIA_ATTACHMENT_BYTES) {
    return { status: "skipped", reason: "non-media attachment exceeds 50 MB limit" };
  }

  const url = zendeskAttachmentUrl(attachment.content_url, config.subdomain);
  if (!url) return { status: "skipped", reason: "untrusted attachment URL" };

  const response = await fetch(url, {
    headers: { Authorization: authorization },
    redirect: "follow",
    signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS),
  });
  if (!response.ok) {
    return { status: "failed", reason: `HTTP ${response.status}` };
  }
  if (!response.body) return { status: "failed", reason: "empty response body" };

  const localPath = path.join(directory, safeAttachmentName(attachment));
  let bytes = 0;
  let exceededLimit = false;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.byteLength;
      if (!mediaKind && bytes > MAX_NON_MEDIA_ATTACHMENT_BYTES) {
        exceededLimit = true;
        callback(new Error("download exceeds 50 MB limit"));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      createWriteStream(localPath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await unlink(localPath).catch(() => {});
    if (exceededLimit) return { status: "skipped", reason: "non-media download exceeds 50 MB limit" };
    throw error;
  }

  return { status: "downloaded", localPath, bytes };
}

async function main() {
  const ticketId = validateTicketId(process.argv[2]);
  const root = repositoryRoot();
  const config = await loadConfig(root);
  const baseUrl = `https://${config.subdomain}.zendesk.com`;
  const authorization = `Basic ${Buffer.from(`${config.email}/token:${config.apiToken}`).toString("base64")}`;

  async function get(urlOrPath) {
    const url = new URL(urlOrPath, baseUrl);
    if (url.origin !== baseUrl) throw new Error("Zendesk pagination returned an unexpected origin.");

    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: authorization },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Zendesk request failed: HTTP ${response.status} ${response.statusText}`);
    return response.json();
  }

  const ticketData = await get(`/api/v2/tickets/${ticketId}.json`);
  const ticket = ticketData.ticket;
  if (!ticket) throw new Error("Zendesk returned no ticket data.");

  const requesterData = await get(`/api/v2/users/${ticket.requester_id}.json`);
  const comments = [];
  const users = new Map();
  if (requesterData.user) users.set(requesterData.user.id, requesterData.user);
  let nextPage = `/api/v2/tickets/${ticketId}/comments.json?include=users`;
  const visitedPages = new Set();

  while (nextPage) {
    const pageUrl = new URL(nextPage, baseUrl).toString();
    if (visitedPages.has(pageUrl)) throw new Error("Zendesk comments pagination loop detected.");
    visitedPages.add(pageUrl);

    const page = await get(pageUrl);
    comments.push(...(page.comments ?? []));
    for (const user of page.users ?? []) users.set(user.id, user);
    nextPage = page.next_page ?? page.links?.next ?? null;
  }

  const attachmentDirectory = await mkdtemp(path.join(os.tmpdir(), `zendesk-ticket-${ticketId}-`));

  const normalizedComments = [];
  for (const comment of comments) {
    const attachments = [];
    for (const attachment of comment.attachments ?? []) {
      let download;
      try {
        download = await downloadAttachment(attachment, attachmentDirectory, config, authorization);
      } catch (error) {
        download = { status: "failed", reason: error.message };
      }
      attachments.push({
        id: attachment.id,
        fileName: attachment.file_name,
        contentType: attachment.content_type,
        mediaKind: attachmentMediaKind(attachment),
        size: attachment.size,
        contentUrl: attachment.content_url,
        download,
      });
    }

    const author = users.get(comment.author_id);
    normalizedComments.push({
      id: comment.id,
      public: comment.public,
      createdAt: comment.created_at,
      body: comment.plain_body ?? comment.body,
      author: author
        ? { id: author.id, name: author.name, email: author.email, role: author.role }
        : { id: comment.author_id },
      attachments,
    });
  }

  output({
    ok: true,
    data: {
      source: {
        ticketId: ticket.id,
        ticketUrl: `${baseUrl}/agent/tickets/${ticket.id}`,
        fetchedAt: new Date().toISOString(),
        attachmentDirectory,
      },
      ticket,
      requester: requesterData.user,
      comments: normalizedComments,
    },
  });
}

main().catch((error) => fail("FETCH_FAILED", error.message));
