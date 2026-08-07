import { constants, type Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { ReadOperations, ReadToolInput } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const DEFAULT_TIMEOUT_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 2_147_483;
const IMAGE_TYPE_SNIFF_BYTES = 4_100;

export interface SafeReadInput extends ReadToolInput {
	timeout?: number;
}

export type RegularFileReader = (absolutePath: string, signal: AbortSignal) => Promise<Buffer>;

export interface SafeReadToolOptions {
	defaultTimeoutSeconds?: number;
	readRegularFile?: RegularFileReader;
}

function createSafeReadSchema(defaultTimeoutSeconds: number) {
	return Type.Object({
		path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
		offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
		limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
		timeout: Type.Optional(
			Type.Number({
				description: `Read deadline in seconds (default: ${defaultTimeoutSeconds})`,
				default: defaultTimeoutSeconds,
				minimum: 0.001,
				maximum: MAX_TIMEOUT_SECONDS,
			}),
		),
	});
}

function fileType(stats: Stats): string {
	if (stats.isDirectory()) return "directory";
	if (stats.isFIFO()) return "named pipe (FIFO)";
	if (stats.isSocket()) return "Unix socket";
	if (stats.isBlockDevice()) return "block device";
	if (stats.isCharacterDevice()) return "character device";
	return "non-regular filesystem object";
}

function assertRegularFile(stats: Stats, absolutePath: string): void {
	if (!stats.isFile()) {
		throw new Error(`Cannot read non-regular file: "${absolutePath}" is a ${fileType(stats)}.`);
	}
}

/**
 * Read one regular-file snapshot. stat() deliberately follows symlinks. O_NONBLOCK
 * prevents an object swapped to a FIFO after stat() from blocking open(). fstat()
 * then verifies that the opened object is still a regular file.
 */
export async function readRegularFile(absolutePath: string, signal: AbortSignal): Promise<Buffer> {
	signal.throwIfAborted();
	const pathStats = await stat(absolutePath);
	assertRegularFile(pathStats, absolutePath);
	signal.throwIfAborted();

	const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		signal.throwIfAborted();
		const openedStats = await handle.stat();
		assertRegularFile(openedStats, absolutePath);
		signal.throwIfAborted();
		return await handle.readFile({ signal });
	} finally {
		await handle.close();
	}
}

