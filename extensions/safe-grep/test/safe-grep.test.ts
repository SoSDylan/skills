import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import extension, { createSafeGrepToolDefinition } from "../index.ts";

function context(cwd: string) {
	return { cwd } as any;
}

async function execute(tool: any, cwd: string, params: Record<string, unknown>, signal?: AbortSignal) {
	return tool.execute("test", params, signal, undefined, context(cwd));
}

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-safe-grep-test-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function delegateFactory(executeDelegate: (...args: any[]) => Promise<any>) {
	return () => ({ execute: executeDelegate }) as any;
}

test("registers a grep override with a tool-side default timeout", () => {
	let registered: any;
	extension({ registerTool(tool: any) { registered = tool; } } as any);
	assert.equal(registered.name, "grep");
	assert.equal(registered.parameters.properties.timeout.default, 10);
	const builtInProperties = Object.keys(createGrepToolDefinition(process.cwd()).parameters.properties).sort();
	const wrappedProperties = Object.keys(registered.parameters.properties).filter((name) => name !== "timeout").sort();
	assert.deepEqual(wrappedProperties, builtInProperties);
	assert.deepEqual(registered.prepareArguments({ pattern: "needle", path: "src" }), {
		pattern: "needle",
		path: "src",
		timeout: 10,
	});
	assert.deepEqual(registered.prepareArguments({ pattern: "needle", timeout: 2 }), {
		pattern: "needle",
		timeout: 2,
	});
	assert.deepEqual(registered.prepareArguments({ pattern: "needle", timeout: null }), {
		pattern: "needle",
		timeout: null,
	});
	assert.equal(registered.promptSnippet, "Search file contents for patterns (respects .gitignore)");
	assert.equal(typeof registered.renderCall, "function");
	assert.equal(typeof registered.renderResult, "function");
});

test("preserves built-in grep results and options", async () => {
	await withTempDir(async (root) => {
		await writeFile(join(root, "notes.txt"), "before\nNeedle\nafter\n");
		const result = await execute(createSafeGrepToolDefinition(), root, {
			pattern: "needle",
			path: ".",
			ignoreCase: true,
			context: 1,
		});
		assert.match(result.content[0].text, /notes\.txt-1- before/);
		assert.match(result.content[0].text, /notes\.txt:2: Needle/);
		assert.match(result.content[0].text, /notes\.txt-3- after/);
	});
});

test("forwards grep arguments without the wrapper timeout", async () => {
	let delegatedCwd: string | undefined;
	let delegatedParams: unknown;
	let delegatedSignal: AbortSignal | undefined;
	const tool = createSafeGrepToolDefinition({
		delegateFactory: (cwd) => {
			delegatedCwd = cwd;
			return {
				execute: async (_id: string, params: unknown, signal: AbortSignal | undefined) => {
					delegatedParams = params;
					delegatedSignal = signal;
					return { content: [{ type: "text", text: "forwarded" }], details: undefined };
				},
			} as any;
		},
	});
	const result = await execute(tool, "/delegated/cwd", {
		pattern: "Needle",
		path: "src",
		glob: "*.ts",
		ignoreCase: true,
		literal: true,
		context: 2,
		limit: 5,
		timeout: 1,
	});
	assert.equal(result.content[0].text, "forwarded");
	assert.equal(delegatedCwd, "/delegated/cwd");
	assert.deepEqual(delegatedParams, {
		pattern: "Needle",
		path: "src",
		glob: "*.ts",
		ignoreCase: true,
		literal: true,
		context: 2,
		limit: 5,
	});
	assert.ok(delegatedSignal);
	assert.equal(delegatedSignal.aborted, false);
});

test("enforces the default timeout even when a delegate ignores cancellation", async () => {
	const tool = createSafeGrepToolDefinition({
		defaultTimeoutSeconds: 0.02,
		delegateFactory: delegateFactory(async () => new Promise(() => {})),
	});
	assert.equal((tool.parameters as any).properties.timeout.default, 0.02);
	await assert.rejects(execute(tool, process.cwd(), { pattern: "stuck" }), /timed out after 0\.02 seconds/);
});

test("reports a timeout when synchronous work returns after the deadline", async () => {
	const tool = createSafeGrepToolDefinition({
		defaultTimeoutSeconds: 0.01,
		delegateFactory: delegateFactory(async () => {
			const finishAt = performance.now() + 25;
			while (performance.now() < finishAt) {
				// Simulate a blocked event loop.
			}
			return { content: [{ type: "text", text: "too late" }], details: undefined };
		}),
	});
	await assert.rejects(execute(tool, process.cwd(), { pattern: "blocking" }), /timed out after 0\.01 seconds/);
});

test("replays timeout cancellation to a delegate that attaches its abort listener late", async () => {
	let lateAbortObserved = false;
	let replayedTargetIsSignal = false;
	let suppressedListenerCalled = false;
	const tool = createSafeGrepToolDefinition({
		defaultTimeoutSeconds: 0.01,
		delegateFactory: delegateFactory(async (_id, _params, signal: AbortSignal) => {
			await new Promise((resolve) => setTimeout(resolve, 25));
			signal.addEventListener("abort", (event) => {
				lateAbortObserved = true;
				replayedTargetIsSignal = event.target === signal && event.currentTarget === signal;
			}, { once: true });
			const registrationController = new AbortController();
			registrationController.abort();
			signal.addEventListener("abort", () => {
				suppressedListenerCalled = true;
			}, { signal: registrationController.signal });
			return { content: [{ type: "text", text: "late" }], details: undefined };
		}),
	});
	await assert.rejects(execute(tool, process.cwd(), { pattern: "late" }), /timed out after 0\.01 seconds/);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(lateAbortObserved, true);
	assert.equal(replayedTargetIsSignal, true);
	assert.equal(suppressedListenerCalled, false);
});

test("enforces an explicit timeout and allows a longer valid timeout", async () => {
	const tool = createSafeGrepToolDefinition({
		defaultTimeoutSeconds: 1,
		delegateFactory: delegateFactory(async (_id, _params, signal: AbortSignal) => {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, 30);
				signal.addEventListener("abort", () => {
					clearTimeout(timer);
					reject(signal.reason);
				}, { once: true });
			});
			return { content: [{ type: "text", text: "finished" }], details: undefined };
		}),
	});
	await assert.rejects(execute(tool, process.cwd(), { pattern: "slow", timeout: 0.01 }), /timed out after 0\.01 seconds/);
	const result = await execute(tool, process.cwd(), { pattern: "slow", timeout: 0.1 });
	assert.equal(result.content[0].text, "finished");
});

test("parent cancellation aborts grep without reporting a timeout", async () => {
	const tool = createSafeGrepToolDefinition({
		delegateFactory: delegateFactory(async () => new Promise(() => {})),
	});
	const controller = new AbortController();
	const pending = execute(tool, process.cwd(), { pattern: "cancel" }, controller.signal);
	setTimeout(() => controller.abort(), 10);
	await assert.rejects(pending, /Grep aborted/);
});

test("rejects invalid configured and explicit timeouts", async () => {
	assert.throws(() => createSafeGrepToolDefinition({ defaultTimeoutSeconds: 0 }), /Invalid grep timeout/);
	const tool = createSafeGrepToolDefinition();
	await assert.rejects(execute(tool, process.cwd(), { pattern: "x", timeout: Number.POSITIVE_INFINITY }), /Invalid grep timeout/);
	await assert.rejects(execute(tool, process.cwd(), { pattern: "x", timeout: null }), /Invalid grep timeout/);
});
