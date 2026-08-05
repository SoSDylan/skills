import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, getKeybindings, Input, truncateToWidth } from "@earendil-works/pi-tui";

export type ModelSelection =
	| { kind: "cancelled" }
	| { kind: "inherit" }
	| { kind: "manual" }
	| { kind: "model"; value: string };

interface ModelChoice {
	value: string;
	label: string;
	description: string;
	searchText: string;
}

function modelChoices(ctx: ExtensionContext, current?: string): ModelChoice[] {
	const models = ctx.modelRegistry
		.getAvailable()
		.map((model) => ({
			value: `${model.provider}/${model.id}`,
			label: model.id,
			description: `[${model.provider}] ${model.name ?? model.id}`,
			searchText: `${model.provider} ${model.id} ${model.name ?? ""}`,
		}))
		.sort((a, b) => a.value.localeCompare(b.value));

	const seen = new Set(models.map((model) => model.value));
	if (current && !seen.has(current)) {
		models.unshift({
			value: current,
			label: current,
			description: "Current profile model (not in the available catalog)",
			searchText: current,
		});
	}
	return models;
}

export async function selectSubagentModel(ctx: ExtensionContext, current?: string): Promise<ModelSelection> {
	const available = modelChoices(ctx, current);
	const items: ModelChoice[] = [
		{
			value: "(inherit parent)",
			label: "(inherit parent)",
			description: "Use the parent agent's current model",
			searchText: "inherit parent",
		},
		...available,
		{
			value: "Enter provider/model manually",
			label: "Enter provider/model manually",
			description: "Use a model not shown in the available catalog",
			searchText: "enter provider model manually custom",
		},
		{
			value: "Cancel",
			label: "Cancel",
			description: "Return without changing the model",
			searchText: "cancel",
		},
	];

	const selected = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const searchInput = new Input();
		let filteredItems = items;
		let selectedIndex = current ? Math.max(0, items.findIndex((item) => item.value === current)) : 0;
		const maxVisible = 10;
		let focused = false;

		const filterItems = () => {
			const query = searchInput.getValue();
			filteredItems = query ? fuzzyFilter(items, query, (item) => item.searchText) : items;
			selectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));
		};

		const renderList = (width: number): string[] => {
			if (filteredItems.length === 0) return [theme.fg("warning", "  No matching models")];

			const startIndex = Math.max(
				0,
				Math.min(selectedIndex - Math.floor(maxVisible / 2), filteredItems.length - maxVisible),
			);
			const endIndex = Math.min(startIndex + maxVisible, filteredItems.length);
			const lines: string[] = [];

			for (let index = startIndex; index < endIndex; index += 1) {
				const item = filteredItems[index];
				if (!item) continue;
				const selectedPrefix = index === selectedIndex ? "→ " : "  ";
				const label = index === selectedIndex ? theme.fg("accent", item.label) : item.label;
				const description = theme.fg("muted", ` ${item.description}`);
				lines.push(truncateToWidth(`${selectedPrefix}${label}${description}`, width));
			}

			if (startIndex > 0 || endIndex < filteredItems.length) {
				lines.push(theme.fg("dim", `  (${selectedIndex + 1}/${filteredItems.length})`));
			}

			const selectedItem = filteredItems[selectedIndex];
			if (selectedItem?.description) {
				lines.push("");
				lines.push(truncateToWidth(theme.fg("dim", `  ${selectedItem.description}`), width));
			}
			return lines;
		};

		const component = {
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				searchInput.focused = value;
			},
			render(width: number): string[] {
				return [
					theme.fg("accent", theme.bold("Select subagent model")),
					theme.fg("dim", "Only models with configured authentication are shown."),
					"",
					...searchInput.render(width),
					"",
					...renderList(width),
					"",
					truncateToWidth(theme.fg("dim", "Type to search · ↑↓ navigate · enter select · esc cancel"), width),
				];
			},
			invalidate() {
				searchInput.invalidate();
			},
			handleInput(data: string) {
				const keybindings = getKeybindings();
				if (keybindings.matches(data, "tui.select.up")) {
					if (filteredItems.length > 0) {
						selectedIndex = selectedIndex === 0 ? filteredItems.length - 1 : selectedIndex - 1;
					}
				} else if (keybindings.matches(data, "tui.select.down")) {
					if (filteredItems.length > 0) {
						selectedIndex = selectedIndex === filteredItems.length - 1 ? 0 : selectedIndex + 1;
					}
				} else if (keybindings.matches(data, "tui.select.confirm")) {
					const item = filteredItems[selectedIndex];
					if (item) done(item.value);
				} else if (keybindings.matches(data, "tui.select.cancel")) {
					done(null);
				} else {
					searchInput.handleInput(data);
					filterItems();
				}
				tui.requestRender();
			},
		};

		return component;
	});

	if (selected === null) return { kind: "cancelled" };
	if (selected === "(inherit parent)") return { kind: "inherit" };
	if (selected === "Enter provider/model manually") return { kind: "manual" };
	if (selected === "Cancel") return { kind: "cancelled" };
	return { kind: "model", value: selected };
}
