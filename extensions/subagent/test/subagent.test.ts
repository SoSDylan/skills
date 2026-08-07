import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

interface RegisteredTool {
	name: string;
	description: string;
	parameters?: any;
	promptGuidelines?: string[];
	renderShell?: string;
	renderResult?: (...args: any[]) => any;
	execute: (...args: any[]) => Promise<any>;
}

interface RegisteredCommand {
	handler: (args: string, ctx: any) => Promise<void>;
}

async function makeFakePi(root: string): Promise<{ command: string; logPath: string }> {
	const command = join(root, "fake-pi.mjs");
	const logPath = join(root, "calls.jsonl");
	await writeFile(
		command,
		`#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
const args = process.argv.slice(2);
const systemPromptIndex = args.indexOf("--append-system-prompt");
const systemPrompt = systemPromptIndex >= 0 ? await readFile(args[systemPromptIndex + 1], "utf8") : "";
const prompt = args.at(-1);
const log = (event) => appendFile(process.env.PI_SUBAGENT_TEST_LOG, JSON.stringify({ event, prompt, args, cwd: process.cwd(), depth: process.env.PI_SUBAGENT_DEPTH, systemPrompt }) + "\\n");
await log("start");
if (prompt.includes("[SLOW]")) await new Promise((resolve) => setTimeout(resolve, 300));
if (prompt.includes("[TICK]")) await new Promise((resolve) => setTimeout(resolve, 1150));
if (prompt.includes("[FAIL]")) {
  console.error("fake child failure");
  await log("end");
  process.exit(2);
}
const text = prompt.includes("[LARGE]")
  ? "line of output\\n".repeat(6000)
  : prompt.includes("[UTF8]")
    ? "café"
  : prompt.includes("[LONG_LINE]")
    ? "x".repeat(300)
  : prompt.includes("[ENTRY_TAIL]")
    ? Array.from({ length: 100 }, (_, index) => "assistant tail " + (index + 1)).join("\\n")
  : prompt.includes("[LINES_MANY]")
    ? Array.from({ length: 1_200 }, (_, index) => "activity line " + (index + 1)).join("\\n")
  : prompt.includes("[LINES]")
    ? "line 1\\nline 2\\nline 3\\nline 4\\nline 5\\nline 6\\nline 7\\nline 8\\nline 9\\nline 10"
    : "child:" + prompt;
const message = {
  role: "assistant",
  content: [{ type: "text", text }],
  api: "anthropic-messages",
  provider: "test",
  model: "child-model",
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 } },
  stopReason: prompt.includes("[MODEL_ERROR]") ? "error" : "stop",
  errorMessage: prompt.includes("[MODEL_ERROR]") ? "provider failed" : undefined,
  timestamp: Date.now()
};
console.log(JSON.stringify({ type: "session", version: 3, id: "fake", timestamp: new Date().toISOString(), cwd: process.cwd() }));
if (prompt.includes("[STREAM]")) {
  console.log(JSON.stringify({
    type: "message_update",
    message: { ...message, content: [{ type: "text", text: "Inspecting files" }] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Inspecting files", partial: { ...message, content: [{ type: "text", text: "Inspecting files" }] } }
  }));
}
if (prompt.includes("[MANY_MESSAGES]")) {
  for (let index = 0; index < 20; index += 1) {
    console.log(JSON.stringify({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "message-" + index,
        toolName: "read",
        content: [{ type: "text", text: "tool payload ".repeat(1000) }],
        isError: false,
        timestamp: Date.now()
      }
    }));
  }
}
if (prompt.includes("[STDERR_LARGE]")) console.error("diagnostic ".repeat(10000));
if (prompt.includes("[ENTRY_TAIL]")) {
  const toolText = Array.from({ length: 1_450 }, (_, index) => "tool tail " + (index + 1)).join("\\n");
  console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "tail-tool", toolName: "read", args: { path: "tail.txt" } }));
  console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "tail-tool", toolName: "read", result: { content: [{ type: "text", text: toolText }] }, isError: false }));
}
if (prompt.includes("[MEDIUM_TOOL]")) {
  console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "medium-tool", toolName: "write", args: { path: "medium.txt", content: "m".repeat(7000) } }));
  console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "medium-tool", toolName: "write", result: { content: [{ type: "text", text: "written" }] }, isError: false }));
}
if (prompt.includes("[HUGE_TOOL]")) {
  console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "huge-tool", toolName: "write", args: { path: "large.txt", content: "a".repeat(50000) } }));
  console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "huge-tool", toolName: "write", result: { content: [{ type: "text", text: "b".repeat(50000) }] }, isError: false }));
}
if (prompt.includes("[MANY]")) {
  for (let index = 0; index < 600; index += 1) {
    console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "many-" + index, toolName: "read", args: { path: "src/file-" + index + ".ts" } }));
    console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "many-" + index, toolName: "read", result: { content: [{ type: "text", text: "line " + index }] }, isError: false }));
  }
}
if (prompt.includes("[ACTIVITY]")) {
  console.log(JSON.stringify({
    type: "message_update",
    message: { ...message, content: [{ type: "thinking", thinking: "Checking assumptions" }] },
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Checking assumptions", partial: { ...message, content: [{ type: "thinking", thinking: "Checking assumptions" }] } }
  }));
  console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "src/auth.ts" } }));
  console.log(JSON.stringify({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "read", args: { path: "src/auth.ts" }, partialResult: { content: [{ type: "text", text: "partial file" }], details: { lines: 1 } } }));
  console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: { content: [{ type: "text", text: "complete file" }], details: { lines: 1 } }, isError: false }));
  console.log(JSON.stringify({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "rate limited" }));
  console.error("child diagnostic");
}
if (prompt.includes("[UTF8]")) {
  const encoded = Buffer.from(JSON.stringify({ type: "message_end", message }) + "\\n", "utf8");
  const splitAt = encoded.indexOf(Buffer.from("é", "utf8")) + 1;
  process.stdout.write(encoded.subarray(0, splitAt));
  await new Promise((resolve) => setTimeout(resolve, 10));
  process.stdout.write(encoded.subarray(splitAt));
} else {
  console.log(JSON.stringify({ type: "message_end", message }));
}
await log("end");
`,
		{ mode: 0o700 },
	);
	await chmod(command, 0o700);
	return { command, logPath };
}

