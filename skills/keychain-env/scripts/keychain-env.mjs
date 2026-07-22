#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

const DEFAULT_SECURITY_PATH = "/usr/bin/security";
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REDACTION = Buffer.from("[REDACTED]");

const HELP = `keychain-env — use macOS Keychain credentials without revealing them

Commands:
  check  --env <NAME> [--keychain <path>]
  store  --env <NAME>
  exec   --env <NAME> [--keychain <path>] [--env <NAME> ...] -- <command> [args...]
  delete --env <NAME> [--keychain <path>] --confirm-delete

Credentials use account <current macOS username> and service keychain-env:<NAME>.
store uses Apple's non-echoing prompt. exec writes redacted child output normally and
writes its JSON status to stderr. Other commands write JSON status to stdout.`;

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function writeJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(error, stream = process.stdout) {
  const code = error instanceof CliError ? error.code : "ERROR";
  const message = error instanceof CliError ? error.message : "Unexpected helper failure.";
  writeJson({ ok: false, code, error: message }, stream);
  process.exitCode = 1;
}

export function ensureMacOS(platform = process.platform) {
  if (platform !== "darwin") {
    throw new CliError("UNSUPPORTED_OS", "keychain-env supports macOS only.");
  }
}

function optionValue(tokens, index, option) {
  const value = tokens[index + 1];
  if (value === undefined || value === "") {
    throw new CliError("USAGE_ERROR", `${option} requires a value.`);
  }
  return value;
}

function setOnce(target, key, value, option) {
  if (target[key] !== undefined) {
    throw new CliError("AMBIGUOUS", `${option} may be supplied only once per credential.`);
  }
  target[key] = value;
}

function validateEnvironmentName(env) {
  if (!env) throw new CliError("AMBIGUOUS", "An explicit --env is required.");
  if (!ENV_NAME.test(env)) {
    throw new CliError("USAGE_ERROR", "Environment names must match [A-Za-z_][A-Za-z0-9_]*.");
  }
  return env;
}

export function selectorFromEnvironment(env, keychain, username = userInfo().username) {
  validateEnvironmentName(env);
  return {
    env,
    account: username,
    service: `keychain-env:${env}`,
    ...(keychain ? { keychain } : {}),
  };
}

export function parseSimpleArguments(tokens, { allowConfirmation = false } = {}) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--confirm-delete" && allowConfirmation) {
      if (options.confirmDelete) throw new CliError("USAGE_ERROR", "--confirm-delete may be supplied only once.");
      options.confirmDelete = true;
      continue;
    }
    if (!["--env", "--keychain"].includes(token)) {
      throw new CliError("USAGE_ERROR", `Unknown option: ${token}`);
    }
    const key = token.slice(2);
    setOnce(options, key, optionValue(tokens, index, token), token);
    index += 1;
  }
  return {
    ...selectorFromEnvironment(options.env, options.keychain),
    ...(options.confirmDelete ? { confirmDelete: true } : {}),
  };
}

export function parseExecArguments(tokens, username = userInfo().username) {
  const separator = tokens.indexOf("--");
  if (separator === -1) throw new CliError("USAGE_ERROR", "exec requires -- before the target command.");
  const command = tokens.slice(separator + 1);
  if (command.length === 0) throw new CliError("USAGE_ERROR", "exec requires a target command after --.");

  const optionTokens = tokens.slice(0, separator);
  const credentials = [];
  let current;
  for (let index = 0; index < optionTokens.length; index += 1) {
    const token = optionTokens[index];
    if (token === "--env") {
      current = { env: optionValue(optionTokens, index, token) };
      credentials.push(current);
      index += 1;
      continue;
    }
    if (token !== "--keychain") {
      throw new CliError("USAGE_ERROR", `Unknown exec option: ${token}`);
    }
    if (!current) throw new CliError("AMBIGUOUS", "Each credential mapping must begin with --env.");
    setOnce(current, "keychain", optionValue(optionTokens, index, token), token);
    index += 1;
  }

  if (credentials.length === 0) throw new CliError("AMBIGUOUS", "exec requires at least one --env mapping.");
  const names = new Set();
  for (let index = 0; index < credentials.length; index += 1) {
    const credential = credentials[index];
    validateEnvironmentName(credential.env);
    if (names.has(credential.env)) {
      throw new CliError("AMBIGUOUS", "Each environment variable may be mapped only once.");
    }
    names.add(credential.env);
    credentials[index] = selectorFromEnvironment(credential.env, credential.keychain, username);
  }
  return { credentials, command };
}

