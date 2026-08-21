import type { GrepToolInput } from "@earendil-works/pi-coding-agent";
import { createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const DEFAULT_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 2_147_483;

type GrepDelegate = Pick<ReturnType<typeof createGrepToolDefinition>, "execute">;

export interface SafeGrepInput extends GrepToolInput {
	timeout?: number;
}

export interface SafeGrepToolOptions {
	defaultTimeoutSeconds?: number;
	delegateFactory?: (cwd: string) => GrepDelegate;
}

function createSafeGrepSchema(
	builtInParameters: ReturnType<typeof createGrepToolDefinition>["parameters"],
	defaultTimeoutSeconds: number,
) {
	return Type.Object({
		...builtInParameters.properties,
		timeout: Type.Optional(
			Type.Number({
				description: `Search deadline in seconds (default: ${defaultTimeoutSeconds})`,
				default: defaultTimeoutSeconds,
				minimum: 0.001,
				maximum: MAX_TIMEOUT_SECONDS,
			}),
		),
	});
}

function validateTimeout(timeoutSeconds: number): void {
	if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.001 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
		throw new Error(`Invalid grep timeout: ${timeoutSeconds}. Use 0.001-${MAX_TIMEOUT_SECONDS} seconds.`);
	}
}

/** Replay an abort to listeners attached after the signal was aborted. */
function replayAbortToLateListeners(signal: AbortSignal): AbortSignal {
	let proxy: AbortSignal;
	proxy = new Proxy(signal, {
		get(target, property) {
			if (property === "addEventListener") {
				return (type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
					if (listener === null) return;
					const registrationSignal = typeof options === "object" ? options.signal : undefined;
					if (registrationSignal?.aborted) return;
					target.addEventListener(type, listener, options);
					if (type !== "abort" || !target.aborted) return;

					const event = new Event("abort");
					Object.defineProperties(event, {
						target: { value: proxy },
						currentTarget: { value: proxy },
					});
					try {
						if (typeof listener === "function") listener.call(proxy, event);
						else listener.handleEvent(event);
					} finally {
						// Abort fires once, so a replayed late listener has no reason to remain registered.
						target.removeEventListener(type, listener, options);
					}
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return proxy;
}

function abortRejection(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
	let onAbort: (() => void) | undefined;
	const promise = new Promise<never>((_resolve, reject) => {
		onAbort = () => {
			const reason = signal.reason;
			reject(reason instanceof Error ? reason : new Error("Operation aborted"));
		};
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	return {
		promise,
		dispose: () => {
			if (onAbort) signal.removeEventListener("abort", onAbort);
		},
	};
}

export function createSafeGrepToolDefinition(options: SafeGrepToolOptions = {}) {
	const defaultTimeoutSeconds = options.defaultTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
	validateTimeout(defaultTimeoutSeconds);
	const delegateFactory = options.delegateFactory ?? ((cwd: string) => createGrepToolDefinition(cwd));
	const builtIn = createGrepToolDefinition(process.cwd());
	const parameters = createSafeGrepSchema(builtIn.parameters, defaultTimeoutSeconds);

	return {
		...builtIn,
		label: "grep (safe)",
		description: `${builtIn.description} Every search has an enforced timeout, which defaults to ${defaultTimeoutSeconds} seconds.`,
		parameters,
		prepareArguments(args: unknown): SafeGrepInput {
			let originalTimeout: unknown;
			let builtInArgs = args;
			if (args && typeof args === "object" && !Array.isArray(args)) {
				const { timeout, ...rest } = args as Record<string, unknown>;
				originalTimeout = timeout;
				builtInArgs = rest;
			}
			const prepared = builtIn.prepareArguments?.(builtInArgs) ?? builtInArgs;
			if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) return prepared as SafeGrepInput;
			return {
				...prepared,
				timeout: originalTimeout === undefined ? defaultTimeoutSeconds : originalTimeout,
			} as SafeGrepInput;
		},
		async execute(toolCallId: string, params: SafeGrepInput, parentSignal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			const timeoutSeconds = params.timeout === undefined ? defaultTimeoutSeconds : params.timeout;
			validateTimeout(timeoutSeconds);

			const timeoutController = new AbortController();
			const signal = parentSignal
				? AbortSignal.any([parentSignal, timeoutController.signal])
				: timeoutController.signal;
			const delegatedSignal = replayAbortToLateListeners(signal);
			let timedOut = false;
			const deadline = performance.now() + timeoutSeconds * 1_000;
			const timer = setTimeout(() => {
				timedOut = true;
				timeoutController.abort();
			}, timeoutSeconds * 1_000);
			const aborted = abortRejection(signal);

			try {
				const delegated = delegateFactory(ctx?.cwd ?? process.cwd());
				const { timeout: _timeout, ...delegatedParams } = params;
				const result = await Promise.race([
					delegated.execute(toolCallId, delegatedParams, delegatedSignal, onUpdate, ctx),
					aborted.promise,
				]);
				if (performance.now() >= deadline) {
					timedOut = true;
					timeoutController.abort();
					throw new Error("Grep deadline exceeded");
				}
				return result;
			} catch (error) {
				const target = params.path ?? ".";
				if (parentSignal?.aborted) throw new Error(`Grep aborted: "${params.pattern}" in "${target}".`);
				if (timedOut) {
					throw new Error(`Grep timed out after ${timeoutSeconds} seconds: "${params.pattern}" in "${target}".`);
				}
				throw error;
			} finally {
				clearTimeout(timer);
				aborted.dispose();
			}
		},
	};
}