async function readLog(logPath: string): Promise<any[]> {
	const content = await readFile(logPath, "utf8").catch(() => "");
	return content
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function withFakePi(run: (fixture: { root: string; logPath: string }) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-subagent-test-"));
	const previousCommand = process.env.PI_SUBAGENT_PI_COMMAND;
	const previousLog = process.env.PI_SUBAGENT_TEST_LOG;
	try {
		const fake = await makeFakePi(root);
		process.env.PI_SUBAGENT_PI_COMMAND = fake.command;
		process.env.PI_SUBAGENT_TEST_LOG = fake.logPath;
		await run({ root, logPath: fake.logPath });
	} finally {
		if (previousCommand === undefined) delete process.env.PI_SUBAGENT_PI_COMMAND;
		else process.env.PI_SUBAGENT_PI_COMMAND = previousCommand;
		if (previousLog === undefined) delete process.env.PI_SUBAGENT_TEST_LOG;
		else process.env.PI_SUBAGENT_TEST_LOG = previousLog;
		await rm(root, { recursive: true, force: true });
	}
}

function loadExtensionWithCommands() {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	extension({
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		on() {},
		getThinkingLevel() {
			return "high";
		},
	} as any);
	return { tools, commands };
}

function loadExtension() {
	return loadExtensionWithCommands().tools.get("subagent");
}

function makeContext(cwd: string) {
	return {
		cwd,
		model: { provider: "test", id: "parent-model", contextWindow: 272_000 },
		modelRegistry: {
			find: (provider: string, id: string) =>
				provider === "test"
					? { provider, id, contextWindow: id === "profile-model" ? 128_000 : 272_000 }
					: undefined,
		},
	};
}

function oneTask(prompt: string, capability?: "read-only" | "write") {
	return { tasks: [{ label: "Task", prompt, ...(capability ? { capability } : {}) }] };
}

test("parent can delegate one labeled task", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-subagent-test-"));
	const previousCommand = process.env.PI_SUBAGENT_PI_COMMAND;
	const previousLog = process.env.PI_SUBAGENT_TEST_LOG;

	try {
		const fake = await makeFakePi(root);
		process.env.PI_SUBAGENT_PI_COMMAND = fake.command;
		process.env.PI_SUBAGENT_TEST_LOG = fake.logPath;
		const tool = loadExtension();
		assert.ok(tool);
		assert.match(tool.description, /isolated/i);
		assert.ok(tool.promptGuidelines?.some((line) => line.includes("cannot see the parent conversation")));

		assert.deepEqual(tool.parameters?.required, ["tasks"]);
		assert.deepEqual(tool.parameters?.properties.tasks.items.required, ["label", "prompt"]);
		const result = await tool.execute("call-1", oneTask("Inspect src/auth.ts"), undefined, undefined, makeContext(root));
		assert.match(result.content[0].text, /## Task — completed\n\nchild:Inspect src\/auth\.ts/);
		assert.equal(result.details.results[0].capability, "read-only");
		assert.equal(result.details.results[0].thinkingLevel, "high");
		assert.equal(result.details.results[0].contextWindow, 272_000);
		assert.equal(result.details.results[0].usage.contextTokens, 15);
		assert.deepEqual(result.usage, {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
		});

		const call = (await readLog(fake.logPath)).find((entry) => entry.event === "start");
		assert.ok(call);
		assert.equal(call.cwd, await realpath(root));
		assert.equal(call.depth, "1");
		assert.match(call.systemPrompt, /isolated subagent/i);
		assert.deepEqual(call.args.slice(0, 9), [
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--no-extensions",
			"--model",
			"test/parent-model",
			"--thinking",
			"high",
		]);
		assert.ok(call.args.includes("read,grep,find,ls"));
		assert.ok(!call.args.includes("bash"));
	} finally {
		if (previousCommand === undefined) delete process.env.PI_SUBAGENT_PI_COMMAND;
		else process.env.PI_SUBAGENT_PI_COMMAND = previousCommand;
		if (previousLog === undefined) delete process.env.PI_SUBAGENT_TEST_LOG;
		else process.env.PI_SUBAGENT_TEST_LOG = previousLog;
		await rm(root, { recursive: true, force: true });
	}
});

test("a configured task profile selects its model and thinking level", async () => {
	await withFakePi(async ({ root, logPath }) => {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "subagents.json"),
			JSON.stringify({ profiles: { focused: { model: "test/profile-model", thinkingLevel: "low" } } }),
		);
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const tool = loadExtension();
			assert.ok(tool);
			const result = await tool.execute(
			"profile",
			{ tasks: [{ label: "Focused", prompt: "inspect", profile: "focused" }] },
			undefined,
			undefined,
			makeContext(root),
		);
			assert.match(result.content[0].text, /child:inspect/);
			assert.equal(result.details.results[0].thinkingLevel, "low");
			assert.equal(result.details.results[0].contextWindow, 128_000);

			const call = (await readLog(logPath)).find((entry) => entry.event === "start");
			assert.ok(call);
			assert.ok(call.args.includes("test/profile-model"));
			assert.ok(call.args.includes("--thinking"));
			assert.ok(call.args.includes("low"));
		} finally {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});
});

