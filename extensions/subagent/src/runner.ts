import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Message, StopReason, Usage } from "@earendil-works/pi-ai";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Capability } from "./capabilities.ts";
import { toolsForCapability } from "./capabilities.ts";

const SUBAGENT_SYSTEM_PROMPT = `You are an isolated subagent. Complete only the delegated task. You cannot ask the user questions. Return a concise, evidence-based result to the parent agent.`;
const DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const COMMAND_ENV = "PI_SUBAGENT_PI_COMMAND";
const MAX_ACTIVITY_LINES = 1000;
const MAX_ACTIVITY_BYTES = 64 * 1024;
const UPDATE_INTERVAL_MS = 50;

export interface UsageStats extends Usage {
	turns: number;
	contextTokens?: number;
}

export function emptyUsageStats(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		turns: 0,
	};
}

export type SubagentStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

interface ActivityBase {
	id: string;
	status: "running" | "complete" | "failed";
	timestamp: number;
}

export interface SubagentTextActivity extends ActivityBase {
	kind: "assistant" | "thinking" | "lifecycle" | "stderr";
	text: string;
	omittedLines?: number;
	omittedBytes?: number;
}

export interface SubagentToolActivity extends ActivityBase {
	kind: "tool";
	toolName: string;
	args: unknown;
	result?: unknown;
	isError?: boolean;
	finishedAt?: number;
	argsOmittedLines?: number;
	argsOmittedBytes?: number;
	resultOmittedLines?: number;
	resultOmittedBytes?: number;
}

export type SubagentActivityEntry = SubagentTextActivity | SubagentToolActivity;

export interface ActivityTruncation {
	omittedEntries: number;
	omittedLines: number;
	omittedBytes: number;
}

export interface SubagentRunResult {
	label?: string;
	prompt: string;
	capability: Capability;
	status: SubagentStatus;
	startedAt?: number;
	finishedAt?: number;
	exitCode: number;
	messages: Message[];
	activity: SubagentActivityEntry[];
	activityTruncation: ActivityTruncation;
	stderr: string;
	usage: UsageStats;
	contextWindow?: number;
	model?: string;
	thinkingLevel?: string;
	stopReason?: StopReason;
	errorMessage?: string;
	aborted: boolean;
}

export interface RunSubagentOptions {
	label?: string;
	prompt: string;
	capability: Capability;
	cwd: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	contextWindow?: number;
	signal?: AbortSignal;
	onUpdate?: (result: SubagentRunResult) => void;
}

function initialResult(options: RunSubagentOptions): SubagentRunResult {
	return {
		label: options.label,
		prompt: options.prompt,
		capability: options.capability,
		status: "running",
		exitCode: -1,
		messages: [],
		activity: [],
		activityTruncation: { omittedEntries: 0, omittedLines: 0, omittedBytes: 0 },
		stderr: "",
		usage: emptyUsageStats(),
		contextWindow: options.contextWindow,
		model: options.model?.id,
		thinkingLevel: options.thinkingLevel,
		aborted: false,
	};
}

function invocation(args: string[]): { command: string; args: string[] } {
	const override = process.env[COMMAND_ENV];
	if (override) return { command: override, args };

	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const executable = basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable)) return { command: process.execPath, args };
	return { command: "pi", args };
}

function activityMetrics(entry: SubagentActivityEntry): { lines: number; bytes: number } {
	const serialized = JSON.stringify(entry);
	const display =
		entry.kind === "tool"
			? `${entry.toolName}\n${formatActivityValue(entry.args)}${entry.result === undefined ? "" : `\n${formatActivityValue(entry.result)}`}`
			: entry.text;
	return {
		lines: display.split("\n").length,
		bytes: Buffer.byteLength(serialized, "utf8"),
	};
}

function truncateTextTail(text: string, maxLines: number, maxBytes: number): { text: string; lines: number; bytes: number } {
	const originalLines = text.split("\n");
	let retained = originalLines.slice(-maxLines).join("\n");
	const omittedLines = Math.max(0, originalLines.length - maxLines);
	const originalBytes = Buffer.byteLength(text, "utf8");
	let retainedBytes = Buffer.byteLength(retained, "utf8");
	if (retainedBytes > maxBytes) {
		const buffer = Buffer.from(retained, "utf8");
		retained = buffer.subarray(buffer.length - maxBytes).toString("utf8").replace(/^�/, "");
		retainedBytes = Buffer.byteLength(retained, "utf8");
	}
	return { text: retained, lines: omittedLines, bytes: originalBytes - retainedBytes };
}

