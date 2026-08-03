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

function activityLines(result: SubagentRunResult, theme: Theme): string[] {
	const lines: string[] = [];
	for (const entry of result.activity) {
		if (entry.kind === "assistant") {
			const color = result.status === "complete" ? "text" : "toolOutput";
			lines.push(...entry.text.split("\n").map((line) => theme.fg(color, line)));
			continue;
		}
		if (entry.kind === "thinking") {
			const thinking = entry.text.split("\n");
			lines.push(...thinking.map((line, index) => theme.fg("thinkingText", `${index === 0 ? "thinking: " : "  "}${line}`)));
			continue;
		}
		if (entry.kind === "lifecycle") {
			lines.push(theme.fg(entry.status === "failed" ? "error" : "warning", `↻ ${entry.text}`));
			continue;
		}
		if (entry.kind === "stderr") {
			lines.push(...entry.text.split("\n").map((line) => theme.fg("error", `stderr: ${line}`)));
			continue;
		}

		if (entry.kind !== "tool") continue;
		const icon =
			entry.status === "running"
				? theme.fg("warning", "⏳")
				: entry.status === "failed"
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");
		lines.push(`${icon} ${theme.fg("toolTitle", entry.toolName)}`);
		lines.push(...formatValue(entry.args).split("\n").map((line, index) => theme.fg("dim", `${index === 0 ? "args: " : "  "}${line}`)));
		if (entry.result !== undefined) {
			lines.push(
				...formatValue(entry.result)
					.split("\n")
					.map((line, index) => theme.fg("toolOutput", `${index === 0 ? "result: " : "  "}${line}`)),
			);
		}
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
	private readonly transcript: string;
	private readonly emptyText: string;
	private readonly wasTruncated: boolean;
	private readonly theme: Theme;

	constructor(transcript: string, emptyText: string, wasTruncated: boolean, theme: Theme) {
		this.transcript = transcript;
		this.emptyText = emptyText;
		this.wasTruncated = wasTruncated;
		this.theme = theme;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const truncated = truncateToVisualLines(this.transcript || this.emptyText, COLLAPSED_TRANSCRIPT_LINES, width);
		if (truncated.skippedCount > 0 || this.wasTruncated) {
			lines.push(this.theme.fg("muted", "… earlier transcript content hidden"));
		}
		lines.push(...truncated.visualLines);
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
					lines.join("\n"),
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

		const icon =
			entry.status === "running"
				? theme.fg("warning", "⏳")
				: entry.status === "failed"
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");
		card.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(entry.toolName))}`, 0, 0));
		card.addChild(new Text(theme.fg("muted", "args") + `\n${theme.fg("dim", formatValue(entry.args))}`, 0, 0));
		if (entry.result !== undefined) {
			card.addChild(
				new Text(theme.fg("muted", "result") + `\n${theme.fg("toolOutput", formatValue(entry.result))}`, 0, 0),
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
