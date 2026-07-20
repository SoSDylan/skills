import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = join(tmpdir(), "pi-browser-tools-concurrent-agents");
process.env.PI_BROWSER_HEADLESS = "true";
process.env.PI_BROWSER_PROFILE_DIR = join(testRoot, "primary-profile");
process.env.PI_BROWSER_PROFILE_ROOT = join(testRoot, "fallback-profiles");
process.env.PI_BROWSER_SCREENSHOT_DIR = join(testRoot, "screenshots");

const extension = (await import("../index.ts")).default;

function createAgent() {
	const tools = new Map();
	const commands = new Map();
	const hooks = new Map();
	let activeTools = [];
	extension({
		registerTool(tool) {
			tools.set(tool.name, tool);
			activeTools.push(tool.name);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names) {
			activeTools = [...names];
		},
		on(name, handler) {
			hooks.set(name, handler);
		},
	});
	return { tools, commands, hooks, getActiveTools: () => [...activeTools] };
}

await rm(testRoot, { recursive: true, force: true });
const first = createAgent();
const second = createAgent();

try {
	const firstNavigation = await first.tools.get("browser_navigate").execute("first", {
		url: "data:text/html,<title>First agent</title><p>first</p>",
	});
	const secondNavigation = await second.tools.get("browser_navigate").execute("second", {
		url: "data:text/html,<title>Second agent</title><p>second</p>",
	});
	assert.equal(firstNavigation.details.isolatedProfile, false);
	assert.equal(secondNavigation.details.isolatedProfile, true);

	const firstSnapshot = await first.tools.get("browser_snapshot").execute("first-snapshot", {});
	const secondSnapshot = await second.tools.get("browser_snapshot").execute("second-snapshot", {});
	assert.match(firstSnapshot.content[0].text, /First agent/);
	assert.match(secondSnapshot.content[0].text, /Second agent/);
	console.log("PASS: two agent instances launched independent Chrome contexts concurrently");
} finally {
	await first.tools.get("browser_close").execute("first-close", {}).catch(() => undefined);
	await second.tools.get("browser_close").execute("second-close", {}).catch(() => undefined);
	await rm(testRoot, { recursive: true, force: true });
}