function boundTextActivity(result: SubagentRunResult, entry: SubagentTextActivity): void {
	result.activityTruncation.omittedLines -= entry.omittedLines ?? 0;
	result.activityTruncation.omittedBytes -= entry.omittedBytes ?? 0;
	entry.omittedLines = 0;
	entry.omittedBytes = 0;
	const truncated = truncateTextTail(entry.text, MAX_ACTIVITY_LINES, 60 * 1024);
	entry.text = truncated.text;
	entry.omittedLines = truncated.lines;
	entry.omittedBytes = truncated.bytes;
	result.activityTruncation.omittedLines += truncated.lines;
	result.activityTruncation.omittedBytes += truncated.bytes;
}

function trimActivity(result: SubagentRunResult): void {
	let metrics = result.activity.map(activityMetrics);
	let lines = metrics.reduce((total, item) => total + item.lines, 0);
	let bytes = metrics.reduce((total, item) => total + item.bytes, 2 + Math.max(0, result.activity.length - 1));

	while (result.activity.length > 0 && (lines > MAX_ACTIVITY_LINES || bytes > MAX_ACTIVITY_BYTES)) {
		const first = result.activity[0];
		const firstMetrics = metrics[0];
		const targetLines = Math.max(1, firstMetrics.lines - Math.max(0, lines - MAX_ACTIVITY_LINES));
		const targetBytes = Math.max(256, firstMetrics.bytes - Math.max(0, bytes - MAX_ACTIVITY_BYTES));
		const canRetainTail = targetLines > 1 && targetBytes > 256;
		if (canRetainTail) {
			shrinkActivityEntry(result, first, targetLines, targetBytes);
			const shrunkMetrics = activityMetrics(first);
			if (shrunkMetrics.lines < firstMetrics.lines || shrunkMetrics.bytes < firstMetrics.bytes) {
				lines += shrunkMetrics.lines - firstMetrics.lines;
				bytes += shrunkMetrics.bytes - firstMetrics.bytes;
				metrics[0] = shrunkMetrics;
				continue;
			}
		}

		const removed = result.activity.shift();
		const removedMetrics = metrics.shift();
		if (!removed || !removedMetrics) break;
		lines -= removedMetrics.lines;
		bytes -= removedMetrics.bytes + (result.activity.length > 0 ? 1 : 0);
		result.activityTruncation.omittedEntries += 1;
		result.activityTruncation.omittedLines += removedMetrics.lines;
		result.activityTruncation.omittedBytes += removedMetrics.bytes;
	}
}

function shrinkActivityEntry(
	result: SubagentRunResult,
	entry: SubagentActivityEntry,
	maxLines: number,
	maxBytes: number,
): void {
	if (entry.kind !== "tool") {
		entry.text = truncateTextTail(entry.text, maxLines, Math.max(1, maxBytes - 128)).text;
		boundTextActivity(result, entry);
		return;
	}

	const argsMetrics = activityValueMetrics(entry.args);
	if (entry.result === undefined) {
		applyToolBound(result, entry, "args", maxLines - 1, maxBytes - 128);
		return;
	}
	const resultLines = Math.max(1, maxLines - argsMetrics.lines - 2);
	const resultBytes = Math.max(256, maxBytes - argsMetrics.bytes - 256);
	if (resultLines > 1 && resultBytes > 256) {
		applyToolBound(result, entry, "result", resultLines, resultBytes);
		return;
	}
	applyToolBound(result, entry, "args", Math.max(1, Math.floor(maxLines / 3)), Math.max(256, Math.floor(maxBytes / 3)));
	applyToolBound(
		result,
		entry,
		"result",
		Math.max(1, Math.floor((maxLines * 2) / 3)),
		Math.max(256, Math.floor((maxBytes * 2) / 3)),
	);
}

