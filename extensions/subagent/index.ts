import { StringEnum, type Usage } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getMarkdownTheme,
	keyHint,
	truncateHead,
	truncateToVisualLines,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	Container,
	Markdown,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { Capability } from "./src/capabilities.ts";
import {
	emptyUsageStats,
	failed,
	finalOutput,
	runSubagent,
	type SubagentRunResult,
	type SubagentToolActivity,
} from "./src/runner.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_TRANSCRIPT_LINES = 8;
const DEPTH_ENV = "PI_SUBAGENT_DEPTH";

const CapabilitySchema = StringEnum(["read-only", "write"] as const, {
	description: 'Tool access for the child. Defaults to "read-only".',
	default: "read-only",
});

const TaskSchema = Type.Object({
	label: Type.String({ description: "Short label that distinguishes this task in output" }),
	prompt: Type.String({ description: "Self-contained handoff prompt for the isolated child" }),
	capability: Type.Optional(CapabilitySchema),
});

const SubagentParameters = Type.Object({
	tasks: Type.Array(TaskSchema, {
		description: `One or more independent handoff prompts to run in parallel (maximum ${MAX_PARALLEL_TASKS})`,
		minItems: 1,
		maxItems: MAX_PARALLEL_TASKS,
	}),
});

export interface SubagentDetails {
	results: SubagentRunResult[];
}

function resultText(result: SubagentRunResult): string {
	if (!failed(result)) return finalOutput(result.messages);
	if (result.aborted) return "Subagent was aborted.";
	return result.errorMessage || result.stderr.trim() || finalOutput(result.messages) || "Subagent produced no final response.";
}

function modelVisibleContent(details: SubagentDetails): string {
	const raw = details.results
		.map((result, index) => {
			const title = result.label || `Task ${index + 1}`;
			const status = failed(result) ? "failed" : "completed";
			return `## ${title} — ${status}\n\n${resultText(result)}`;
		})
		.join("\n\n---\n\n");

	const truncated = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	if (!truncated.truncated) return truncated.content;
	const notice = "[Subagent output truncated. Complete final response remains in structured tool details.]";
	const bounded = truncateHead(raw, {
		maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(notice, "utf8") - 2,
		maxLines: DEFAULT_MAX_LINES - 2,
	});
	return `${bounded.content}\n\n${notice}`;
}

