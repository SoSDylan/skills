import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  ensureMacOS,
  parseExecArguments,
  parseSimpleArguments,
  selectorFromEnvironment,
} from "../scripts/keychain-env.mjs";

const CLI = new URL("../scripts/keychain-env.mjs", import.meta.url).pathname;
const TEST_USERNAME = os.userInfo().username;
const FIRST_SECRET = "dummy-alpha-credential";
const SECOND_SECRET = "dummy-beta-credential";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "keychain-env-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const security = path.join(directory, "security-mock.mjs");
  const log = path.join(directory, "security-args.jsonl");
  await writeFile(security, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.MOCK_SECURITY_LOG, JSON.stringify(args) + "\\n");
const operation = args[0];
if (process.env.MOCK_SECURITY_FAILURE === "missing") {
  process.stderr.write("The specified item could not be found in the keychain.\\n");
  process.exit(44);
}
if (process.env.MOCK_SECURITY_FAILURE === "locked") {
  process.stderr.write("The selected keychain is locked.\\n");
  process.exit(1);
}
if (operation === "find-generic-password" && args.includes("-w")) {
  const service = args[args.indexOf("-s") + 1];
  process.stdout.write((service === "keychain-env:SECOND_TOKEN" ? ${JSON.stringify(SECOND_SECRET)} : ${JSON.stringify(FIRST_SECRET)}) + "\\n");
} else if (operation === "find-generic-password") {
  process.stdout.write("matching item metadata\\n");
} else if (operation === "add-generic-password") {
  if (args.at(-1) !== "-w" || args.includes(${JSON.stringify(FIRST_SECRET)})) process.exit(2);
  process.stderr.write("password data for new item: ");
} else if (operation !== "delete-generic-password") {
  process.exit(2);
}
`);
  await chmod(security, 0o755);
  return { directory, security, log };
}

async function runCli(args, { security, log, env = {}, cli = CLI }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        KEYCHAIN_ENV_SECURITY: security,
        MOCK_SECURITY_LOG: log,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function loggedArguments(log) {
  try {
    return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function assertSecretsAbsent(...outputs) {
  for (const output of outputs) {
    assert.equal(output.includes(FIRST_SECRET), false);
    assert.equal(output.includes(SECOND_SECRET), false);
  }
}

test("runs when invoked through a symlinked skill directory", async (t) => {
  const { directory, security, log } = await fixture(t);
  const skillLink = path.join(directory, "keychain-env");
  await symlink(path.resolve(path.dirname(CLI), ".."), skillLink, "dir");

  const result = await runCli(["--help"], {
    security,
    log,
    cli: path.join(skillLink, "scripts", "keychain-env.mjs"),
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /keychain-env — use macOS Keychain credentials/);
  assert.equal(result.stderr, "");
});

test("derives identity from the environment name and rejects overrides", () => {
  assert.deepEqual(selectorFromEnvironment("API_TOKEN", undefined, "operator"), {
    env: "API_TOKEN",
    account: "operator",
    service: "keychain-env:API_TOKEN",
  });
  assert.deepEqual(parseSimpleArguments(["--env", "API_TOKEN"]), {
    env: "API_TOKEN",
    account: TEST_USERNAME,
    service: "keychain-env:API_TOKEN",
  });
  assert.throws(() => parseSimpleArguments(["--service", "example"]), /Unknown option/);
  assert.throws(() => parseExecArguments(["--env", "INVALID-NAME", "--", "true"]), /Environment names/);
  assert.throws(() => ensureMacOS("linux"), (error) => error.code === "UNSUPPORTED_OS");
});

test("check reports existence without retrieving or revealing the credential", async (t) => {
  const { security, log } = await fixture(t);
  const result = await runCli(["check", "--env", "FIRST_TOKEN"], { security, log });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, command: "check", exists: true });
  assert.equal(result.stderr, "");
  const calls = await loggedArguments(log);
  assert.deepEqual(calls, [[
    "find-generic-password", "-a", TEST_USERNAME, "-s", "keychain-env:FIRST_TOKEN",
  ]]);
  assertSecretsAbsent(result.stdout, result.stderr, JSON.stringify(calls));
});

test("check maps a missing item to exists false", async (t) => {
  const { security, log } = await fixture(t);
  const result = await runCli(["check", "--env", "FIRST_TOKEN"], {
    security,
    log,
    env: { MOCK_SECURITY_FAILURE: "missing" },
  });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, command: "check", exists: false });
  assertSecretsAbsent(result.stdout, result.stderr);
});

test("store delegates non-echoing entry to security without a password argument", async (t) => {
  const { security, log } = await fixture(t);
  const result = await runCli(["store", "--env", "FIRST_TOKEN"], { security, log });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, command: "store", stored: true });
  const calls = await loggedArguments(log);
  assert.deepEqual(calls, [[
    "add-generic-password", "-a", TEST_USERNAME, "-s", "keychain-env:FIRST_TOKEN", "-U", "-w",
  ]]);

  const customKeychain = await runCli([
    "store", "--env", "FIRST_TOKEN", "--keychain", "/tmp/custom.keychain-db",
  ], { security, log });
  assert.equal(customKeychain.code, 1);
  assert.equal(JSON.parse(customKeychain.stdout).code, "UNSUPPORTED_OPERATION");
  assert.deepEqual(await loggedArguments(log), calls);
  assertSecretsAbsent(result.stdout, result.stderr, customKeychain.stdout, customKeychain.stderr, JSON.stringify(calls));
});

test("exec injects multiple credentials and redacts fragmented child output", async (t) => {
  const { security, log } = await fixture(t);
  const childProgram = `
