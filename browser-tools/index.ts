import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { Type } from "typebox";

const REF_ATTRIBUTE = "data-pi-browser-ref";
const OVERLAY_ID = "pi-browser-annotation-overlay";
const MAX_CONSOLE_ENTRIES = 500;
const DEFAULT_SNAPSHOT_CHARS = 30_000;
const BROWSER_TOOL_NAMES = [
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
] as const;

type ConsoleEntry = {
	timestamp: string;
	type: string;
	text: string;
	url?: string;
};

type Target = {
	ref?: string;
	selector?: string;
	text?: string;
};

type InteractiveElement = {
	ref: string;
	role: string;
	name: string;
	states: string[];
};

function envBoolean(name: string, fallback: boolean): boolean {
	const value = process.env[name]?.trim().toLowerCase();
	if (!value) return fallback;
	return ["1", "true", "yes", "on"].includes(value);
}

function clip(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Truncated ${text.length - maxChars} characters]`;
}

function normalizeUrl(url: string): string {
	const trimmed = url.trim();
	if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
	return `http://${trimmed}`;
}

function normalizeRef(ref: string): string {
	return ref.trim().replace(/^@/, "");
}

function safeTimestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export default function browserTools(pi: ExtensionAPI) {
	let context: BrowserContext | undefined;
	let activePage: Page | undefined;
	let activeProfileDir: string | undefined;
	let profileNotice: string | undefined;
	let sessionId: string | undefined;
	let operationQueue: Promise<void> = Promise.resolve();
	const observedPages = new WeakSet<Page>();
	const instanceId = randomUUID().slice(0, 8);
	let consoleEntries: ConsoleEntry[] = [];

	const primaryProfileDir = process.env.PI_BROWSER_PROFILE_DIR
		? resolve(process.env.PI_BROWSER_PROFILE_DIR)
		: join(homedir(), ".pi", "agent", "browser-profile");
	const fallbackProfileRoot = process.env.PI_BROWSER_PROFILE_ROOT
		? resolve(process.env.PI_BROWSER_PROFILE_ROOT)
		: join(homedir(), ".pi", "agent", "browser-profiles");
	const screenshotDir = process.env.PI_BROWSER_SCREENSHOT_DIR
		? resolve(process.env.PI_BROWSER_SCREENSHOT_DIR)
		: join(tmpdir(), "pi-browser-screenshots");
	const headless = envBoolean("PI_BROWSER_HEADLESS", false);
	const channel = process.env.PI_BROWSER_CHANNEL?.trim() || "chrome";
	const executablePath = process.env.PI_BROWSER_EXECUTABLE_PATH?.trim();

	async function serialized<T>(operation: () => Promise<T>): Promise<T> {
		let release!: () => void;
		const previous = operationQueue;
		operationQueue = new Promise<void>((resolveQueue) => {
			release = resolveQueue;
		});
		await previous.catch(() => undefined);
		try {
			return await operation();
		} finally {
			release();
		}
	}

	function setBrowserToolsEnabled(enabled: boolean): void {
		const browserToolNames = new Set<string>(BROWSER_TOOL_NAMES);
		const activeTools = pi.getActiveTools().filter((name) => !browserToolNames.has(name));
		pi.setActiveTools(enabled ? [...new Set([...activeTools, ...BROWSER_TOOL_NAMES])] : activeTools);
	}

	function browserToolsEnabled(): boolean {
		const activeTools = new Set(pi.getActiveTools());
		return BROWSER_TOOL_NAMES.every((name) => activeTools.has(name));
	}

	async function closeManagedBrowser(): Promise<boolean> {
		const browserContext = context;
		context = undefined;
		activePage = undefined;
		activeProfileDir = undefined;
		profileNotice = undefined;
		if (browserContext) await browserContext.close();
		return Boolean(browserContext);
	}

	function recordConsole(entry: ConsoleEntry): void {
		consoleEntries.push(entry);
		if (consoleEntries.length > MAX_CONSOLE_ENTRIES) {
			consoleEntries = consoleEntries.slice(-MAX_CONSOLE_ENTRIES);
		}
	}

	function observePage(page: Page): void {
		if (observedPages.has(page)) return;
		observedPages.add(page);
		page.on("console", (message) => {
			const location = message.location();
			recordConsole({
				timestamp: new Date().toISOString(),
				type: message.type(),
				text: message.text(),
				url: location.url || page.url(),
			});
		});
		page.on("pageerror", (error) => {
			recordConsole({
				timestamp: new Date().toISOString(),
				type: "pageerror",
				text: error.stack || error.message,
				url: page.url(),
			});
		});
		page.on("requestfailed", (request) => {
			recordConsole({
				timestamp: new Date().toISOString(),
				type: "requestfailed",
				text: `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "failed"}`,
				url: page.url(),
			});
		});
		page.on("close", () => {
			if (activePage === page) activePage = undefined;
		});
	}

	function profileKey(): string {
		const normalizedSession = (sessionId || "session").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
		return `${normalizedSession}-${process.pid}-${instanceId}`;
	}

	function isProfileLockError(message: string): boolean {
		return /ProcessSingleton|profile (?:directory )?is already in use|Opening in existing browser session|SingletonLock/i.test(message);
	}

	async function launchAt(profileDir: string): Promise<BrowserContext> {
		await mkdir(profileDir, { recursive: true });
		return chromium.launchPersistentContext(profileDir, {
			channel: executablePath ? undefined : channel,
			executablePath: executablePath || undefined,
			headless,
			viewport: { width: 1440, height: 900 },
			args: ["--no-first-run", "--no-default-browser-check"],
		});
	}

	function launchError(error: unknown, attemptedFallback?: string): Error {
		const message = error instanceof Error ? error.message : String(error);
		const fallbackMessage = attemptedFallback ? ` The isolated fallback profile also failed (${attemptedFallback}).` : "";
		return new Error(
			`Could not launch Google Chrome.${fallbackMessage} Ensure Chrome is installed and writable profile directories are available. ` +
				`Set PI_BROWSER_EXECUTABLE_PATH to override the executable or PI_BROWSER_CHANNEL to change the Playwright channel.\n${message}`,
		);
	}

	async function launchBrowser(): Promise<BrowserContext> {
		if (context) return context;
		profileNotice = undefined;
		try {
			context = await launchAt(primaryProfileDir);
			activeProfileDir = primaryProfileDir;
		} catch (primaryError) {
			const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
			if (!isProfileLockError(primaryMessage)) throw launchError(primaryError);

			const fallbackProfileDir = join(fallbackProfileRoot, profileKey());
			try {
				context = await launchAt(fallbackProfileDir);
				activeProfileDir = fallbackProfileDir;
				profileNotice = `Primary Chrome profile was already in use; launched an isolated profile for this agent: ${fallbackProfileDir}`;
			} catch (fallbackError) {
				throw launchError(fallbackError, fallbackProfileDir);
			}
		}

		for (const page of context.pages()) observePage(page);
		context.on("page", (page) => {
			activePage = page;
			observePage(page);
		});
		context.on("close", () => {
			context = undefined;
			activePage = undefined;
			activeProfileDir = undefined;
		});
		return context;
	}

	async function getPage(): Promise<Page> {
		const browserContext = await launchBrowser();
		if (activePage && !activePage.isClosed()) return activePage;
		const pages = browserContext.pages().filter((page) => !page.isClosed());
		activePage = pages.at(-1) ?? (await browserContext.newPage());
		observePage(activePage);
		return activePage;
	}

	async function settle(page: Page): Promise<void> {
		await page.waitForTimeout(150);
		await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);
		const pages = context?.pages().filter((candidate) => !candidate.isClosed()) ?? [];
		if (pages.length > 0) activePage = pages.at(-1);
	}

	function targetLocator(page: Page, target: Target): Locator {
		const supplied = [target.ref, target.selector, target.text].filter(
			(value): value is string => typeof value === "string" && value.trim().length > 0,
		);
		if (supplied.length !== 1) {
			throw new Error("Provide exactly one target: ref, selector, or text.");
		}
		if (target.ref) {
			return page.locator(`[${REF_ATTRIBUTE}="${normalizeRef(target.ref)}"]`).first();
		}
		if (target.selector) return page.locator(target.selector).first();
		return page.getByText(target.text!, { exact: true }).first();
	}

	async function assignRefs(page: Page): Promise<InteractiveElement[]> {
		return page.evaluate(({ attribute }) => {
			const selector = [
				"a[href]",
				"button",
				"input",
				"textarea",
				"select",
				"summary",
				"[contenteditable='true']",
				"[role='button']",
				"[role='link']",
				"[role='checkbox']",
				"[role='radio']",
				"[role='switch']",
				"[role='tab']",
				"[role='menuitem']",
				"[role='option']",
				"[tabindex]:not([tabindex='-1'])",
			].join(",");

			document.querySelectorAll(`[${attribute}]`).forEach((element) => element.removeAttribute(attribute));

			const isVisible = (element: Element): boolean => {
				const style = window.getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
			};
			const clean = (value: string | null | undefined): string =>
				(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
			const inferredRole = (element: Element): string => {
				const explicit = element.getAttribute("role");
				if (explicit) return explicit;
				const tag = element.tagName.toLowerCase();
				if (tag === "a") return "link";
				if (tag === "button" || tag === "summary") return "button";
				if (tag === "textarea") return "textbox";
				if (tag === "select") return "combobox";
				if (tag === "input") {
					const type = (element.getAttribute("type") || "text").toLowerCase();
					if (["button", "submit", "reset"].includes(type)) return "button";
					if (type === "checkbox") return "checkbox";
					if (type === "radio") return "radio";
					if (type === "range") return "slider";
					return "textbox";
				}
				return tag;
			};
			const accessibleName = (element: Element): string => {
				const labelledBy = element.getAttribute("aria-labelledby");
				const labelledText = labelledBy
					?.split(/\s+/)
					.map((id) => document.getElementById(id)?.textContent)
					.filter(Boolean)
					.join(" ");
				const html = element as HTMLElement;
				const input = element as HTMLInputElement;
				return clean(
					element.getAttribute("aria-label") ||
						labelledText ||
						element.getAttribute("alt") ||
						element.getAttribute("title") ||
						input.placeholder ||
						input.name ||
						html.innerText ||
						(element.tagName === "INPUT" && input.type !== "password" ? input.value : ""),
				);
			};

			const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(0, 500);
			return elements.map((element, index) => {
				const ref = `e${index + 1}`;
				element.setAttribute(attribute, ref);
				const input = element as HTMLInputElement;
				const states: string[] = [];
				if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") states.push("disabled");
				if ("checked" in input && input.checked) states.push("checked");
				if (element.getAttribute("aria-expanded")) states.push(`expanded=${element.getAttribute("aria-expanded")}`);
				if (element.tagName === "A" && element.getAttribute("href")) states.push(`href=${clean(element.getAttribute("href"))}`);
				if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) && input.type !== "password" && input.value) {
					states.push(`value=${clean(input.value)}`);
				}
				return { ref, role: inferredRole(element), name: accessibleName(element), states };
			});
		}, { attribute: REF_ATTRIBUTE });
	}

	async function addAnnotations(page: Page): Promise<number> {
		const elements = await assignRefs(page);
		await page.evaluate(({ attribute, overlayId }) => {
			document.getElementById(overlayId)?.remove();
			const overlay = document.createElement("div");
			overlay.id = overlayId;
			overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2147483647;";
			for (const element of document.querySelectorAll(`[${attribute}]`)) {
				const rect = element.getBoundingClientRect();
				const ref = element.getAttribute(attribute);
				if (!ref || rect.width <= 0 || rect.height <= 0) continue;
				const box = document.createElement("div");
				box.style.cssText = `position:absolute;left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;width:${rect.width}px;height:${rect.height}px;border:2px solid #ff2d55;box-sizing:border-box;`;
				const label = document.createElement("span");
				label.textContent = `@${ref}`;
				label.style.cssText = "position:absolute;left:-2px;top:-20px;background:#ff2d55;color:white;font:700 12px/18px ui-monospace,monospace;padding:0 4px;border-radius:3px;white-space:nowrap;";
				box.appendChild(label);
				overlay.appendChild(box);
			}
			document.documentElement.appendChild(overlay);
		}, { attribute: REF_ATTRIBUTE, overlayId: OVERLAY_ID });
		return elements.length;
	}

	async function removeAnnotations(page: Page): Promise<void> {
		await page.evaluate((overlayId) => document.getElementById(overlayId)?.remove(), OVERLAY_ID).catch(() => undefined);
	}

	pi.registerTool({
		name: "browser_navigate",
		label: "Browser Navigate",
		description: "Open visible Google Chrome and navigate the active tab to a URL. URLs without a scheme use http://.",
		promptSnippet: "Drive a visible Google Chrome session with Playwright",
		promptGuidelines: [
			"Use browser_snapshot after navigation and before browser interactions; use browser_vision when visual appearance matters.",
			"Call stateful browser_* tools sequentially rather than issuing dependent browser actions in parallel.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL to visit, for example http://localhost:3000" }),
			waitUntil: Type.Optional(Type.String({ description: "load, domcontentloaded, networkidle, or commit; defaults to domcontentloaded" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				const waitUntil = params.waitUntil ?? "domcontentloaded";
				if (!["load", "domcontentloaded", "networkidle", "commit"].includes(waitUntil)) {
					throw new Error(`Unsupported waitUntil value: ${waitUntil}`);
				}
				const response = await page.goto(normalizeUrl(params.url), {
					waitUntil: waitUntil as "load" | "domcontentloaded" | "networkidle" | "commit",
					timeout: 30_000,
				});
				activePage = page;
				return {
					content: [{ type: "text", text: `Navigated to ${page.url()}\nTitle: ${await page.title()}\nStatus: ${response?.status() ?? "n/a"}${profileNotice ? `\n${profileNotice}` : ""}` }],
					details: { url: page.url(), title: await page.title(), status: response?.status(), profileDir: activeProfileDir, isolatedProfile: Boolean(profileNotice) },
				};
			});
		},
	});

	pi.registerTool({
		name: "browser_snapshot",
		label: "Browser Snapshot",
		description: "Return the active page accessibility structure, visible text, and interactive element refs such as @e1.",
		parameters: Type.Object({
			maxChars: Type.Optional(Type.Integer({ minimum: 2_000, maximum: 50_000, description: "Maximum returned characters; defaults to 30000" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				const maxChars = params.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
				const elements = await assignRefs(page);
				const aria = await page.locator("body").ariaSnapshot({ timeout: 5_000 }).catch(() => "[Accessibility snapshot unavailable]");
				const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
				const interactive = elements
					.map((element) => `@${element.ref} ${element.role} ${JSON.stringify(element.name)}${element.states.length ? ` [${element.states.join(", ")}]` : ""}`)
					.join("\n");
				const output = [
					`URL: ${page.url()}`,
					`Title: ${await page.title()}`,
					"",
					"Interactive elements:",
					interactive || "[none]",
					"",
					"Accessibility tree:",
					aria,
					"",
					"Visible page text:",
					bodyText,
				].join("\n");
				return {
					content: [{ type: "text", text: clip(output, maxChars) }],
					details: { url: page.url(), title: await page.title(), interactiveCount: elements.length },
				};
			});
		},
	});

	pi.registerTool({
		name: "browser_click",
		label: "Browser Click",
		description: "Click an element in the active page by snapshot ref, CSS selector, or exact visible text.",
		parameters: Type.Object({
			ref: Type.Optional(Type.String({ description: "Snapshot ref such as @e1" })),
			selector: Type.Optional(Type.String({ description: "CSS selector" })),
			text: Type.Optional(Type.String({ description: "Exact visible text" })),
			button: Type.Optional(Type.String({ description: "left, right, or middle; defaults to left" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				const button = params.button ?? "left";
				if (!["left", "right", "middle"].includes(button)) throw new Error(`Unsupported mouse button: ${button}`);
				const locator = targetLocator(page, params);
				await locator.click({ button: button as "left" | "right" | "middle", timeout: 10_000 });
				await settle(page);
				const current = await getPage();
				return {
					content: [{ type: "text", text: `Clicked element.\nURL: ${current.url()}\nTitle: ${await current.title()}` }],
					details: { url: current.url(), title: await current.title() },
				};
			});
		},
	});

	pi.registerTool({
		name: "browser_type",
		label: "Browser Type",
		description: "Fill or type into an element by snapshot ref, CSS selector, or exact visible text.",
		parameters: Type.Object({
			ref: Type.Optional(Type.String({ description: "Snapshot ref such as @e1" })),
			selector: Type.Optional(Type.String({ description: "CSS selector" })),
			textTarget: Type.Optional(Type.String({ description: "Exact visible text identifying the target" })),
			text: Type.String({ description: "Text to enter" }),
			clear: Type.Optional(Type.Boolean({ description: "Replace existing content; defaults to true" })),
			submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing; defaults to false" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				const locator = targetLocator(page, { ref: params.ref, selector: params.selector, text: params.textTarget });
				if (params.clear ?? true) await locator.fill(params.text, { timeout: 10_000 });
				else await locator.pressSequentially(params.text, { timeout: 10_000 });
				if (params.submit) await locator.press("Enter");
				await settle(page);
				return {
					content: [{ type: "text", text: `Entered text${params.submit ? " and pressed Enter" : ""}.\nURL: ${page.url()}` }],
					details: { url: page.url() },
				};
			});
		},
	});

	pi.registerTool({
		name: "browser_press",
		label: "Browser Press Key",
		description: "Press a Playwright keyboard key globally or on a targeted element, for example Tab, Enter, Escape, or Control+A.",
		parameters: Type.Object({
			key: Type.String({ description: "Playwright key name or chord" }),
			ref: Type.Optional(Type.String({ description: "Optional snapshot ref" })),
			selector: Type.Optional(Type.String({ description: "Optional CSS selector" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				if (params.ref || params.selector) await targetLocator(page, { ref: params.ref, selector: params.selector }).press(params.key);
				else await page.keyboard.press(params.key);
				await settle(page);
				return { content: [{ type: "text", text: `Pressed ${params.key}.\nURL: ${page.url()}` }], details: { url: page.url() } };
			});
		},
	});

	pi.registerTool({
		name: "browser_scroll",
		label: "Browser Scroll",
		description: "Scroll the active page up, down, left, right, to the top, or to the bottom.",
		parameters: Type.Object({
			direction: Type.String({ description: "up, down, left, right, top, or bottom" }),
			amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000, description: "Pixels for directional scrolling; defaults to 700" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				const direction = params.direction.toLowerCase();
				const amount = params.amount ?? 700;
				if (!["up", "down", "left", "right", "top", "bottom"].includes(direction)) throw new Error(`Unsupported scroll direction: ${direction}`);
				const position = await page.evaluate(({ direction, amount }) => {
					if (direction === "top") window.scrollTo({ top: 0, behavior: "instant" });
					else if (direction === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
					else window.scrollBy({
						left: direction === "left" ? -amount : direction === "right" ? amount : 0,
						top: direction === "up" ? -amount : direction === "down" ? amount : 0,
						behavior: "instant",
					});
					return { x: window.scrollX, y: window.scrollY };
				}, { direction, amount });
				return { content: [{ type: "text", text: `Scrolled ${direction}. Position: x=${position.x}, y=${position.y}` }], details: position };
			});
		},
	});

	pi.registerTool({
		name: "browser_back",
		label: "Browser Back",
		description: "Navigate the active tab back in browser history.",
		parameters: Type.Object({}),
		async execute() {
			return serialized(async () => {
				const page = await getPage();
				await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
				return { content: [{ type: "text", text: `Went back to ${page.url()}\nTitle: ${await page.title()}` }], details: { url: page.url() } };
			});
		},
	});

	pi.registerTool({
		name: "browser_resize",
		label: "Browser Resize",
		description: "Set the active page viewport size for responsive testing.",
		parameters: Type.Object({
			width: Type.Integer({ minimum: 240, maximum: 7680 }),
			height: Type.Integer({ minimum: 240, maximum: 4320 }),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				await page.setViewportSize({ width: params.width, height: params.height });
				return { content: [{ type: "text", text: `Viewport set to ${params.width}×${params.height}.` }], details: { width: params.width, height: params.height } };
			});
		},
	});

	pi.registerTool({
		name: "browser_wait",
		label: "Browser Wait",
		description: "Wait for a duration, CSS selector, or visible text in the active page.",
		parameters: Type.Object({
			milliseconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 30_000 })),
			selector: Type.Optional(Type.String()),
			text: Type.Optional(Type.String()),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				const page = await getPage();
				const supplied = [params.milliseconds !== undefined, Boolean(params.selector), Boolean(params.text)].filter(Boolean).length;
				if (supplied !== 1) throw new Error("Provide exactly one of milliseconds, selector, or text.");
				if (params.milliseconds !== undefined) await page.waitForTimeout(params.milliseconds);
				else if (params.selector) await page.locator(params.selector).first().waitFor({ state: "visible", timeout: 30_000 });
				else await page.getByText(params.text!, { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
				return { content: [{ type: "text", text: `Wait condition satisfied.\nURL: ${page.url()}` }], details: { url: page.url() } };
			});
		},
	});

	pi.registerTool({
		name: "browser_vision",
		label: "Browser Screenshot",
		description: "Capture the active page as a screenshot, return it to the model for visual analysis, and save it to disk. Can annotate interactive refs.",
		parameters: Type.Object({
			question: Type.Optional(Type.String({ description: "What the model should inspect in the screenshot" })),
			annotate: Type.Optional(Type.Boolean({ description: "Overlay @eN labels on interactive elements" })),
			fullPage: Type.Optional(Type.Boolean({ description: "Capture the full document instead of the viewport" })),
			format: Type.Optional(Type.String({ description: "png or jpeg; defaults to png" })),
			path: Type.Optional(Type.String({ description: "Optional output path, resolved against Pi's working directory" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return serialized(async () => {
				const page = await getPage();
				const format = (params.format ?? "png").toLowerCase();
				if (!["png", "jpeg"].includes(format)) throw new Error(`Unsupported screenshot format: ${format}`);
				const extension = format === "jpeg" ? ".jpg" : ".png";
				let outputPath = params.path
					? (isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path))
					: join(screenshotDir, `screenshot-${safeTimestamp()}${extension}`);
				if (!extname(outputPath)) outputPath += extension;
				await mkdir(dirname(outputPath), { recursive: true });
				let annotationCount = 0;
				try {
					if (params.annotate) annotationCount = await addAnnotations(page);
					const image = await page.screenshot({
						path: outputPath,
						type: format as "png" | "jpeg",
						fullPage: params.fullPage ?? false,
						quality: format === "jpeg" ? 85 : undefined,
					});
					const prompt = params.question ? `\nInspect for: ${params.question}` : "";
					return {
						content: [
							{ type: "text", text: `Screenshot captured: ${outputPath}\nURL: ${page.url()}${params.annotate ? `\nAnnotated ${annotationCount} interactive elements.` : ""}${prompt}` },
							{ type: "image", data: image.toString("base64"), mimeType: format === "jpeg" ? "image/jpeg" : "image/png" },
						],
						details: { path: outputPath, url: page.url(), annotationCount },
					};
				} finally {
					if (params.annotate) await removeAnnotations(page);
				}
			});
		},
	});

	pi.registerTool({
		name: "browser_console",
		label: "Browser Console",
		description: "Read captured browser console messages, uncaught page errors, and failed requests.",
		parameters: Type.Object({
			clear: Type.Optional(Type.Boolean({ description: "Clear entries after returning them" })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Newest entries to return; defaults to 100" })),
		}),
		async execute(_id, params) {
			return serialized(async () => {
				await getPage();
				const entries = consoleEntries.slice(-(params.limit ?? 100));
				if (params.clear) consoleEntries = [];
				const text = entries.length
					? entries.map((entry) => `[${entry.timestamp}] ${entry.type.toUpperCase()} ${entry.text}${entry.url ? ` (${entry.url})` : ""}`).join("\n")
					: "No browser console entries captured.";
				return { content: [{ type: "text", text: clip(text, 50_000) }], details: { count: entries.length, cleared: params.clear ?? false } };
			});
		},
	});

	pi.registerTool({
		name: "browser_close",
		label: "Browser Close",
		description: "Close the managed Chrome session. Cookies remain in the dedicated persistent profile.",
		parameters: Type.Object({}),
		async execute() {
			return serialized(async () => {
				const closed = await closeManagedBrowser();
				return { content: [{ type: "text", text: closed ? "Closed the managed Chrome session." : "The managed Chrome session was already closed." }], details: {} };
			});
		},
	});

	pi.registerCommand("browser", {
		description: "Enable or disable browser tools: /browser on | /browser off",
		getArgumentCompletions: (prefix) => {
			const normalizedPrefix = prefix.trim().toLowerCase();
			const options = [
				{ value: "on", label: "on", description: "Enable browser tools" },
				{ value: "off", label: "off", description: "Disable browser tools" },
			];
			const matches = options.filter((option) => option.value.startsWith(normalizedPrefix));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "on") {
				setBrowserToolsEnabled(true);
				ctx.ui.notify("Browser tools enabled for this session.", "info");
				return;
			}
			if (action === "off") {
				setBrowserToolsEnabled(false);
				await serialized(() => closeManagedBrowser());
				ctx.ui.notify("Browser tools disabled and managed Chrome closed.", "info");
				return;
			}
			ctx.ui.notify(
				`Browser tools are currently ${browserToolsEnabled() ? "on" : "off"}. Usage: /browser on | /browser off`,
				"info",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		setBrowserToolsEnabled(false);
	});

	pi.on("session_shutdown", async () => {
		await serialized(async () => {
			await closeManagedBrowser().catch(() => undefined);
		});
	});
}