test("/subagents can add and remove profiles", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-subagent-profile-test-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	try {
		const { commands } = loadExtensionWithCommands();
		const command = commands.get("subagents");
		assert.ok(command);
		const selections = ["Add profile", "Save", "Done"];
		const inputs = ["custom"];
		const notifications: string[] = [];
		const context = {
			cwd: root,
			mode: "tui",
			hasUI: true,
			modelRegistry: { getAll: () => [] },
			ui: {
				select: async (_title: string, options: string[]) => {
					const selected = selections.shift();
					assert.ok(selected && options.includes(selected), `unexpected selection: ${selected}`);
					return selected;
				},
				input: async () => inputs.shift(),
				confirm: async () => true,
				notify: (message: string) => notifications.push(message),
			},
		};

		await command.handler("", context);
		const configPath = join(root, "agent", "subagents.json");
		let saved = JSON.parse(await readFile(configPath, "utf8"));
		assert.deepEqual(saved.profiles.custom, {});

		selections.push("Remove profile", "custom", "Done");
		await command.handler("", context);
		saved = JSON.parse(await readFile(configPath, "utf8"));
		assert.equal(saved.profiles.custom, undefined);
		assert.ok(notifications.some((message) => /Added subagent profile/.test(message)));
		assert.ok(notifications.some((message) => /Removed subagent profile/.test(message)));
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(root, { recursive: true, force: true });
	}
});