const first = process.env.FIRST_TOKEN;
const second = process.env.SECOND_TOKEN;
process.stdout.write(first.slice(0, 7));
process.stdout.write(first.slice(7) + "\\n");
process.stderr.write(second + "\\n");
`;
  const result = await runCli([
    "exec", "--env", "FIRST_TOKEN", "--env", "SECOND_TOKEN",
    "--", process.execPath, "-e", childProgram,
  ], { security, log });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "[REDACTED]\n");
  assert.match(result.stderr, /^\[REDACTED\]\n/);
  assert.match(result.stderr, /"ok":true,"command":"exec","exitCode":0/);
  const calls = await loggedArguments(log);
  assert.deepEqual(calls, [
    ["find-generic-password", "-a", TEST_USERNAME, "-s", "keychain-env:FIRST_TOKEN", "-w"],
    ["find-generic-password", "-a", TEST_USERNAME, "-s", "keychain-env:SECOND_TOKEN", "-w"],
  ]);
  assertSecretsAbsent(result.stdout, result.stderr, JSON.stringify(calls));
});

test("delete requires confirmation before invoking security", async (t) => {
  const { security, log } = await fixture(t);
  const unconfirmed = await runCli(["delete", "--env", "FIRST_TOKEN"], { security, log });

  assert.equal(unconfirmed.code, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(await loggedArguments(log), []);

  const confirmed = await runCli(["delete", "--env", "FIRST_TOKEN", "--confirm-delete"], { security, log });
  assert.equal(confirmed.code, 0);
  assert.deepEqual(JSON.parse(confirmed.stdout), { ok: true, command: "delete", deleted: true });
  const calls = await loggedArguments(log);
  assert.deepEqual(calls, [[
    "delete-generic-password", "-a", TEST_USERNAME, "-s", "keychain-env:FIRST_TOKEN",
  ]]);
  assertSecretsAbsent(unconfirmed.stdout, unconfirmed.stderr, confirmed.stdout, confirmed.stderr, JSON.stringify(calls));
});

test("security failures are classified without forwarding raw diagnostics", async (t) => {
  const { security, log } = await fixture(t);
  const result = await runCli(["check", "--env", "FIRST_TOKEN"], {
    security,
    log,
    env: { MOCK_SECURITY_FAILURE: "locked" },
  });

  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).code, "KEYCHAIN_LOCKED");
  assert.equal(result.stderr, "");
  assertSecretsAbsent(result.stdout, result.stderr);
});
