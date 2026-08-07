import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSafeReadToolDefinition } from "./src/safe-read.ts";

export { createSafeReadToolDefinition } from "./src/safe-read.ts";

export default function safeReadExtension(pi: ExtensionAPI): void {
	pi.registerTool(createSafeReadToolDefinition());
}