test("child JSON events preserve UTF-8 characters split across output chunks", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"utf8",
			oneTask("[UTF8] return text"),
			undefined,
			undefined,
			makeContext(root),
		);

		assert.match(result.content[0].text, /café/);
	});
});

test("parent receives streamed child prose through structured activity updates", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);
		const updates: any[] = [];

		const result = await tool.execute(
			"stream",
			oneTask("[STREAM] inspect the project"),
			undefined,
			(update: any) => updates.push(update),
			makeContext(root),
		);

		const streaming = updates.find((update) =>
			update.details.results[0].activity?.some(
				(entry: any) => entry.kind === "assistant" && entry.text === "Inspecting files" && entry.status === "running",
			),
		);
		assert.ok(streaming, "expected a running assistant activity update");
		assert.equal(streaming.details.results[0].status, "running");
		assert.match(result.content[0].text, /child:\[STREAM\] inspect the project/);
	});
});

test("collapsed rendering shows each completed child's full final response", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool?.renderResult);
		const result = await tool.execute(
			"cards",
			{
				tasks: [
					{ label: "Files", prompt: "[LINES] inspect files" },
					{ label: "Tests", prompt: "inspect tests", capability: "write" },
				],
			},
			undefined,
			undefined,
			makeContext(root),
		);
		const theme = {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		initTheme();
		const component = tool.renderResult(result, { expanded: false }, theme);
		const rendered = component.render(100).join("\n");

		assert.equal(tool.renderShell, "self");
		assert.match(rendered, /Files · read-only · complete · \d[^\n]*\n[^\S\r\n]*\n[^\S\r\n]*line 1/);
		assert.match(rendered, /Tests · write · complete · \d/);
		assert.ok(rendered.indexOf("Files") < rendered.indexOf("Tests"));
		for (let line = 1; line <= 10; line += 1) assert.match(rendered, new RegExp(`line ${line}`));
		assert.match(rendered, /Ctrl\+O|activity/i);
		assert.match(rendered, /1 turn ↑10 ↓5 \$0\.3000 0\.0%\/272k child-model • high/);
	});
});

test("collapsed cards retain long completed output and keep header metadata together", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool?.renderResult);
		const result = await tool.execute(
			"visual-lines",
			{
				tasks: [
					{
						label: "A very long child label that must not push metadata onto another line",
						prompt: "[LONG_LINE] inspect",
					},
				],
			},
			undefined,
			undefined,
			makeContext(root),
		);
		const theme = {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		initTheme();
		const renderedLines = tool.renderResult(result, { expanded: false }, theme).render(60);

		assert.equal(renderedLines.filter((line: string) => line.includes("read-only") || line.includes("complete")).length, 1);
		assert.equal(renderedLines.join("\n").match(/x/g)?.length, 300);
	});
});

test("expanded child cards show the prompt, full structured timeline, and usage footer", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool?.renderResult);
		const result = await tool.execute(
			"expanded",
			oneTask("[ACTIVITY] inspect auth", "read-only"),
			undefined,
			undefined,
			makeContext(root),
		);
		const theme = {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		initTheme();
		const component = tool.renderResult(result, { expanded: true }, theme);
		const rendered = component.render(100).join("\n");

		assert.match(rendered, /Task · read-only · complete · \d/);
		assert.match(rendered, /Prompt.*\[ACTIVITY\] inspect auth/s);
		assert.match(rendered, /thinking: Checking assumptions/);
		assert.match(rendered, /✓ read src\/auth\.ts · 1 line · \d+ms/);
		assert.doesNotMatch(rendered, /complete file/);
		assert.doesNotMatch(rendered, /args|result:/);
		assert.match(rendered, /Retry 1\/3: rate limited/);
		assert.match(rendered, /stderr: child diagnostic/);
		assert.match(rendered, /1 turn ↑10 ↓5 \$0\.3000 0\.0%\/272k child-model • high/);
		assert.doesNotMatch(rendered, /isolated subagent/i);
	});
});

