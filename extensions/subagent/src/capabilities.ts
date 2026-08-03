export const CAPABILITY_TOOLS = {
	"read-only": ["read", "grep", "find", "ls"],
	write: ["read", "grep", "find", "ls", "bash", "edit", "write"],
} as const;

export type Capability = keyof typeof CAPABILITY_TOOLS;

export function toolsForCapability(capability: Capability): string[] {
	return [...CAPABILITY_TOOLS[capability]];
}