function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
	if (buffer.length < bytes.length) return false;
	return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Buffer, offset: number, text: string): boolean {
	if (buffer.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index += 1) {
		if (buffer[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

function readUint16LE(buffer: Buffer, offset: number): number {
	return (buffer[offset] ?? 0) + ((buffer[offset + 1] ?? 0) << 8);
}

function readUint32BE(buffer: Buffer, offset: number): number {
	return (
		(buffer[offset] ?? 0) * 0x1000000 +
		((buffer[offset + 1] ?? 0) << 16) +
		((buffer[offset + 2] ?? 0) << 8) +
		(buffer[offset + 3] ?? 0)
	);
}

function readUint32LE(buffer: Buffer, offset: number): number {
	return (
		(buffer[offset] ?? 0) +
		((buffer[offset + 1] ?? 0) << 8) +
		((buffer[offset + 2] ?? 0) << 16) +
		(buffer[offset + 3] ?? 0) * 0x1000000
	);
}

function isPng(buffer: Buffer): boolean {
	return buffer.length >= 16 && readUint32BE(buffer, 8) === 13 && startsWithAscii(buffer, 12, "IHDR");
}

function isAnimatedPng(buffer: Buffer): boolean {
	let offset = 8;
	while (offset + 8 <= buffer.length) {
		const chunkLength = readUint32BE(buffer, offset);
		const chunkTypeOffset = offset + 4;
		if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;
		if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;
		const nextOffset = offset + 8 + chunkLength + 4;
		if (nextOffset <= offset || nextOffset > buffer.length) return false;
		offset = nextOffset;
	}
	return false;
}

function isBmp(buffer: Buffer): boolean {
	if (buffer.length < 26) return false;
	const declaredFileSize = readUint32LE(buffer, 2);
	const pixelDataOffset = readUint32LE(buffer, 10);
	const dibHeaderSize = readUint32LE(buffer, 14);
	if (declaredFileSize !== 0 && declaredFileSize < 26) return false;
	if (pixelDataOffset < 14 + dibHeaderSize) return false;
	if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false;

	let colorPlanes: number;
	let bitsPerPixel: number;
	if (dibHeaderSize === 12) {
		colorPlanes = readUint16LE(buffer, 22);
		bitsPerPixel = readUint16LE(buffer, 24);
	} else if (dibHeaderSize >= 40 && dibHeaderSize <= 124) {
		if (buffer.length < 30) return false;
		colorPlanes = readUint16LE(buffer, 26);
		bitsPerPixel = readUint16LE(buffer, 28);
	} else {
		return false;
	}
	return colorPlanes === 1 && [1, 4, 8, 16, 24, 32].includes(bitsPerPixel);
}

/** Match Pi's supported image signature detection against an in-memory snapshot. */
export function detectSupportedImageMimeType(buffer: Buffer): string | null {
	const sample = buffer.subarray(0, IMAGE_TYPE_SNIFF_BYTES);
	if (startsWith(sample, [0xff, 0xd8, 0xff])) return sample[3] === 0xf7 ? null : "image/jpeg";
	if (startsWith(sample, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return isPng(sample) && !isAnimatedPng(sample) ? "image/png" : null;
	}
	if (startsWithAscii(sample, 0, "GIF")) return "image/gif";
	if (startsWithAscii(sample, 0, "RIFF") && startsWithAscii(sample, 8, "WEBP")) return "image/webp";
	if (startsWithAscii(sample, 0, "BM") && isBmp(sample)) return "image/bmp";
	return null;
}

function operationsFor(reader: RegularFileReader, signal: AbortSignal): ReadOperations {
	let snapshotPath: string | undefined;
	let snapshot: Promise<Buffer> | undefined;

	const load = (absolutePath: string): Promise<Buffer> => {
		if (snapshotPath !== undefined && snapshotPath !== absolutePath) {
			throw new Error("Safe read received inconsistent resolved paths.");
		}
		snapshotPath = absolutePath;
		snapshot ??= reader(absolutePath, signal);
		return snapshot;
	};

	return {
		async access(absolutePath) {
			await load(absolutePath);
		},
		readFile: load,
		async detectImageMimeType(absolutePath) {
			return detectSupportedImageMimeType(await load(absolutePath));
		},
	};
}

function validateTimeout(timeoutSeconds: number): void {
	if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.001 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
		throw new Error(`Invalid read timeout: ${timeoutSeconds}. Use 0.001-${MAX_TIMEOUT_SECONDS} seconds.`);
	}
}

function getImageAutoResize(ctx: any): boolean {
	const projectTrusted = typeof ctx?.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
	return SettingsManager.create(ctx?.cwd ?? process.cwd(), undefined, { projectTrusted }).getImageAutoResize();
}

export function createSafeReadToolDefinition(options: SafeReadToolOptions = {}) {
	const defaultTimeoutSeconds = options.defaultTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
	validateTimeout(defaultTimeoutSeconds);
	const reader = options.readRegularFile ?? readRegularFile;
	const builtIn = createReadToolDefinition(process.cwd());
	const parameters = createSafeReadSchema(defaultTimeoutSeconds);

	return {
		...builtIn,
		label: "read (safe)",
		description: `${builtIn.description} Only regular files are allowed. Every read has an enforced timeout, which defaults to ${defaultTimeoutSeconds} seconds.`,
		parameters,
		prepareArguments(args: unknown): SafeReadInput {
			if (!args || typeof args !== "object" || Array.isArray(args)) return args as SafeReadInput;
			const input = args as Record<string, unknown>;
			if (input.timeout !== undefined) return args as SafeReadInput;
			return { ...input, timeout: defaultTimeoutSeconds } as SafeReadInput;
		},
		async execute(toolCallId: string, params: SafeReadInput, parentSignal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			const timeoutSeconds = params.timeout ?? defaultTimeoutSeconds;
			validateTimeout(timeoutSeconds);

			const timeoutController = new AbortController();
			const signal = parentSignal
				? AbortSignal.any([parentSignal, timeoutController.signal])
				: timeoutController.signal;
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				timeoutController.abort();
			}, timeoutSeconds * 1_000);
			timer.unref();

			try {
				const delegated = createReadToolDefinition(ctx?.cwd ?? process.cwd(), {
					autoResizeImages: getImageAutoResize(ctx),
					operations: operationsFor(reader, signal),
				});
				return await delegated.execute(
					toolCallId,
					{ path: params.path, offset: params.offset, limit: params.limit },
					signal,
					onUpdate,
					ctx,
				);
			} catch (error) {
				if (parentSignal?.aborted) throw new Error(`Read aborted: "${params.path}".`);
				if (timedOut) throw new Error(`Read timed out after ${timeoutSeconds} seconds: "${params.path}".`);
				throw error;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
