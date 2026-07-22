import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachmentMediaKind,
  parseCardUrl,
  resolveCustomFields,
  safeAttachmentName,
} from "../scripts/fetch-trello-card.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/fetch-trello-card.mjs", import.meta.url));

function runScript(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("parses canonical Trello card URLs", () => {
  assert.deepEqual(parseCardUrl("https://trello.com/c/AbCd1234/card-title?x=1"), {
    requestedUrl: "https://trello.com/c/AbCd1234/card-title?x=1",
    shortLink: "AbCd1234",
  });
  assert.equal(parseCardUrl("https://www.trello.com/c/a1B2").shortLink, "a1B2");
});

test("rejects non-card and untrusted URLs", () => {
  assert.throws(() => parseCardUrl("http://trello.com/c/AbCd1234"), /HTTPS/);
  assert.throws(() => parseCardUrl("https://evil.example/c/AbCd1234"), /trello\.com/);
  assert.throws(() => parseCardUrl("https://trello.com/b/AbCd1234"), /\/c\//);
});

test("normalizes attachment names and media kinds", () => {
  assert.equal(safeAttachmentName({ id: "att1", name: "../../Demo image.png" }), "att1-Demo-image.png");
  assert.equal(attachmentMediaKind({ name: "clip.MOV" }), "video");
  assert.equal(attachmentMediaKind({ name: "recording", mimeType: "audio/ogg" }), "audio");
  assert.equal(attachmentMediaKind({ name: "notes.txt", mimeType: "text/plain" }), null);
});

test("resolves custom field values", () => {
  const definitions = [
    { id: "text", name: "Requester", type: "text" },
    {
      id: "select",
      name: "Priority",
      type: "list",
      options: [{ id: "high", value: { text: "High" } }],
    },
  ];
  const values = [
    { idCustomField: "text", value: { text: "Ada" } },
    { idCustomField: "select", idValue: "high" },
  ];

  assert.deepEqual(resolveCustomFields(definitions, values), [
    { id: "text", name: "Requester", type: "text", value: { text: "Ada" }, optionId: null },
    { id: "select", name: "Priority", type: "list", value: { text: "High" }, optionId: "high" },
  ]);
});

test("fetches card context and downloads uploaded attachments", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push({ path: url.pathname, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");

    if (url.pathname === "/1/cards/AbCd1234") {
      response.end(JSON.stringify({
        id: "card1",
        idBoard: "board1",
        name: "Test card",
        desc: "Full description",
        url: "https://trello.com/c/AbCd1234/test-card",
        customFieldItems: [{ idCustomField: "field1", value: { text: "Ada" } }],
      }));
    } else if (url.pathname === "/1/cards/card1/actions") {
      response.end(JSON.stringify([{
        id: "comment1",
        date: "2026-01-01T00:00:00.000Z",
        data: { text: "A comment" },
        memberCreator: { id: "member1", fullName: "Ada" },
      }]));
    } else if (url.pathname === "/1/cards/card1/checklists") {
      response.end(JSON.stringify([{ id: "checklist1", name: "Steps", checkItems: [] }]));
    } else if (url.pathname === "/1/cards/card1/attachments") {
      response.end(JSON.stringify([
        { id: "upload1", name: "notes.txt", mimeType: "text/plain", bytes: 5, isUpload: true },
        { id: "link1", name: "Docs", url: "https://example.com/docs", isUpload: false },
      ]));
    } else if (url.pathname === "/1/boards/board1/customFields") {
      response.end(JSON.stringify([{ id: "field1", name: "Requester", type: "text" }]));
    } else if (url.pathname === "/1/cards/card1/attachments/upload1/download/notes.txt") {
      response.setHeader("Content-Type", "text/plain");
      response.end("hello");
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const result = await runScript(["https://trello.com/c/AbCd1234/test-card"], {
    TRELLO_API_KEY: "test-key",
    TRELLO_TOKEN: "test-token",
    TRELLO_API_BASE_URL: `http://127.0.0.1:${address.port}/1`,
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.includes("test-key"), false);
  assert.equal(result.stdout.includes("test-token"), false);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.data.counts, { comments: 1, checklists: 1, attachments: 2 });

  const context = JSON.parse(await readFile(summary.data.contextPath, "utf8"));
  assert.equal(context.card.desc, "Full description");
  assert.equal(context.comments[0].text, "A comment");
  assert.equal(context.customFields[0].value.text, "Ada");
  assert.equal(context.attachments[1].download.status, "linked");
  const downloaded = context.attachments[0].download.localPath;
  assert.equal(path.dirname(downloaded), summary.data.attachmentDirectory);
  assert.equal(await readFile(downloaded, "utf8"), "hello");

  const downloadRequest = requests.find((request) => request.path.includes("/download/"));
  assert.match(downloadRequest.authorization, /oauth_consumer_key="test-key"/);
  assert.match(downloadRequest.authorization, /oauth_token="test-token"/);
});