function upsertTextActivity(
	result: SubagentRunResult,
	kind: "assistant" | "thinking",
	contentIndex: number,
	text: string,
	status: "running" | "complete",
): void {
	const id = `${kind}-${result.usage.turns}-${contentIndex}`;
	const existing = result.activity.find(
		(entry): entry is SubagentTextActivity => entry.id === id && entry.kind === kind,
	);
	if (existing) {
		existing.text = text;
		existing.status = status;
		boundTextActivity(result, existing);
		trimActivity(result);
		return;
	}
	const entry: SubagentTextActivity = { id, kind, text, status, timestamp: Date.now() };
	boundTextActivity(result, entry);
	result.activity.push(entry);
	trimActivity(result);
}

function addTextActivity(
	result: SubagentRunResult,
	kind: "lifecycle" | "stderr",
	text: string,
	status: "running" | "complete" | "failed" = "complete",
): void {
	const entry: SubagentTextActivity = {
		id: `${kind}-${result.activity.length}`,
		kind,
		text,
		status,
		timestamp: Date.now(),
	};
	boundTextActivity(result, entry);
	result.activity.push(entry);
	trimActivity(result);
}

function boundValue(value: unknown, maxLines: number, maxBytes: number): { value: unknown; lines: number; bytes: number } {
	const serialized = formatActivityValue(value);
	if (serialized.split("\n").length <= maxLines && Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes) {
		return { value, lines: 0, bytes: 0 };
	}

	let previewBytes = Math.max(0, maxBytes - 128);
	let truncated = truncateTextTail(serialized, maxLines, previewBytes);
	let bounded: unknown = { transcriptTruncated: true, tail: truncated.text };
	while (previewBytes > 0 && Buffer.byteLength(JSON.stringify(bounded), "utf8") > maxBytes) {
		const overflow = Buffer.byteLength(JSON.stringify(bounded), "utf8") - maxBytes;
		previewBytes = Math.max(0, previewBytes - overflow - 16);
		truncated = truncateTextTail(serialized, maxLines, previewBytes);
		bounded = { transcriptTruncated: true, tail: truncated.text };
	}
	return { value: bounded, lines: truncated.lines, bytes: truncated.bytes };
}

function formatActivityValue(value: unknown, indent = ""): string {
	if (typeof value === "string") return value;
	if (value === null || typeof value !== "object") return String(value);
	if (Array.isArray(value)) {
		return value.map((item) => formatActivityValue(item, indent)).join("\n");
	}
	return Object.entries(value as Record<string, unknown>)
		.map(([key, item]) => {
			const formatted = formatActivityValue(item, `${indent}  `);
			const [first, ...rest] = formatted.split("\n");
			return `${indent}${key}: ${first}${rest.length > 0 ? `\n${rest.map((line) => `${indent}  ${line}`).join("\n")}` : ""}`;
		})
		.join("\n");
}

function activityValueMetrics(value: unknown): { lines: number; bytes: number } {
	const formatted = formatActivityValue(value);
	return { lines: formatted.split("\n").length, bytes: Buffer.byteLength(JSON.stringify(value), "utf8") };
}

function setToolValue(
	result: SubagentRunResult,
	entry: SubagentToolActivity,
	field: "args" | "result",
	value: unknown,
): void {
	const linesField = field === "args" ? "argsOmittedLines" : "resultOmittedLines";
	const bytesField = field === "args" ? "argsOmittedBytes" : "resultOmittedBytes";
	result.activityTruncation.omittedLines -= entry[linesField] ?? 0;
	result.activityTruncation.omittedBytes -= entry[bytesField] ?? 0;
	entry[field] = value;
	delete entry[linesField];
	delete entry[bytesField];
}

function applyToolBound(
	result: SubagentRunResult,
	entry: SubagentToolActivity,
	field: "args" | "result",
	maxLines: number,
	maxBytes: number,
): void {
	const value = entry[field];
	if (value === undefined) return;
	const linesField = field === "args" ? "argsOmittedLines" : "resultOmittedLines";
	const bytesField = field === "args" ? "argsOmittedBytes" : "resultOmittedBytes";
	const bounded = boundValue(value, maxLines, maxBytes);
	entry[field] = bounded.value;
	if (bounded.lines > 0) entry[linesField] = bounded.lines;
	if (bounded.bytes > 0) entry[bytesField] = bounded.bytes;
	result.activityTruncation.omittedLines += bounded.lines;
	result.activityTruncation.omittedBytes += bounded.bytes;
}

