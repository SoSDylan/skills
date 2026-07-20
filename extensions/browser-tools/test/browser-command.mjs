import assert from "node:assert/strict";

const extension = (await import("../index.ts")).default;
const browserToolNames = [
	"browser_navigate",
	"browser_snapshot",
	"browser_click",
	"browser_type",
	"browser_press",
	"browser_scroll",
	"browser_back",
	"browser_resize",
	"browser_wait",
	"browser_vision",
	"browser_console",
	"browser_close",
];
const commands = new Map();
const hooks = new Map();
const notifications = [];
let activeTools = ["read"];

extension({
	registerTool(tool) {
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

const context = {
	sessionManager: { getSessionId: () => "command-test" },
	ui: { notify: (message, level) => notifications.push({ message, level }) },
};

await hooks.get("session_start")({}, context);
assert.deepEqual(activeTools, ["read"], "browser tools should be disabled by default");

const browserCommand = commands.get("browser");
assert.deepEqual(
	browserCommand.getArgumentCompletions("").map(({ value }) => value),
	["on", "off"],
	"empty argument prefix should suggest both states",
);
assert.deepEqual(
	browserCommand.getArgumentCompletions("on").map(({ value }) => value),
	["on"],
	"argument completions should filter by prefix",
);
assert.equal(browserCommand.getArgumentCompletions("unknown"), null);

await browserCommand.handler("on", context);
assert.equal(browserToolNames.every((name) => activeTools.includes(name)), true);
assert.equal(activeTools.includes("read"), true, "enabling browser tools should preserve other tools");

await browserCommand.handler("off", context);
assert.deepEqual(activeTools, ["read"], "disabling browser tools should preserve other tools");
assert.match(notifications.at(-1).message, /disabled/);

await browserCommand.handler("", context);
assert.match(notifications.at(-1).message, /currently off/);
assert.match(notifications.at(-1).message, /\/browser on \| \/browser off/);

console.log("PASS: /browser on and /browser off gate browser tools");
