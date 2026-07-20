#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TRELLO_BASE_URL = "https://api.trello.com/1";

function output(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

function fail(code, message) {
  output({ ok: false, code, error: message }, 1);
}

function requireArgument(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Usage: trello-requester.mjs <board-id> <card-id> <requester-name>; missing ${name}.`);
  }
  return value.trim();
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

async function trelloRequest(endpoint, credentials, options = {}) {
  const url = new URL(`${TRELLO_BASE_URL}${endpoint}`);
  url.searchParams.set("key", credentials.key);
  url.searchParams.set("token", credentials.token);

  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`Trello request failed: HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

async function main() {
  const boardId = requireArgument(process.argv[2], "board-id");
  const cardId = requireArgument(process.argv[3], "card-id");
  const requesterName = requireArgument(process.argv[4], "requester-name");
  const credentials = await loadCredentials();

  const fields = await trelloRequest(`/boards/${encodeURIComponent(boardId)}/customFields`, credentials);
  const matches = fields.filter((field) => field.name === "Requester" && field.type === "text");

  if (matches.length === 0) {
    output({ ok: true, data: { status: "field_absent" } });
    return;
  }
  if (matches.length > 1) {
    throw new Error("Multiple text custom fields named Requester exist on the selected board.");
  }

  await trelloRequest(
    `/cards/${encodeURIComponent(cardId)}/customField/${encodeURIComponent(matches[0].id)}/item`,
    credentials,
    { method: "PUT", body: JSON.stringify({ value: { text: requesterName } }) },
  );

  output({
    ok: true,
    data: { status: "updated", customFieldId: matches[0].id, requester: requesterName },
  });
}

main().catch((error) => fail("TRELLO_REQUESTER_FAILED", error.message));