function boundToolActivity(result: SubagentRunResult, entry: SubagentToolActivity): void {
	const metrics = activityMetrics(entry);
	if (metrics.lines <= MAX_ACTIVITY_LINES && metrics.bytes <= MAX_ACTIVITY_BYTES) return;

	const availableBytes = MAX_ACTIVITY_BYTES - 2 * 1024;
	const availableLines = MAX_ACTIVITY_LINES - 10;
	const argsBytes = Buffer.byteLength(JSON.stringify(entry.args), "utf8");
	const resultBytes = entry.result === undefined ? 0 : Buffer.byteLength(JSON.stringify(entry.result), "utf8");
	let argsBudget = availableBytes;
	let resultBudget = 0;
	if (entry.result !== undefined) {
		if (argsBytes <= availableBytes / 3) {
			argsBudget = argsBytes;
			resultBudget = availableBytes - argsBudget;
		} else if (resultBytes <= (availableBytes * 2) / 3) {
			resultBudget = resultBytes;
			argsBudget = availableBytes - resultBudget;
		} else {
			argsBudget = Math.floor(availableBytes / 3);
			resultBudget = availableBytes - argsBudget;
		}
	}
	applyToolBound(result, entry, "args", Math.floor(availableLines / 3), Math.max(256, argsBudget));
	if (entry.result !== undefined) {
		applyToolBound(result, entry, "result", Math.floor((availableLines * 2) / 3), Math.max(256, resultBudget));
	}
}

function upsertToolActivity(
	result: SubagentRunResult,
	event: { toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean },
	status: "running" | "complete" | "failed",
): void {
	const existing = result.activity.find(
		(entry): entry is SubagentToolActivity => entry.kind === "tool" && entry.id === event.toolCallId,
	);
	if (existing) {
		existing.toolName = event.toolName;
		if (event.args !== undefined) setToolValue(result, existing, "args", event.args);
		if (event.result !== undefined) setToolValue(result, existing, "result", event.result);
		if (event.isError !== undefined) existing.isError = event.isError;
		existing.status = status;
		if (status !== "running") existing.finishedAt = Date.now();
		boundToolActivity(result, existing);
		trimActivity(result);
		return;
	}
	const entry: SubagentToolActivity = {
		id: event.toolCallId,
		kind: "tool",
		toolName: event.toolName,
		args: {},
		isError: event.isError,
		status,
		timestamp: Date.now(),
	};
	setToolValue(result, entry, "args", event.args ?? {});
	if (event.result !== undefined) setToolValue(result, entry, "result", event.result);
	boundToolActivity(result, entry);
	result.activity.push(entry);
	trimActivity(result);
}

function addMessage(result: SubagentRunResult, message: Message): void {
	if (message.role === "assistant") {
		for (const [contentIndex, part] of message.content.entries()) {
			if (part.type === "text") upsertTextActivity(result, "assistant", contentIndex, part.text, "complete");
			if (part.type === "thinking") upsertTextActivity(result, "thinking", contentIndex, part.thinking, "complete");
		}
		for (const entry of result.activity) {
			if ((entry.kind === "assistant" || entry.kind === "thinking") && entry.status === "running") {
				entry.status = "complete";
			}
		}
		if (message.errorMessage) addTextActivity(result, "lifecycle", message.errorMessage, "failed");
	}
	if (message.role !== "assistant") return;
	result.messages = [message];

	result.usage.turns += 1;
	result.usage.input += message.usage.input;
	result.usage.output += message.usage.output;
	result.usage.cacheRead += message.usage.cacheRead;
	result.usage.cacheWrite += message.usage.cacheWrite;
	result.usage.cacheWrite1h = (result.usage.cacheWrite1h ?? 0) + (message.usage.cacheWrite1h ?? 0);
	result.usage.reasoning = (result.usage.reasoning ?? 0) + (message.usage.reasoning ?? 0);
	result.usage.totalTokens += message.usage.totalTokens;
	result.usage.contextTokens =
		message.usage.totalTokens ||
		message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite;
	result.usage.cost.input += message.usage.cost.input;
	result.usage.cost.output += message.usage.cost.output;
	result.usage.cost.cacheRead += message.usage.cost.cacheRead;
	result.usage.cost.cacheWrite += message.usage.cost.cacheWrite;
	result.usage.cost.total += message.usage.cost.total;
	result.model = message.model;
	result.stopReason = message.stopReason;
	result.errorMessage = message.errorMessage;
}

