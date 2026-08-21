import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSafeGrepToolDefinition } from "./src/safe-grep.ts";

export { createSafeGrepToolDefinition } from "./src/safe-grep.ts";

export default function safeGrepExtension(pi: ExtensionAPI): void {
	pi.registerTool(createSafeGrepToolDefinition());
}
