import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface SubagentProfile {
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export type SubagentProfiles = Record<string, SubagentProfile>;

export interface LoadedProfiles {
	profiles: SubagentProfiles;
	found: boolean;
	error?: string;
}

export const DEFAULT_PROFILES: SubagentProfiles = {
	scout: { thinkingLevel: "low" },
	review: { thinkingLevel: "medium" },
	worker: { thinkingLevel: "high" },
};

export function cloneDefaultProfiles(): SubagentProfiles {
	return Object.fromEntries(
		Object.entries(DEFAULT_PROFILES).map(([name, profile]) => [name, { ...profile }]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function normalizeProfile(value: unknown): SubagentProfile | undefined {
	if (!isRecord(value)) return undefined;

	const profile: SubagentProfile = {};
	if (typeof value.model === "string" && value.model.trim()) profile.model = value.model.trim();
	if (isThinkingLevel(value.thinkingLevel)) profile.thinkingLevel = value.thinkingLevel;
	return profile;
}

export function normalizeProfiles(value: unknown): SubagentProfiles {
	if (!isRecord(value)) return {};
	const source = isRecord(value.profiles) ? value.profiles : value;
	const profiles: SubagentProfiles = {};

	for (const [name, rawProfile] of Object.entries(source)) {
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(name)) continue;
		const profile = normalizeProfile(rawProfile);
		if (profile) profiles[name] = profile;
	}

	return profiles;
}

export async function loadProfiles(path: string): Promise<LoadedProfiles> {
	try {
		const content = await readFile(path, "utf8");
		return { profiles: normalizeProfiles(JSON.parse(content)), found: true };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { profiles: cloneDefaultProfiles(), found: false };
		}
		return {
			profiles: cloneDefaultProfiles(),
			found: true,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function saveProfiles(path: string, profiles: SubagentProfiles): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ profiles }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function parseModelSpec(spec: string): { provider: string; id: string } | undefined {
	const separator = spec.indexOf("/");
	if (separator <= 0 || separator === spec.length - 1) return undefined;
	return { provider: spec.slice(0, separator), id: spec.slice(separator + 1) };
}

export function profileDescription(name: string, profile: SubagentProfile): string {
	return `${name} — ${profile.model ?? "inherit parent model"} — thinking:${profile.thinkingLevel ?? "inherit"}`;
}