test("tool activity renders as compact command-log rows with tool-specific summaries", () => {
	const tool = loadExtension();
	assert.ok(tool?.renderResult);
	initTheme();
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
	const startedAt = Date.now() - 100;
	const finishedAt = startedAt + 80;
	const result = (text: string, details?: unknown) => ({
		content: [{ type: "text", text }],
		details,
	});
	const activity = [
		{
			id: "read",
			kind: "tool",
			toolName: "read",
			args: { path: "src/auth.ts", offset: 10, limit: 5 },
			result: result("one\ntwo\nthree\nfour\nfive"),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "grep",
			kind: "tool",
			toolName: "grep",
			args: { pattern: "createSession", path: "src", glob: "*.ts" },
			result: result("src/a.ts:1: createSession()\nsrc/b.ts:2: createSession()"),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "find",
			kind: "tool",
			toolName: "find",
			args: { pattern: "*.test.ts", path: "src" },
			result: result("src/a.test.ts\nsrc/b.test.ts"),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "ls",
			kind: "tool",
			toolName: "ls",
			args: { path: "src/auth" },
			result: result("index.ts\nsession.ts"),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "bash-ok",
			kind: "tool",
			toolName: "bash",
			args: { command: "npm test -- auth" },
			result: result("12 tests passed"),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "edit",
			kind: "tool",
			toolName: "edit",
			args: { path: "src/auth.ts", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] },
			result: result("Updated src/auth.ts", { patch: "--- a/src/auth.ts\n+++ b/src/auth.ts\n-a\n+b\n-c\n+d" }),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "write",
			kind: "tool",
			toolName: "write",
			args: { path: "src/generated.ts", content: "one\ntwo\nthree" },
			result: result("Wrote src/generated.ts"),
			status: "complete",
			timestamp: startedAt,
			finishedAt,
		},
		{
			id: "bash-fail",
			kind: "tool",
			toolName: "bash",
			args: { command: "npm test" },
			result: result("FAIL auth.test.ts\nCommand exited with code 1"),
			status: "failed",
			isError: true,
			timestamp: startedAt,
			finishedAt,
		},
	];
	const details = {
		results: [
			{
				label: "Tool formats",
				prompt: "Inspect the tools",
				capability: "write",
				status: "running",
				exitCode: -1,
				messages: [],
				activity,
				activityTruncation: { omittedEntries: 0, omittedLines: 0, omittedBytes: 0 },
				stderr: "",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					turns: 0,
				},
				aborted: false,
			},
		],
	};
	const toolResult = { content: [{ type: "text", text: "running" }], details };
	const collapsed = tool.renderResult(toolResult, { expanded: false }, theme).render(180).join("\n");

	assert.match(collapsed, /Tool formats · write · running · \d[^\n]*\n[^\S\r\n]*\n[^\S\r\n]*✓ read/);
	assert.match(collapsed, /✓ read src\/auth\.ts:10-14 · 5 lines · 80ms/);
	assert.match(collapsed, /✓ grep \/createSession\/ in src · 2 matches · 80ms/);
	assert.match(collapsed, /✓ find \*\.test\.ts in src · 2 files · 80ms/);
	assert.match(collapsed, /✓ list src\/auth · 2 entries · 80ms/);
	assert.match(collapsed, /✓ \$ npm test -- auth · 80ms/);
	assert.match(collapsed, /✓ edit src\/auth\.ts · 2 replacements · \+2 −2 · 80ms/);
	assert.match(collapsed, /✓ write src\/generated\.ts · 3 lines · 80ms/);
	assert.match(collapsed, /✗ \$ npm test · exit 1 · 80ms/);
	assert.doesNotMatch(collapsed, /oldText|newText|12 tests passed|Command exited/);

	const hiddenTranscript = tool
		.renderResult(
			{
				content: [{ type: "text", text: "running" }],
				details: {
					results: [{ ...details.results[0], activity: [...activity, { ...activity[0], id: "read-extra" }] }],
				},
			},
			{ expanded: false },
			theme,
		)
		.render(180)
		.join("\n");
	assert.match(hiddenTranscript, /Tool formats · write · running · \d[^\n]*\n[^\S\r\n]*… earlier transcript content hidden/);

	const expanded = tool.renderResult(toolResult, { expanded: true }, theme).render(180).join("\n");
	assert.match(expanded, /command.*npm test -- auth/s);
	assert.match(expanded, /output.*12 tests passed/s);
	assert.match(expanded, /error output.*FAIL auth\.test\.ts/s);
	assert.doesNotMatch(expanded, /one\ntwo\nthree\nfour\nfive/);

	const narrowRows = tool.renderResult(toolResult, { expanded: false }, theme).render(40);
	assert.equal(narrowRows.filter((line: string) => /[✓✗]/.test(line)).length, 8);
});