function securityPath() {
  return process.env.KEYCHAIN_ENV_SECURITY || DEFAULT_SECURITY_PATH;
}

function securityArguments(operation, selector, { reveal = false } = {}) {
  const args = [operation, "-a", selector.account, "-s", selector.service];
  if (reveal) args.push("-w");
  if (selector.keychain) args.push(path.resolve(selector.keychain));
  return args;
}

function classifySecurityFailure(result) {
  const text = result.stderr.toString("utf8").toLowerCase();
  if (result.code === 44 || text.includes("could not be found") || text.includes("item not found")) {
    return new CliError("NOT_FOUND", "No Keychain item matched the derived environment-variable credential.");
  }
  if (text.includes("locked")) {
    return new CliError("KEYCHAIN_LOCKED", "The selected keychain is locked.");
  }
  if (text.includes("interaction is not allowed") || text.includes("user interaction is not allowed")) {
    return new CliError("INTERACTION_REQUIRED", "Keychain access requires an interactive macOS session.");
  }
  if (text.includes("denied") || text.includes("authorization failed") || text.includes("auth failed") || text.includes("user canceled")) {
    return new CliError("ACCESS_DENIED", "Keychain access was denied or canceled.");
  }
  return new CliError("SECURITY_ERROR", "The macOS security command failed.");
}

