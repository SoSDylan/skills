#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_API_BASE_URL = "https://api.trello.com/1";
const API_TIMEOUT_MS = 30_000;
const ATTACHMENT_TIMEOUT_MS = 120_000;
const MAX_NON_MEDIA_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png",
  ".svg", ".tif", ".tiff", ".webp",
]);
const VIDEO_EXTENSIONS = new Set([
  ".3g2", ".3gp", ".avi", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4",
  ".mpeg", ".mpg", ".mts", ".ogv", ".ts", ".webm",
]);
const AUDIO_EXTENSIONS = new Set([
  ".aac", ".aiff", ".alac", ".flac", ".m4a", ".mp3", ".ogg", ".opus",
  ".wav", ".wma",
]);

function output(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

function fail(code, message) {
  output({ ok: false, code, error: message }, 1);
}

export function parseCardUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("Expected a Trello card URL such as https://trello.com/c/AbCd1234/card-name.");
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "trello.com" && host !== "www.trello.com")) {
    throw new Error("Expected an HTTPS trello.com card URL.");
  }

  const match = url.pathname.match(/^\/c\/([a-z0-9]+)(?:\/|$)/i);
  if (!match) throw new Error("Trello URL must contain /c/<short-link>.");
  return { requestedUrl: url.toString(), shortLink: match[1] };
}