function formatElapsed(result: SubagentRunResult): string {
	if (!result.startedAt) return "0ms";
	const elapsedMs = Math.max(0, (result.finishedAt ?? Date.now()) - result.startedAt);
	if (elapsedMs < 1_000) return `${elapsedMs}ms`;
	if (elapsedMs < 60_000) return `${(elapsedMs / 1_000).toFixed(1)}s`;
	const minutes = Math.floor(elapsedMs / 60_000);
	const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

function formatValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringValue(value: unknown, fallback = "..."): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactInline(value: string, maxLength = 72): string {
	const inline = value.trim().replace(/\s*\n\s*/g, "; ").replace(/\s+/g, " ") || "...";
	return inline.length > maxLength ? `${inline.slice(0, Math.max(1, maxLength - 1))}…` : inline;
}

function compactPath(value: unknown): string {
	const path = stringValue(value);
	if (path.length <= 64) return path;
	return `${path.slice(0, 28)}…${path.slice(-35)}`;
}

function toolResultRecord(entry: SubagentToolActivity): Record<string, unknown> | undefined {
	return asRecord(entry.result);
}

function toolResultDetails(entry: SubagentToolActivity): Record<string, unknown> | undefined {
	return asRecord(toolResultRecord(entry)?.details);
}

function toolResultContent(entry: SubagentToolActivity): Record<string, unknown>[] {
	const content = toolResultRecord(entry)?.content;
	if (!Array.isArray(content)) return [];
	return content
		.map((part) => asRecord(part))
		.filter((part): part is Record<string, unknown> => Boolean(part));
}

function toolResultText(entry: SubagentToolActivity): string {
	if (typeof entry.result === "string") return entry.result;
	return toolResultContent(entry)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

function toolResultHasImage(entry: SubagentToolActivity): boolean {
	return toolResultContent(entry).some((part) => part.type === "image");
}

function dataOutputLines(entry: SubagentToolActivity): string[] {
	const text = toolResultText(entry).trimEnd();
	if (
		!text ||
		/^no matches found\.?$/i.test(text) ||
		/^no files found matching pattern\.?$/i.test(text) ||
		/^\(empty directory\)$/i.test(text)
	) {
		return [];
	}
	const lines = text.split("\n");
	const lastLine = lines.at(-1)?.trim() ?? "";
	if (
		/^\[(?:showing (?:lines|last)|output truncated:|[0-9]+ more lines in file)/i.test(lastLine) ||
		(resultWasTruncated(entry) && lastLine.startsWith("[") && lastLine.endsWith("]"))
	) {
		lines.pop();
		while (lines.at(-1)?.trim() === "") lines.pop();
	}
	return lines;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatToolElapsed(entry: SubagentToolActivity): string | undefined {
	const end = entry.finishedAt ?? Date.now();
	const elapsedMs = Math.max(0, end - entry.timestamp);
	if (elapsedMs < 1_000) return `${elapsedMs}ms`;
	if (elapsedMs < 60_000) return `${(elapsedMs / 1_000).toFixed(1)}s`;
	const minutes = Math.floor(elapsedMs / 60_000);
	const seconds = Math.floor((elapsedMs % 60_000) / 1_000);
	return `${minutes}m ${seconds}s`;
}

function diffStats(entry: SubagentToolActivity): { added: number; removed: number } | undefined {
	const patch = toolResultDetails(entry)?.patch;
	if (typeof patch !== "string") return undefined;
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
		if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
	}
	return { added, removed };
}

function resultWasTruncated(entry: SubagentToolActivity): boolean {
	const details = toolResultDetails(entry);
	const truncation = asRecord(details?.truncation);
	return Boolean(
		truncation?.truncated ||
		entry.argsOmittedLines ||
		entry.argsOmittedBytes ||
		entry.resultOmittedLines ||
		entry.resultOmittedBytes ||
		details?.matchLimitReached ||
		details?.resultLimitReached ||
		details?.entryLimitReached,
	);
}

interface ToolDisplay {
	lead: string;
	subject: string;
	context?: string;
	metadata: string[];
}

function describeTool(entry: SubagentToolActivity): ToolDisplay {
	const args = asRecord(entry.args) ?? {};
	const output = toolResultText(entry);
	const outputLines = dataOutputLines(entry);
	const elapsed = formatToolElapsed(entry);
	const metadata: string[] = [];
	const isSettled = entry.status !== "running";

	switch (entry.toolName) {
		case "read": {
			const offset = numberValue(args.offset);
			const limit = numberValue(args.limit);
			const start = offset ?? 1;
			const range = offset !== undefined || limit !== undefined ? `:${start}${limit !== undefined ? `-${start + limit - 1}` : ""}` : "";
			if (isSettled && toolResultHasImage(entry)) metadata.push("image");
			else if (isSettled && outputLines.length > 0) {
				const truncationLines = numberValue(asRecord(toolResultDetails(entry)?.truncation)?.outputLines);
				metadata.push(plural(truncationLines ?? outputLines.length, "line"));
			}
			if (elapsed) metadata.push(elapsed);
			return { lead: "read ", subject: `${compactPath(args.path ?? args.file_path)}${range}`, metadata };
		}
		case "grep": {
			if (isSettled) {
				const matches = outputLines.filter((line) => /:\d+: /.test(line)).length;
				metadata.push(plural(matches, "match", "matches"));
			}
			if (elapsed) metadata.push(elapsed);
			return {
				lead: "grep ",
				subject: `/${compactInline(stringValue(args.pattern, ""), 48)}/`,
				context: ` in ${compactPath(args.path ?? ".")}`,
				metadata,
			};
		}
		case "find": {
			if (isSettled) metadata.push(plural(outputLines.filter((line) => line.length > 0).length, "file"));
			if (elapsed) metadata.push(elapsed);
			return {
				lead: "find ",
				subject: compactInline(stringValue(args.pattern, "*"), 48),
				context: ` in ${compactPath(args.path ?? ".")}`,
				metadata,
			};
		}
		case "ls": {
			if (isSettled) metadata.push(plural(outputLines.filter((line) => line.length > 0).length, "entry", "entries"));
			if (elapsed) metadata.push(elapsed);
			return { lead: "list ", subject: compactPath(args.path ?? "."), metadata };
		}
		case "bash": {
			const exitMatch = output.match(/(?:command exited with code|exit(?: code)?)[^0-9]*([0-9]+)/i);
			if (exitMatch) metadata.push(`exit ${exitMatch[1]}`);
			if (elapsed) metadata.push(elapsed);
			return { lead: "$ ", subject: compactInline(stringValue(args.command), 72), metadata };
		}
		case "edit": {
			const edits = Array.isArray(args.edits) ? args.edits.length : 1;
			metadata.push(plural(edits, "replacement"));
			const stats = diffStats(entry);
			if (stats && isSettled) metadata.push(`+${stats.added} −${stats.removed}`);
			if (elapsed) metadata.push(elapsed);
			return { lead: "edit ", subject: compactPath(args.path ?? args.file_path), metadata };
		}
		case "write": {
			const content = typeof args.content === "string" ? args.content : "";
			metadata.push(plural(content.length === 0 ? 0 : content.split("\n").length, "line"));
			if (elapsed) metadata.push(elapsed);
			return { lead: "write ", subject: compactPath(args.path ?? args.file_path), metadata };
		}
		default: {
			if (elapsed) metadata.push(elapsed);
			return {
				lead: `${entry.toolName} `,
				subject: compactInline(formatValue(entry.args), 72),
				metadata,
			};
		}
	}
}

function toolActivityLine(entry: SubagentToolActivity, theme: Theme): string {
	const failed = entry.status === "failed" || entry.isError;
	const icon =
		entry.status === "running"
			? theme.fg("warning", "◌")
			: failed
				? theme.fg("error", "✗")
				: theme.fg("success", "✓");
	const display = describeTool(entry);
	const metadata = [...display.metadata];
	if (resultWasTruncated(entry)) metadata.push("truncated");
	return (
		`${icon} ${theme.fg("toolTitle", display.lead)}${theme.fg("accent", display.subject)}` +
		theme.fg("dim", `${display.context ?? ""}${metadata.length > 0 ? ` · ${metadata.join(" · ")}` : ""}`)
	);
}

function outputTail(text: string, maxLines = 8): string {
	const lines = text.trimEnd().split("\n");
	if (lines.length <= maxLines) return lines.join("\n");
	return `… ${lines.length - maxLines} earlier lines omitted\n${lines.slice(-maxLines).join("\n")}`;
}

interface ToolDetailBlock {
	label: string;
	text: string;
	color: "dim" | "toolOutput" | "error";
}

function expandedToolDetails(entry: SubagentToolActivity): ToolDetailBlock[] {
	const args = asRecord(entry.args) ?? {};
	const output = toolResultText(entry);
	const failed = entry.status === "failed" || entry.isError;
	const blocks: ToolDetailBlock[] = [];

	if (entry.toolName === "bash") {
		blocks.push({ label: "command", text: stringValue(args.command), color: "dim" });
		if (output) blocks.push({ label: failed ? "error output" : "output", text: outputTail(output), color: failed ? "error" : "toolOutput" });
		return blocks;
	}

	if (entry.toolName === "grep") {
		const options: string[] = [];
		if (typeof args.glob === "string") options.push(`glob: ${args.glob}`);
		if (args.ignoreCase === true) options.push("ignore case");
		if (args.literal === true) options.push("literal pattern");
		if (typeof args.context === "number") options.push(`context: ${args.context}`);
		if (typeof args.limit === "number") options.push(`limit: ${args.limit}`);
		if (options.length > 0) blocks.push({ label: "options", text: options.join(" · "), color: "dim" });
	}

	const isBuiltin = ["read", "grep", "find", "ls", "edit", "write"].includes(entry.toolName);
	if (failed && output && isBuiltin) blocks.push({ label: "error output", text: outputTail(output), color: "error" });
	if (!isBuiltin) {
		blocks.push({ label: "arguments", text: formatValue(entry.args), color: "dim" });
		if (output) blocks.push({ label: failed ? "error output" : "result", text: outputTail(output), color: failed ? "error" : "toolOutput" });
	}
	return blocks;
}

interface CollapsedActivityLine {
	text: string;
	singleRow: boolean;
}

function activityLines(result: SubagentRunResult, theme: Theme): CollapsedActivityLine[] {
	const lines: CollapsedActivityLine[] = [];
	const addWrapped = (text: string) => lines.push({ text, singleRow: false });
	for (const entry of result.activity) {
		if (entry.kind === "assistant") {
			const color = result.status === "complete" ? "text" : "toolOutput";
			entry.text.split("\n").forEach((line) => addWrapped(theme.fg(color, line)));
			continue;
		}
		if (entry.kind === "thinking") {
			entry.text
				.split("\n")
				.forEach((line, index) => addWrapped(theme.fg("thinkingText", `${index === 0 ? "thinking: " : "  "}${line}`)));
			continue;
		}
		if (entry.kind === "lifecycle") {
			addWrapped(theme.fg(entry.status === "failed" ? "error" : "warning", `↻ ${entry.text}`));
			continue;
		}
		if (entry.kind === "stderr") {
			entry.text.split("\n").forEach((line) => addWrapped(theme.fg("error", `stderr: ${line}`)));
			continue;
		}
		if (entry.kind === "tool") lines.push({ text: toolActivityLine(entry, theme), singleRow: true });
	}
	return lines;
}

function statusAppearance(result: SubagentRunResult, theme: Theme): { icon: string; background: (text: string) => string } {
	switch (result.status) {
		case "complete":
			return { icon: theme.fg("success", "✓"), background: (text) => theme.bg("toolSuccessBg", text) };
		case "failed":
			return { icon: theme.fg("error", "✗"), background: (text) => theme.bg("toolErrorBg", text) };
		case "cancelled":
			return { icon: theme.fg("warning", "■"), background: (text) => theme.bg("toolErrorBg", text) };
		case "queued":
			return { icon: theme.fg("muted", "○"), background: (text) => theme.bg("toolPendingBg", text) };
		case "running":
			return { icon: theme.fg("warning", "⏳"), background: (text) => theme.bg("toolPendingBg", text) };
	}
}

class HeaderLine implements Component {
	private readonly icon: string;
	private readonly label: string;
	private readonly metadata: string;

	constructor(icon: string, label: string, metadata: string) {
		this.icon = icon;
		this.label = label;
		this.metadata = metadata;
	}

	render(width: number): string[] {
		const prefix = `${this.icon} `;
		const labelWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(this.metadata));
		const label = truncateToWidth(this.label, labelWidth, "…");
		return [truncateToWidth(`${prefix}${label}${this.metadata}`, width, "…")];
	}

	invalidate(): void {}
}

class CollapsedTranscript implements Component {
	private readonly activity: CollapsedActivityLine[];
	private readonly emptyText: string;
	private readonly wasTruncated: boolean;
	private readonly theme: Theme;

	constructor(activity: CollapsedActivityLine[], emptyText: string, wasTruncated: boolean, theme: Theme) {
		this.activity = activity;
		this.emptyText = emptyText;
		this.wasTruncated = wasTruncated;
		this.theme = theme;
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const source = this.activity.length > 0 ? this.activity : [{ text: this.emptyText, singleRow: false }];
		const visualLines = source.flatMap((line) =>
			line.singleRow
				? [truncateToWidth(line.text, renderWidth, "…")]
				: truncateToVisualLines(line.text, Number.MAX_SAFE_INTEGER, renderWidth).visualLines,
		);
		const skippedCount = Math.max(0, visualLines.length - COLLAPSED_TRANSCRIPT_LINES);
		const lines: string[] = [];
		if (skippedCount > 0 || this.wasTruncated) {
			lines.push(this.theme.fg("muted", "… earlier transcript content hidden"));
		} else {
			lines.push("");
		}
		lines.push(...visualLines.slice(-COLLAPSED_TRANSCRIPT_LINES));
		lines.push(this.theme.fg("muted", keyHint("app.tools.expand", "to expand")));
		return lines;
	}

	invalidate(): void {}
}

function childHeader(
	result: SubagentRunResult,
	label: string,
	appearance: ReturnType<typeof statusAppearance>,
	theme: Theme,
): HeaderLine {
	return new HeaderLine(
		appearance.icon,
		theme.fg("accent", theme.bold(label)),
		` · ${theme.fg("dim", result.capability)} · ${result.status} · ${formatElapsed(result)}`,
	);
}

function renderCollapsedCards(results: SubagentRunResult[], theme: Theme): Container {
	const container = new Container();
	for (const [index, result] of results.entries()) {
		if (index > 0) container.addChild(new Spacer(1));
		const appearance = statusAppearance(result, theme);
		const card = new Box(1, 1, appearance.background);
		const label = result.label || (results.length === 1 ? "Subagent" : `Task ${index + 1}`);
		card.addChild(childHeader(result, label, appearance, theme));

		const output = result.status === "complete" ? finalOutput(result.messages) : "";
		if (output) {
			card.addChild(new Spacer(1));
			card.addChild(new Markdown(output, 0, 0, getMarkdownTheme()));
			card.addChild(new Text(theme.fg("muted", keyHint("app.tools.expand", "to view activity")), 0, 0));
		} else {
			const lines = activityLines(result, theme);
			const wasTruncated =
				result.activityTruncation.omittedEntries > 0 ||
				result.activityTruncation.omittedLines > 0 ||
				result.activityTruncation.omittedBytes > 0;
			card.addChild(
				new CollapsedTranscript(
					lines,
					theme.fg("muted", result.status === "queued" ? "Waiting to start" : "No transcript yet"),
					wasTruncated,
					theme,
				),
			);
		}
		addUsageFooter(card, result, theme);
		container.addChild(card);
	}
	return container;
}

function formatUsage(result: SubagentRunResult): string {
	const turns = `${result.usage.turns} ${result.usage.turns === 1 ? "turn" : "turns"}`;
	return `${turns} ↑${result.usage.input} ↓${result.usage.output} $${result.usage.cost.total.toFixed(4)}${result.model ? ` ${result.model}` : ""}`;
}

function addUsageFooter(card: Box, result: SubagentRunResult, theme: Theme): void {
	card.addChild(new Spacer(1));
	card.addChild(new Text(theme.fg("dim", formatUsage(result)), 0, 0));
}

function addExpandedActivity(card: Box, result: SubagentRunResult, theme: Theme): void {
	if (
		result.activityTruncation.omittedEntries > 0 ||
		result.activityTruncation.omittedLines > 0 ||
		result.activityTruncation.omittedBytes > 0
	) {
		const omitted: string[] = [];
		if (result.activityTruncation.omittedEntries > 0) {
			omitted.push(`${result.activityTruncation.omittedEntries} earlier entries`);
		}
		if (result.activityTruncation.omittedLines > 0) omitted.push(`${result.activityTruncation.omittedLines} lines`);
		if (result.activityTruncation.omittedBytes > 0) omitted.push(formatSize(result.activityTruncation.omittedBytes));
		card.addChild(
			new Text(
				theme.fg("warning", `Transcript truncated: ${omitted.join(", ")} omitted.`),
				0,
				0,
			),
		);
		card.addChild(new Spacer(1));
	}

	for (const [index, entry] of result.activity.entries()) {
		if (index > 0) card.addChild(new Spacer(1));
		if (entry.kind === "assistant") {
			card.addChild(new Markdown(entry.text, 0, 0, getMarkdownTheme()));
			continue;
		}
		if (entry.kind === "thinking") {
			card.addChild(new Text(theme.fg("thinkingText", `thinking: ${entry.text}`), 0, 0));
			continue;
		}
		if (entry.kind === "lifecycle") {
			card.addChild(
				new Text(theme.fg(entry.status === "failed" ? "error" : "warning", `↻ ${entry.text}`), 0, 0),
			);
			continue;
		}
		if (entry.kind === "stderr") {
			card.addChild(new Text(theme.fg("error", `stderr: ${entry.text}`), 0, 0));
			continue;
		}
		if (entry.kind !== "tool") continue;

		card.addChild(new Text(toolActivityLine(entry, theme), 0, 0));
		for (const block of expandedToolDetails(entry)) {
			card.addChild(
				new Text(`${theme.fg("muted", block.label)}\n${theme.fg(block.color, block.text)}`, 0, 0),
			);
		}
	}

	if (result.activity.length === 0) {
		card.addChild(new Text(theme.fg("muted", result.status === "queued" ? "Waiting to start" : "No transcript yet"), 0, 0));
	}
}

function renderExpandedCards(results: SubagentRunResult[], theme: Theme): Container {
	const container = new Container();
	for (const [index, result] of results.entries()) {
		if (index > 0) container.addChild(new Spacer(1));
		const appearance = statusAppearance(result, theme);
		const card = new Box(1, 1, appearance.background);
		const label = result.label || (results.length === 1 ? "Subagent" : `Task ${index + 1}`);
		card.addChild(childHeader(result, label, appearance, theme));
		card.addChild(new Spacer(1));
		card.addChild(new Text(theme.fg("muted", "Prompt"), 0, 0));
		card.addChild(new Text(theme.fg("dim", result.prompt), 0, 0));
		card.addChild(new Spacer(1));
		addExpandedActivity(card, result, theme);
		addUsageFooter(card, result, theme);
		container.addChild(card);
	}
	return container;
}

function aggregateUsage(results: SubagentRunResult[]): Usage {
	const usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let cacheWrite1h = 0;
	let reasoning = 0;
	for (const result of results) {
		usage.input += result.usage.input;
		usage.output += result.usage.output;
		usage.cacheRead += result.usage.cacheRead;
		usage.cacheWrite += result.usage.cacheWrite;
		usage.totalTokens += result.usage.totalTokens;
		usage.cost.input += result.usage.cost.input;
		usage.cost.output += result.usage.cost.output;
		usage.cost.cacheRead += result.usage.cost.cacheRead;
		usage.cost.cacheWrite += result.usage.cost.cacheWrite;
		usage.cost.total += result.usage.cost.total;
		cacheWrite1h += result.usage.cacheWrite1h ?? 0;
		reasoning += result.usage.reasoning ?? 0;
	}
	if (cacheWrite1h > 0) usage.cacheWrite1h = cacheWrite1h;
	if (reasoning > 0) usage.reasoning = reasoning;
	return usage;
}

async function mapWithConcurrency<T, U>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
	const results = new Array<U>(items.length);
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

export default function subagentExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run one or more self-contained prompts in isolated Pi processes. The children do not receive the parent conversation.",
		promptSnippet: "Delegate one or more independent tasks to isolated child agents",
		promptGuidelines: [
			"Use subagent when one or more independent tasks benefit from isolated context or concurrent work.",
			"A subagent cannot see the parent conversation. Each subagent prompt must include the goal, relevant context and decisions, relevant paths or commands, constraints, and expected output.",
			"Use read-only subagents by default. Select write capability only when the delegated task must modify files.",
		],
		parameters: SubagentParameters,
		renderShell: "self",

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const depth = Number.parseInt(process.env[DEPTH_ENV] ?? "0", 10);
			if (depth >= 1) throw new Error("Subagents cannot delegate to another subagent.");

			const model = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;
			const thinkingLevel = pi.getThinkingLevel();
			const tasks = params.tasks;
			const current: SubagentRunResult[] = tasks.map((task) => ({
				label: task.label,
				prompt: task.prompt,
				capability: (task.capability ?? "read-only") as Capability,
				status: "queued",
				exitCode: -1,
				messages: [],
				activity: [],
				activityTruncation: { omittedEntries: 0, omittedLines: 0, omittedBytes: 0 },
				stderr: "",
				usage: emptyUsageStats(),
				aborted: false,
			}));

			const emitParallelUpdate = () => {
				const done = current.filter((result) => result.exitCode !== -1).length;
				onUpdate?.({
					content: [{ type: "text", text: `${done}/${current.length} subagents complete` }],
					details: { results: [...current] },
				});
			};

			const results = await mapWithConcurrency(tasks, MAX_CONCURRENCY, async (task, index) => {
				if (signal?.aborted) {
					const cancelled: SubagentRunResult = {
						...current[index],
						status: "cancelled",
						exitCode: 1,
						finishedAt: Date.now(),
						stopReason: "aborted",
						aborted: true,
					};
					current[index] = cancelled;
					emitParallelUpdate();
					return cancelled;
				}
				const result = await runSubagent({
					label: task.label,
					prompt: task.prompt,
					capability: (task.capability ?? "read-only") as Capability,
					cwd: ctx.cwd,
					model,
					thinkingLevel,
					signal,
					onUpdate: (partial) => {
						current[index] = partial;
						emitParallelUpdate();
					},
				});
				current[index] = result;
				emitParallelUpdate();
				return result;
			});
			const details: SubagentDetails = { results };
			return {
				content: [{ type: "text", text: modelVisibleContent(details) }],
				details,
				usage: aggregateUsage(details.results),
			};
		},

		renderCall() {
			return new Container();
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as SubagentDetails | undefined;
			if (!details) return new Text("Subagent returned no details.", 0, 0);
			return expanded ? renderExpandedCards(details.results, theme) : renderCollapsedCards(details.results, theme);
		},
	});
}
