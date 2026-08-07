import { createSafeReadToolDefinition } from "../src/safe-read.ts";

const filePath = process.argv[2];
if (!filePath) throw new Error("Missing fixture path");

const tool = createSafeReadToolDefinition();
try {
	await tool.execute("worker", { path: filePath, timeout: 1 }, undefined, undefined, {
		cwd: process.cwd(),
		model: { input: ["text", "image"] },
	} as any);
	console.error("unsafe fixture was read");
	process.exitCode = 2;
} catch (error) {
	console.log(error instanceof Error ? error.message : String(error));
}