test("tool summaries handle context matches, empty results, notices, and images", () => {
	const tool = loadExtension();
	assert.ok(tool?.renderResult);
	initTheme();
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
	const timestamp = Date.now();
	const toolResult = (content: unknown[], details?: unknown) => ({ content, details });
	const activity = [
		{
			id: "grep-context",
			kind: "tool",
			toolName: "grep",
			args: { pattern: "auth", path: "src", context: 1 },
			result: toolResult([
				{
					type: "text",
					text: "src/a.ts-9- before\nsrc/a.ts:10: auth()\nsrc/a.ts-11- after\nsrc/b.ts:20: auth()\n\n[2 matches limit reached]",
				},
			], { matchLimitReached: 2 }),
			status: "complete",
			timestamp,
			finishedAt: timestamp,
		},
		{
			id: "find-empty",
			kind: "tool",
			toolName: "find",
			args: { pattern: "*.missing", path: "src" },
			result: toolResult([{ type: "text", text: "No files found matching pattern" }]),
			status: "complete",
			timestamp,
			finishedAt: timestamp,
		},
		{
			id: "ls-empty",
			kind: "tool",
			toolName: "ls",
			args: { path: "empty" },
			result: toolResult([{ type: "text", text: "(empty directory)" }]),
			status: "complete",
			timestamp,
			finishedAt: timestamp,
		},
		{
			id: "read-image",
			kind: "tool",
			toolName: "read",
			args: { path: "assets/logo.png" },
			result: toolResult([
				{ type: "text", text: "Read image file [image/png]" },
				{ type: "image", data: "base64", mimeType: "image/png" },
			]),
			status: "complete",
			timestamp,
			finishedAt: timestamp,
		},
	] as any[];
	const details = {
		results: [
			{
				label: "Edge formats",
				prompt: "Inspect edge formats",
				capability: "read-only",
				status: "running",
				exitCode: -1,
				messages: [],
				activity,
				activityTruncation: { omittedEntries: 0, omittedLines: 0, omittedBytes: 0 },
				stderr: "",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					turns: 0,
				},
				aborted: false,
			},
		],
	};
	const rendered = tool
		.renderResult({ content: [{ type: "text", text: "running" }], details }, { expanded: false }, theme)
		.render(160)
		.join("\n");

	assert.match(rendered, /grep \/auth\/ in src · 2 matches · 0ms · truncated/);
	assert.match(rendered, /find \*\.missing in src · 0 files · 0ms/);
	assert.match(rendered, /list empty · 0 entries · 0ms/);
	assert.match(rendered, /read assets\/logo\.png · image · 0ms/);
});


test("child activity is bounded and reports omitted transcript entries", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		let updateCount = 0;
		const result = await tool.execute(
			"many",
			oneTask("[MANY] inspect many files"),
			undefined,
			() => {
				updateCount += 1;
			},
			makeContext(root),
		);
		const child = result.details.results[0];

		assert.ok(updateCount < 100, `expected coalesced updates, received ${updateCount}`);
		assert.ok(child.activity.length < 600);
		assert.ok(child.activityTruncation.omittedEntries > 0);
		assert.ok(Buffer.byteLength(JSON.stringify(child.activity), "utf8") <= 64 * 1024);
		assert.ok(child.activity.some((entry: any) => entry.kind === "assistant" && /child:\[MANY\]/.test(entry.text)));
	});
});

test("raw child details stay bounded while the complete final response is preserved", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"bounded-details",
			oneTask("[MANY_MESSAGES] [STDERR_LARGE] inspect"),
			undefined,
			undefined,
			makeContext(root),
		);
		const child = result.details.results[0];

		assert.equal(child.messages.length, 1);
		assert.equal(child.messages[0].role, "assistant");
		assert.match(result.content[0].text, /child:\[MANY_MESSAGES\] \[STDERR_LARGE\] inspect/);
		assert.ok(Buffer.byteLength(child.stderr, "utf8") <= 64 * 1024);
	});
});

