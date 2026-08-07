import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import extension, { createSafeReadToolDefinition } from "../index.ts";

const execFileAsync = promisify(execFile);
const png1x1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

function context(cwd: string) {
	return { cwd, model: { input: ["text", "image"] } } as any;
}

async function execute(tool: any, cwd: string, params: Record<string, unknown>, signal?: AbortSignal) {
	return tool.execute("test", params, signal, undefined, context(cwd));
}

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-safe-read-test-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("registers a read override with a tool-side default timeout", () => {
	let registered: any;
	extension({ registerTool(tool: any) { registered = tool; } } as any);
	assert.equal(registered.name, "read");
	assert.equal(registered.parameters.properties.timeout.default, 10);
	assert.deepEqual(registered.prepareArguments({ path: "README.md" }), { path: "README.md", timeout: 10 });
	assert.deepEqual(registered.prepareArguments({ path: "README.md", timeout: 2 }), {
		path: "README.md",
		timeout: 2,
	});
	assert.equal(registered.promptSnippet, "Read file contents");
	assert.ok(registered.promptGuidelines.includes("Use read to examine files instead of cat or sed."));
	assert.equal(typeof registered.renderCall, "function");
	assert.equal(typeof registered.renderResult, "function");
});

test("reads regular text with built-in offset and limit behavior", async () => {
	await withTempDir(async (root) => {
		await writeFile(join(root, "notes.txt"), "one\ntwo\nthree\nfour\n");
		const result = await execute(createSafeReadToolDefinition(), root, {
			path: "notes.txt",
			offset: 2,
			limit: 2,
		});
		assert.equal(result.content[0].text, "two\nthree\n\n[2 more lines in file. Use offset=4 to continue.]");
	});
});

test("reads images and symlinks to regular files", async () => {
	await withTempDir(async (root) => {
		await writeFile(join(root, "pixel.png"), png1x1);
		await symlink("pixel.png", join(root, "pixel-link.png"));
		const result = await execute(createSafeReadToolDefinition(), root, { path: "pixel-link.png" });
		assert.match(result.content[0].text, /Read image file \[image\/png\]/);
		assert.equal(result.content[1].type, "image");
		assert.equal(result.content[1].mimeType, "image/png");
	});
});

test("preserves relative, absolute, leading-@, and tilde path semantics", async () => {
	await withTempDir(async (root) => {
		const file = join(root, "path.txt");
		await writeFile(file, "path semantics");
		const tool = createSafeReadToolDefinition();
		for (const path of ["path.txt", "@path.txt", file]) {
			const result = await execute(tool, root, { path });
			assert.equal(result.content[0].text, "path semantics");
		}
	});

	const homeRoot = await mkdtemp(join(homedir(), ".pi-safe-read-test-"));
	try {
		const file = join(homeRoot, "home.txt");
		await writeFile(file, "home semantics");
		const result = await execute(createSafeReadToolDefinition(), tmpdir(), {
			path: `~/${basename(homeRoot)}/home.txt`,
		});
		assert.equal(result.content[0].text, "home semantics");
	} finally {
		await rm(homeRoot, { recursive: true, force: true });
	}
});

test("enforces the default timeout when the argument is omitted", async () => {
	await withTempDir(async (root) => {
		await writeFile(join(root, "slow.txt"), "unused");
		const tool = createSafeReadToolDefinition({
			defaultTimeoutSeconds: 0.02,
			readRegularFile: async (_path, signal) => {
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
				return Buffer.alloc(0);
			},
		});
		assert.equal((tool.parameters as any).properties.timeout.default, 0.02);
		await assert.rejects(execute(tool, root, { path: "slow.txt" }), /timed out after 0\.02 seconds/);
	});
});

test("enforces an explicit timeout and allows a longer valid timeout", async () => {
	await withTempDir(async (root) => {
		await writeFile(join(root, "slow.txt"), "unused");
		const reader = async (_path: string, signal: AbortSignal) => {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, 30);
				signal.addEventListener("abort", () => {
					clearTimeout(timer);
					reject(signal.reason);
				}, { once: true });
			});
			return Buffer.from("finished");
		};
		const tool = createSafeReadToolDefinition({ defaultTimeoutSeconds: 1, readRegularFile: reader });
		await assert.rejects(execute(tool, root, { path: "slow.txt", timeout: 0.01 }), /timed out after 0\.01 seconds/);
		const result = await execute(tool, root, { path: "slow.txt", timeout: 0.1 });
		assert.equal(result.content[0].text, "finished");
	});
});

test("parent cancellation aborts a read without reporting a timeout", async () => {
	await withTempDir(async (root) => {
		await writeFile(join(root, "cancel.txt"), "unused");
		const tool = createSafeReadToolDefinition({
			readRegularFile: async (_path, signal) => {
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
				return Buffer.alloc(0);
			},
		});
		const controller = new AbortController();
		const pending = execute(tool, root, { path: "cancel.txt" }, controller.signal);
		setTimeout(() => controller.abort(), 10);
		await assert.rejects(pending, /Read aborted/);
	});
});

async function runWorker(filePath: string): Promise<string> {
	const worker = join(dirname(fileURLToPath(import.meta.url)), "read-worker.ts");
	const result = await execFileAsync(process.execPath, ["--experimental-strip-types", worker, filePath], {
		timeout: 1_500,
		cwd: dirname(dirname(worker)),
	});
	return result.stdout;
}

test("rejects directories, FIFOs, sockets, and symlinks to them without hanging", {
	skip: process.platform === "win32" ? "Unix special-file fixtures are unavailable" : false,
}, async () => {
	await withTempDir(async (root) => {
		const directory = join(root, "directory");
		const fifo = join(root, "pipe");
		const socket = join(root, "socket");
		await mkdir(directory);
		await execFileAsync("mkfifo", [fifo]);

		const server = createServer();
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socket, resolve);
		});

		try {
			await symlink(fifo, join(root, "pipe-link"));
			await symlink(socket, join(root, "socket-link"));
			for (const fixture of [directory, fifo, socket, join(root, "pipe-link"), join(root, "socket-link"), "/dev/null"]) {
				const output = await runWorker(fixture);
				assert.match(output, /Cannot read non-regular file/);
			}
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		}
	});
});