async function runSecurity(args, { interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(securityPath(), args, {
      stdio: [interactive ? "inherit" : "ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let captureFailed = false;

    const capture = (chunks, chunk, forward) => {
      if (forward) forward.write(chunk);
      capturedBytes += chunk.length;
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        captureFailed = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk, interactive ? process.stderr : null));
    child.on("error", () => reject(new CliError("SECURITY_ERROR", "The macOS security command could not be started.")));
    child.on("close", (code, signal) => {
      if (captureFailed) {
        reject(new CliError("SECURITY_ERROR", "The macOS security command produced excessive output."));
        return;
      }
      resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

function stripOutputNewline(buffer) {
  let end = buffer.length;
  if (end > 0 && buffer[end - 1] === 0x0a) end -= 1;
  if (end > 0 && buffer[end - 1] === 0x0d) end -= 1;
  return buffer.subarray(0, end);
}

async function retrieve(selector) {
  const result = await runSecurity(securityArguments("find-generic-password", selector, { reveal: true }));
  if (result.code !== 0) throw classifySecurityFailure(result);
  const value = stripOutputNewline(result.stdout).toString("utf8");
  if (value.includes("\0")) throw new CliError("SECURITY_ERROR", "The credential cannot be represented in an environment variable.");
  return value;
}

class LiteralRedactor extends Transform {
  constructor(values) {
    super();
    this.needles = [...new Set(values.filter((value) => value.length > 0))].map((value) => Buffer.from(value));
    this.maxNeedleLength = Math.max(0, ...this.needles.map((needle) => needle.length));
    this.pending = Buffer.alloc(0);
  }

  earliestMatch() {
    let best;
    for (const needle of this.needles) {
      const index = this.pending.indexOf(needle);
      if (index !== -1 && (!best || index < best.index || (index === best.index && needle.length > best.needle.length))) {
        best = { index, needle };
      }
    }
    return best;
  }

  drain(final) {
    if (this.needles.length === 0) {
      if (this.pending.length) this.push(this.pending);
      this.pending = Buffer.alloc(0);
      return;
    }

    while (this.pending.length) {
      const match = this.earliestMatch();
      if (match) {
        if (match.index > 0) this.push(this.pending.subarray(0, match.index));
        this.push(REDACTION);
        this.pending = this.pending.subarray(match.index + match.needle.length);
        continue;
      }
      const retained = final ? 0 : Math.min(this.pending.length, this.maxNeedleLength - 1);
      const emitted = this.pending.length - retained;
      if (emitted > 0) this.push(this.pending.subarray(0, emitted));
      this.pending = this.pending.subarray(emitted);
      break;
    }
  }

  _transform(chunk, _encoding, callback) {
    this.pending = Buffer.concat([this.pending, Buffer.from(chunk)]);
    this.drain(false);
    callback();
  }

  _flush(callback) {
    this.drain(true);
    callback();
  }
}

async function runChild(command, credentials) {
  const childEnvironment = { ...process.env };
  const values = [];
  for (const credential of credentials) {
    const value = await retrieve(credential);
    childEnvironment[credential.env] = value;
    values.push(value);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env: childEnvironment,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.pipe(new LiteralRedactor(values)).pipe(process.stdout, { end: false });
    child.stderr.pipe(new LiteralRedactor(values)).pipe(process.stderr, { end: false });
    child.on("error", () => reject(new CliError("CHILD_START_FAILED", "The target command could not be started.")));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  ensureMacOS();
  const command = argv[0];
  if (!command) throw new CliError("USAGE_ERROR", "A command is required. Run with --help.");

  if (command === "check") {
    const selector = parseSimpleArguments(argv.slice(1));
    const result = await runSecurity(securityArguments("find-generic-password", selector));
    if (result.code === 0) {
      writeJson({ ok: true, command: "check", exists: true });
      return;
    }
    const error = classifySecurityFailure(result);
    if (error.code === "NOT_FOUND") {
      writeJson({ ok: true, command: "check", exists: false });
      return;
    }
    throw error;
  }

  if (command === "store") {
    const selector = parseSimpleArguments(argv.slice(1));
    if (selector.keychain) {
      throw new CliError("UNSUPPORTED_OPERATION", "Interactive storage supports the default keychain only; use Keychain Access for another keychain.");
    }
    if (securityPath() === DEFAULT_SECURITY_PATH && !process.stdin.isTTY) {
      throw new CliError("INTERACTION_REQUIRED", "store must run in the user's interactive macOS terminal.");
    }
    const args = ["add-generic-password", "-a", selector.account, "-s", selector.service, "-U", "-w"];
    const result = await runSecurity(args, { interactive: true });
    if (result.code !== 0) throw classifySecurityFailure(result);
    writeJson({ ok: true, command: "store", stored: true });
    return;
  }

  if (command === "delete") {
    const selector = parseSimpleArguments(argv.slice(1), { allowConfirmation: true });
    if (!selector.confirmDelete) {
      throw new CliError("CONFIRMATION_REQUIRED", "delete requires explicit confirmation and --confirm-delete.");
    }
    const result = await runSecurity(securityArguments("delete-generic-password", selector));
    if (result.code !== 0) throw classifySecurityFailure(result);
    writeJson({ ok: true, command: "delete", deleted: true });
    return;
  }

  if (command === "exec") {
    const parsed = parseExecArguments(argv.slice(1));
    const result = await runChild(parsed.command, parsed.credentials);
    const ok = result.code === 0 && !result.signal;
    writeJson({ ok, command: "exec", exitCode: result.code, signal: result.signal }, process.stderr);
    process.exitCode = ok ? 0 : (Number.isInteger(result.code) ? result.code : 1);
    return;
  }

  throw new CliError("USAGE_ERROR", `Unknown command: ${command}. Run with --help.`);
}

const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (entryPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => fail(error, process.argv[2] === "exec" ? process.stderr : process.stdout));
}