export function safeAttachmentName(attachment) {
  const original = path.basename(String(attachment.name || "attachment"));
  const safe = original.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${attachment.id}-${safe || "attachment"}`;
}

export function attachmentMediaKind(attachment) {
  const contentType = String(attachment.mimeType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";

  const extension = path.extname(attachment.name ?? "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

async function loadCredentials() {
  if (process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN) {
    return { key: process.env.TRELLO_API_KEY, token: process.env.TRELLO_TOKEN };
  }

  const configPath = path.join(os.homedir(), ".trello-cli", "config.json");
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Trello credentials are not configured.");
    if (error instanceof SyntaxError) throw new Error("~/.trello-cli/config.json is not valid JSON.");
    throw error;
  }

  const key = config.ApiKey ?? config.apiKey ?? config.key;
  const token = config.Token ?? config.token;
  if (!key || !token) throw new Error("Trello credentials are incomplete.");
  return { key, token };
}

async function trelloJson(endpoint, credentials, apiBaseUrl, searchParams = {}) {
  const url = new URL(`${apiBaseUrl}${endpoint}`);
  url.searchParams.set("key", credentials.key);
  url.searchParams.set("token", credentials.token);
  for (const [name, value] of Object.entries(searchParams)) url.searchParams.set(name, String(value));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Trello request failed: HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchAllComments(cardId, credentials, apiBaseUrl) {
  const comments = [];
  const seen = new Set();
  let before;

  while (true) {
    const page = await trelloJson(
      `/cards/${encodeURIComponent(cardId)}/actions`,
      credentials,
      apiBaseUrl,
      {
        filter: "commentCard",
        limit: 1000,
        fields: "id,date,type,data,idMemberCreator",
        memberCreator: true,
        memberCreator_fields: "id,fullName,username",
        ...(before ? { before } : {}),
      },
    );

    for (const action of page) {
      if (seen.has(action.id)) continue;
      seen.add(action.id);
      comments.push({
        id: action.id,
        date: action.date,
        text: action.data?.text ?? "",
        memberCreator: action.memberCreator ?? { id: action.idMemberCreator },
      });
    }

    if (page.length < 1000) break;
    const nextBefore = page.at(-1)?.id;
    if (!nextBefore || nextBefore === before) throw new Error("Trello comment pagination did not advance.");
    before = nextBefore;
  }

  return comments;
}

export function resolveCustomFields(definitions, items) {
  const itemsByField = new Map((items ?? []).map((item) => [item.idCustomField, item]));
  return (definitions ?? []).map((definition) => {
    const item = itemsByField.get(definition.id);
    const selectedOption = definition.options?.find((option) => option.id === item?.idValue);
    const value = selectedOption?.value ?? item?.value ?? null;
    return {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      value,
      optionId: item?.idValue ?? null,
    };
  });
}

function oauthAuthorization(credentials) {
  const escape = (value) => String(value).replace(/["\\]/g, "\\$&");
  return `OAuth oauth_consumer_key="${escape(credentials.key)}", oauth_token="${escape(credentials.token)}"`;
}

async function downloadAttachment(attachment, cardId, directory, credentials, apiBaseUrl) {
  const mediaKind = attachmentMediaKind(attachment);
  if (!attachment.isUpload) {
    return { status: "linked", url: attachment.url, reason: "URL attachment; inspect destination separately" };
  }

  const declaredBytes = Number(attachment.bytes);
  if (!mediaKind && Number.isFinite(declaredBytes) && declaredBytes > MAX_NON_MEDIA_ATTACHMENT_BYTES) {
    return { status: "skipped", reason: "non-media attachment exceeds 50 MB limit" };
  }

  const fileName = encodeURIComponent(attachment.name || "attachment");
  const endpoint =
    `/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachment.id)}` +
    `/download/${fileName}`;
  const response = await fetch(new URL(`${apiBaseUrl}${endpoint}`), {
    headers: { Authorization: oauthAuthorization(credentials) },
    redirect: "follow",
    signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS),
  });
  if (!response.ok) return { status: "failed", reason: `HTTP ${response.status} ${response.statusText}` };
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
  const reference = parseCardUrl(process.argv[2]);
  const credentials = await loadCredentials();
  const apiBaseUrl = process.env.TRELLO_API_BASE_URL || DEFAULT_API_BASE_URL;

  const card = await trelloJson(
    `/cards/${encodeURIComponent(reference.shortLink)}`,
    credentials,
    apiBaseUrl,
    {
      fields: "all",
      board: true,
      board_fields: "id,name,url,shortUrl",
      list: true,
      list_fields: "id,name,closed,pos",
      members: true,
      member_fields: "id,fullName,username",
      labels: "all",
      customFieldItems: true,
    },
  );

  const [comments, checklists, attachments, customFieldDefinitions] = await Promise.all([
    fetchAllComments(card.id, credentials, apiBaseUrl),
    trelloJson(`/cards/${encodeURIComponent(card.id)}/checklists`, credentials, apiBaseUrl, {
      fields: "all",
      checkItems: "all",
      checkItem_fields: "all",
    }),
    trelloJson(`/cards/${encodeURIComponent(card.id)}/attachments`, credentials, apiBaseUrl, {
      fields: "all",
    }),
    card.idBoard
      ? trelloJson(`/boards/${encodeURIComponent(card.idBoard)}/customFields`, credentials, apiBaseUrl)
      : Promise.resolve([]),
  ]);

  const workingDirectory = await mkdtemp(path.join(os.tmpdir(), `trello-card-${reference.shortLink}-`));
  const attachmentDirectory = path.join(workingDirectory, "attachments");
  await mkdir(attachmentDirectory, { mode: 0o700 });

  const normalizedAttachments = [];
  for (const attachment of attachments) {
    let download;
    try {
      download = await downloadAttachment(
        attachment,
        card.id,
        attachmentDirectory,
        credentials,
        apiBaseUrl,
      );
    } catch (error) {
      download = { status: "failed", reason: error.message };
    }
    normalizedAttachments.push({
      ...attachment,
      mediaKind: attachmentMediaKind(attachment),
      download,
    });
  }

  const contextPath = path.join(workingDirectory, "context.json");
  const context = {
    source: {
      requestedUrl: reference.requestedUrl,
      shortLink: reference.shortLink,
      fetchedAt: new Date().toISOString(),
      contextPath,
      attachmentDirectory,
    },
    card,
    comments,
    checklists,
    customFields: resolveCustomFields(customFieldDefinitions, card.customFieldItems),
    customFieldDefinitions,
    attachments: normalizedAttachments,
  };
  await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });

  const failedAttachments = normalizedAttachments
    .filter((attachment) => ["failed", "skipped"].includes(attachment.download.status))
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      status: attachment.download.status,
      reason: attachment.download.reason,
    }));

  output({
    ok: true,
    data: {
      id: card.id,
      title: card.name,
      url: card.url,
      contextPath,
      attachmentDirectory,
      counts: {
        comments: comments.length,
        checklists: checklists.length,
        attachments: normalizedAttachments.length,
      },
      failedAttachments,
    },
  });
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryPath === import.meta.url) main().catch((error) => fail("FETCH_FAILED", error.message));