test("transcript retention keeps the latest lines from a partially evicted entry", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"entry-tail",
			oneTask("[ENTRY_TAIL] inspect"),
			undefined,
			undefined,
			makeContext(root),
		);
		const child = result.details.results[0];
		const toolActivity = child.activity.find((entry: any) => entry.kind === "tool");

		assert.ok(toolActivity, "expected the retained tail of the tool entry");
		assert.match(JSON.stringify(toolActivity.result), /tool tail 1450/);
		assert.doesNotMatch(JSON.stringify(toolActivity.result), /tool tail 1(?:\\n|\\")/);
		assert.ok(child.activityTruncation.omittedLines >= 450);
	});
});

test("tool arguments remain complete when the whole transcript fits within the child limit", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"medium-tool",
			oneTask("[MEDIUM_TOOL] write output"),
			undefined,
			undefined,
			makeContext(root),
		);
		const toolActivity = result.details.results[0].activity.find((entry: any) => entry.kind === "tool");

		assert.equal(toolActivity.args.content.length, 7_000);
		assert.equal(toolActivity.args.transcriptTruncated, undefined);
	});
});

test("large tool arguments and results are bounded with explicit transcript truncation", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"huge-tool",
			oneTask("[HUGE_TOOL] write output"),
			undefined,
			undefined,
			makeContext(root),
		);
		const child = result.details.results[0];

		assert.ok(Buffer.byteLength(JSON.stringify(child.activity), "utf8") <= 64 * 1024);
		assert.ok(child.activityTruncation.omittedBytes > 0);
		assert.ok(child.activity.some((entry: any) => entry.kind === "tool" && entry.toolName === "write"));

		assert.ok(tool.renderResult);
		initTheme();
		const theme = {
			fg: (_color: string, text: string) => text,
			bg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		const rendered = tool.renderResult(result, { expanded: true }, theme).render(100).join("\n");
		assert.match(rendered, /transcript truncated/i);
	});
});

test("a single large activity keeps its latest 1,000 lines and preserves the full final message", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"many-lines",
			oneTask("[LINES_MANY] produce transcript"),
			undefined,
			undefined,
			makeContext(root),
		);
		const child = result.details.results[0];
		const assistant = child.activity.find((entry: any) => entry.kind === "assistant");

		assert.ok(assistant.text.split("\n").length <= 1_000);
		assert.doesNotMatch(assistant.text, /activity line 1(?:\n|$)/);
		assert.match(assistant.text, /activity line 1200/);
		assert.ok(child.activityTruncation.omittedLines >= 200);
		assert.match(child.messages[0].content[0].text, /activity line 1\n/);
	});
});

test("running child status includes elapsed-time refreshes", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);
		const updates: any[] = [];

		const result = await tool.execute(
			"elapsed",
			oneTask("[TICK] wait for work"),
			undefined,
			(update: any) => updates.push(structuredClone(update)),
			makeContext(root),
		);
		const child = result.details.results[0];
		const runningUpdates = updates.filter((update) => update.details.results[0].status === "running");

		assert.ok(runningUpdates.length >= 2, "expected a start update and an elapsed-time refresh");
		assert.equal(child.status, "complete");
		assert.ok(child.finishedAt - child.startedAt >= 1_000);
	});
});

test("parent receives thinking, tool lifecycle, retry, and stderr activity", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"activity",
			oneTask("[ACTIVITY] inspect auth"),
			undefined,
			undefined,
			makeContext(root),
		);
		const activity = result.details.results[0].activity;

		assert.ok(
			activity.some(
				(entry: any) => entry.kind === "thinking" && entry.text === "Checking assumptions" && entry.status === "complete",
			),
		);
		const toolActivity = activity.find((entry: any) => entry.kind === "tool");
		assert.deepEqual(toolActivity, {
			id: "tool-1",
			kind: "tool",
			toolName: "read",
			args: { path: "src/auth.ts" },
			result: { content: [{ type: "text", text: "complete file" }], details: { lines: 1 } },
			status: "complete",
			isError: false,
			timestamp: toolActivity.timestamp,
			finishedAt: toolActivity.finishedAt,
		});
		assert.ok(toolActivity.finishedAt >= toolActivity.timestamp);
		assert.ok(activity.some((entry: any) => entry.kind === "lifecycle" && /retry 1\/3.*rate limited/i.test(entry.text)));
		assert.ok(activity.some((entry: any) => entry.kind === "stderr" && /child diagnostic/.test(entry.text)));
	});
});