function appendBoundedTail(existing: string, next: string, maxBytes: number): string {
	const combined = Buffer.from(existing + next, "utf8");
	if (combined.length <= maxBytes) return combined.toString("utf8");
	return combined.subarray(combined.length - maxBytes).toString("utf8").replace(/^�/, "");
}

function terminateProcess(proc: ReturnType<typeof spawn>): void {
	if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return;
	try {
		if (process.platform !== "win32") process.kill(-proc.pid, "SIGTERM");
		else proc.kill("SIGTERM");
	} catch {
		proc.kill("SIGTERM");
	}

	const forceKill = setTimeout(() => {
		if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return;
		try {
			if (process.platform !== "win32") process.kill(-proc.pid, "SIGKILL");
			else proc.kill("SIGKILL");
		} catch {
			proc.kill("SIGKILL");
		}
	}, 5_000);
	forceKill.unref();
	proc.once("close", () => clearTimeout(forceKill));
}

export function finalOutput(messages: Message[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		return message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

export function failed(result: SubagentRunResult): boolean {
	return (
		result.aborted ||
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted" ||
		!finalOutput(result.messages)
	);
}

export async function runSubagent(options: RunSubagentOptions): Promise<SubagentRunResult> {
	const result = initialResult(options);
	const promptDirectory = await mkdtemp(join(tmpdir(), "pi-subagent-"));
	const systemPromptPath = join(promptDirectory, "system.md");
	await writeFile(systemPromptPath, SUBAGENT_SYSTEM_PROMPT, { encoding: "utf8", mode: 0o600 });

	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions"];
	if (options.model) args.push("--model", `${options.model.provider}/${options.model.id}`);
	if (options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
	args.push("--tools", toolsForCapability(options.capability).join(","));
	args.push("--append-system-prompt", systemPromptPath, options.prompt);

	try {
		const selectedInvocation = invocation(args);
		await new Promise<void>((resolve) => {
			const proc = spawn(selectedInvocation.command, selectedInvocation.args, {
				cwd: options.cwd,
				detached: process.platform !== "win32",
				env: {
					...process.env,
					[DEPTH_ENV]: String(Number.parseInt(process.env[DEPTH_ENV] ?? "0", 10) + 1),
				},
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let lastUpdateAt = 0;
			let pendingUpdate: NodeJS.Timeout | undefined;
			const emitUpdate = (force = false) => {
				if (!options.onUpdate) return;
				const now = Date.now();
				const waitMs = UPDATE_INTERVAL_MS - (now - lastUpdateAt);
				if (force || waitMs <= 0) {
					if (pendingUpdate) clearTimeout(pendingUpdate);
					pendingUpdate = undefined;
					lastUpdateAt = now;
					options.onUpdate(structuredClone(result));
					return;
				}
				if (!pendingUpdate) {
					pendingUpdate = setTimeout(() => emitUpdate(true), waitMs);
					pendingUpdate.unref();
				}
			};
			result.startedAt = Date.now();
			emitUpdate(true);
			lastUpdateAt = 0;
			const elapsedTimer = setInterval(() => emitUpdate(true), 1_000);
			elapsedTimer.unref();

			let stdoutBuffer = "";
			let spawnFailed = false;
			const processLine = (line: string) => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line) as {
						type?: string;
						message?: Message;
						assistantMessageEvent?: { type?: string; contentIndex?: number; partial?: Message };
						toolCallId?: string;
						toolName?: string;
						args?: unknown;
						partialResult?: unknown;
						result?: unknown;
						isError?: boolean;
						attempt?: number;
						maxAttempts?: number;
						delayMs?: number;
						errorMessage?: string;
						success?: boolean;
						reason?: string;
					};
					if (event.type === "message_update") {
						const update = event.assistantMessageEvent;
						const contentIndex = update?.contentIndex;
						const partial = update?.partial;
						if (typeof contentIndex === "number" && partial?.role === "assistant") {
							const part = partial.content[contentIndex];
							if (part?.type === "text") {
								upsertTextActivity(result, "assistant", contentIndex, part.text, "running");
								emitUpdate();
							}
							if (part?.type === "thinking") {
								upsertTextActivity(result, "thinking", contentIndex, part.thinking, "running");
								emitUpdate();
							}
						}
					}
					if (event.toolCallId && event.toolName) {
						if (event.type === "tool_execution_start") {
							upsertToolActivity(result, event as { toolCallId: string; toolName: string; args?: unknown }, "running");
							emitUpdate();
						}
						if (event.type === "tool_execution_update") {
							upsertToolActivity(
								result,
								{
									toolCallId: event.toolCallId,
									toolName: event.toolName,
									args: event.args,
									result: event.partialResult,
								},
								"running",
							);
							emitUpdate();
						}
						if (event.type === "tool_execution_end") {
							upsertToolActivity(
								result,
								{
									toolCallId: event.toolCallId,
									toolName: event.toolName,
									result: event.result,
									isError: event.isError,
								},
								event.isError ? "failed" : "complete",
							);
							emitUpdate();
						}
					}
					if (event.type === "auto_retry_start") {
						addTextActivity(
							result,
							"lifecycle",
							`Retry ${event.attempt ?? "?"}/${event.maxAttempts ?? "?"}: ${event.errorMessage ?? "unknown error"}`,
							"running",
						);
						emitUpdate();
					}
					if (event.type === "auto_retry_end") {
						addTextActivity(
							result,
							"lifecycle",
							event.success ? `Retry ${event.attempt ?? "?"} succeeded` : `Retry ${event.attempt ?? "?"} failed`,
							event.success ? "complete" : "failed",
						);
						emitUpdate();
					}
					if (event.type === "message_end" && event.message) {
						addMessage(result, event.message);
						emitUpdate();
					}
				} catch {
					// Ignore non-event output. Child diagnostics belong on stderr.
				}
			};

			proc.stdout.setEncoding("utf8");
			proc.stdout.on("data", (chunk: string) => {
				stdoutBuffer += chunk;
				const lines = stdoutBuffer.split("\n");
				stdoutBuffer = lines.pop() ?? "";
				for (const line of lines) processLine(line);
			});
			proc.stderr.setEncoding("utf8");
			proc.stderr.on("data", (text: string) => {
				result.stderr = appendBoundedTail(result.stderr, text, MAX_ACTIVITY_BYTES);
				addTextActivity(result, "stderr", text.trimEnd(), "running");
				emitUpdate();
			});
			proc.on("error", (error) => {
				spawnFailed = true;
				result.errorMessage = error.message;
				result.status = "failed";
				addTextActivity(result, "lifecycle", error.message, "failed");
				emitUpdate(true);
			});
			proc.on("close", (code) => {
				clearInterval(elapsedTimer);
				if (pendingUpdate) clearTimeout(pendingUpdate);
				if (stdoutBuffer.trim()) processLine(stdoutBuffer);
				result.exitCode = code ?? (result.aborted || spawnFailed ? 1 : 0);
				result.status =
					result.aborted || result.stopReason === "aborted"
						? "cancelled"
						: result.exitCode !== 0 || result.stopReason === "error" || !finalOutput(result.messages)
							? "failed"
							: "complete";
				result.finishedAt = Date.now();
				for (const entry of result.activity) {
					if (entry.status !== "running") continue;
					entry.status = result.status === "complete" ? "complete" : "failed";
					if (entry.kind === "tool") entry.finishedAt = result.finishedAt;
				}
				emitUpdate(true);
				resolve();
			});

			const abort = () => {
				result.aborted = true;
				result.status = "cancelled";
				result.stopReason = "aborted";
				terminateProcess(proc);
			};
			if (options.signal?.aborted) abort();
			else options.signal?.addEventListener("abort", abort, { once: true });
			proc.once("close", () => options.signal?.removeEventListener("abort", abort));
		});
		return result;
	} finally {
		await rm(promptDirectory, { recursive: true, force: true });
	}
}