test("parent can run independent handoffs in parallel with bounded concurrency", async () => {
	await withFakePi(async ({ root, logPath }) => {
		const tool = loadExtension();
		assert.ok(tool);
		const tasks = Array.from({ length: 6 }, (_, index) => ({
			label: `Review ${index + 1}`,
			prompt: `[SLOW] task ${index + 1}`,
		}));

		const result = await tool.execute("parallel", { tasks }, undefined, undefined, makeContext(root));
		assert.equal(result.details.results.length, 6);
		assert.equal(result.usage.input, 60);
		assert.equal(result.usage.cost.total, 1.8);
		assert.match(result.content[0].text, /## Review 1 — completed/);
		assert.match(result.content[0].text, /child:\[SLOW\] task 6/);

		let active = 0;
		let maximum = 0;
		for (const entry of await readLog(logPath)) {
			active += entry.event === "start" ? 1 : -1;
			maximum = Math.max(maximum, active);
		}
		assert.equal(active, 0);
		assert.equal(maximum, 4);
	});
});

test("write capability explicitly enables mutation tools", async () => {
	await withFakePi(async ({ root, logPath }) => {
		const tool = loadExtension();
		assert.ok(tool);
		await tool.execute(
			"write",
			oneTask("Implement the approved change", "write"),
			undefined,
			undefined,
			makeContext(root),
		);
		const call = (await readLog(logPath)).find((entry) => entry.event === "start");
		assert.ok(call.args.includes("read,grep,find,ls,bash,edit,write"));
	});
});

test("model failures produce a failed child state", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);

		const result = await tool.execute(
			"model-error",
			oneTask("[MODEL_ERROR] inspect auth"),
			undefined,
			undefined,
			makeContext(root),
		);

		assert.equal(result.details.results[0].status, "failed");
		assert.match(result.content[0].text, /provider failed/);
		assert.ok(
			result.details.results[0].activity.some(
				(entry: any) => entry.kind === "lifecycle" && entry.status === "failed" && /provider failed/.test(entry.text),
			),
		);
	});
});

test("aborting the parent terminates an active child", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 75);
		const started = Date.now();
		const result = await tool.execute(
			"abort",
			oneTask("[SLOW] keep working"),
			controller.signal,
			undefined,
			makeContext(root),
		);
		assert.equal(result.details.results[0].aborted, true);
		assert.equal(result.details.results[0].status, "cancelled");
		assert.match(result.content[0].text, /aborted/i);
		assert.ok(Date.now() - started < 2_000);
	});
});

test("cancelling parallel work does not start queued children", async () => {
	await withFakePi(async ({ root, logPath }) => {
		const tool = loadExtension();
		assert.ok(tool);
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 75);

		const result = await tool.execute(
			"parallel-abort",
			{
				tasks: Array.from({ length: 6 }, (_, index) => ({
					label: `Task ${index + 1}`,
					prompt: `[SLOW] task ${index + 1}`,
				})),
			},
			controller.signal,
			undefined,
			makeContext(root),
		);

		assert.ok(result.details.results.every((child: any) => child.status === "cancelled"));
		assert.ok(result.details.results.filter((child: any) => child.startedAt !== undefined).length <= 4);
		const starts = (await readLog(logPath)).filter((entry) => entry.event === "start");
		assert.ok(starts.length <= 4, `expected at most four starts, received ${starts.length}`);
	});
});

test("model-visible output is truncated while full output stays in details", async () => {
	await withFakePi(async ({ root }) => {
		const tool = loadExtension();
		assert.ok(tool);
		const result = await tool.execute("large", oneTask("[LARGE]"), undefined, undefined, makeContext(root));
		assert.match(result.content[0].text, /output truncated/i);
		assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 50 * 1024);
		assert.ok(result.content[0].text.split("\n").length <= 2_000);
		assert.ok(result.details.results[0].messages[0].content[0].text.length > result.content[0].text.length);
	});
});

test("tool rejects recursive delegation", async () => {
	const tool = loadExtension();
	assert.ok(tool);

	const previousDepth = process.env.PI_SUBAGENT_DEPTH;
	process.env.PI_SUBAGENT_DEPTH = "1";
	try {
		await assert.rejects(
			tool.execute("recursive", oneTask("recurse"), undefined, undefined, makeContext(process.cwd())),
			/cannot delegate/i,
		);
	} finally {
		if (previousDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = previousDepth;
	}
});
