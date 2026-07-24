import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { CancellableLoader } from "../src/components/cancellable-loader.ts";
import { Loader } from "../src/components/loader.ts";
import type { SettingItem, SettingsListTheme } from "../src/components/settings-list.ts";
import { SettingsList } from "../src/components/settings-list.ts";
import { Spacer } from "../src/components/spacer.ts";
import { Text } from "../src/components/text.ts";
import type { Component, TUI } from "../src/tui.ts";

describe("Box component", () => {
	it("renders empty array when it has no children", () => {
		const box = new Box();
		assert.deepEqual(box.render(20), []);
	});

	it("renders empty array when children render empty output", () => {
		const box = new Box();
		const emptyChild: Component = { render: () => [], invalidate: () => {} };
		box.addChild(emptyChild);
		assert.deepEqual(box.render(20), []);
	});

	it("adds padding and background to children", () => {
		const bgFn = (text: string) => `[BG]${text}[/BG]`;
		const box = new Box(2, 1, bgFn);
		const textChild = new Text("Hello", 0, 0);
		box.addChild(textChild);

		const lines = box.render(10);
		// paddingY=1 top, 1 content line, paddingY=1 bottom -> 3 lines
		assert.equal(lines.length, 3);
		assert.equal(lines[0].includes("[BG]"), true);
		assert.equal(lines[1].includes("  Hello"), true);
	});

	it("handles child management and cache invalidation", () => {
		const box = new Box();
		let invalidations = 0;
		const child: Component = {
			render: () => ["child line"],
			invalidate: () => {
				invalidations++;
			},
		};

		box.addChild(child);
		const firstRender = box.render(20);
		assert.deepEqual(box.render(20), firstRender); // Cached

		box.invalidate();
		assert.equal(invalidations, 1);

		box.removeChild(child);
		assert.deepEqual(box.render(20), []);

		box.addChild(child);
		box.setBgFn((t) => `<${t}>`);
		box.clear();
		assert.deepEqual(box.render(20), []);
	});
});

describe("Text component", () => {
	it("renders empty result for empty or whitespace-only text", () => {
		const text = new Text("");
		assert.deepEqual(text.render(10), []);

		text.setText("   ");
		assert.deepEqual(text.render(10), []);
	});

	it("replaces tabs and applies padding and background", () => {
		const bgFn = (str: string) => `(BG:${str})`;
		const text = new Text("A\tB", 1, 1, bgFn);

		const lines = text.render(10);
		assert.equal(lines.length, 3); // 1 top pad, 1 content, 1 bottom pad
		assert.equal(lines[1].includes("A   B"), true);

		// Test cache hit
		const cached = text.render(10);
		assert.equal(cached, lines);

		// Invalidate and change bg
		text.setCustomBgFn(undefined);
		text.invalidate();
		const noBgLines = text.render(10);
		assert.equal(noBgLines[1].includes("(BG:"), false);
	});
});

describe("Spacer component", () => {
	it("renders empty lines", () => {
		const spacer = new Spacer();
		assert.deepEqual(spacer.render(10), [""]);

		spacer.setLines(3);
		spacer.invalidate();
		assert.deepEqual(spacer.render(10), ["", "", ""]);
	});
});

describe("Loader & CancellableLoader components", () => {
	it("manages animation state and updates display", () => {
		let renderRequested = false;
		const mockUi: TUI = {
			requestRender: () => {
				renderRequested = true;
			},
		} as unknown as TUI;

		const loader = new Loader(
			mockUi,
			(s) => `S:${s}`,
			(m) => `M:${m}`,
			"Init",
			{
				frames: ["1", "2"],
				intervalMs: 10,
			},
		);

		assert.equal(renderRequested, true);
		const lines = loader.render(20);
		assert.equal(lines.length, 2);
		assert.equal(lines[1].includes("1 M:Init"), true);

		loader.setMessage("Next");
		assert.equal(loader.render(20)[1].includes("M:Next"), true);

		loader.setIndicator({ frames: ["*"], intervalMs: 0 });
		loader.stop();
	});

	it("handles cancellation in CancellableLoader", () => {
		let abortedSignal = false;
		const loader = new CancellableLoader(
			{ requestRender: () => {} } as unknown as TUI,
			(s) => s,
			(m) => m,
			"Work",
		);

		assert.equal(loader.aborted, false);
		loader.onAbort = () => {
			abortedSignal = true;
		};

		loader.handleInput("\x1b"); // Escape
		assert.equal(loader.aborted, true);
		assert.equal(abortedSignal, true);

		loader.dispose();
	});
});

describe("SettingsList component", () => {
	const theme: SettingsListTheme = {
		label: (t, sel) => (sel ? `>${t}` : ` ${t}`),
		value: (v, sel) => (sel ? `[${v}]` : ` ${v} `),
		description: (d) => `Desc: ${d}`,
		cursor: ">",
		hint: (h) => `Hint: ${h}`,
	};

	it("renders list and supports navigation and value toggling", () => {
		const items: SettingItem[] = [
			{ id: "s1", label: "Setting One", currentValue: "on", values: ["on", "off"], description: "First setting" },
			{ id: "s2", label: "Setting Two", currentValue: "v1", values: ["v1", "v2"] },
		];

		let changedId = "";
		let changedVal = "";
		let cancelled = false;

		const list = new SettingsList(
			items,
			5,
			theme,
			(id, val) => {
				changedId = id;
				changedVal = val;
			},
			() => {
				cancelled = true;
			},
		);

		let lines = list.render(40);
		assert.equal(
			lines.some((l) => l.includes("Setting One")),
			true,
		);
		assert.equal(
			lines.some((l) => l.includes("First setting")),
			true,
		);

		// Navigate down
		list.handleInput("\x1b[B"); // Down arrow
		lines = list.render(40);

		// Confirm/Toggle value on setting 2
		list.handleInput("\r");
		assert.equal(changedId, "s2");
		assert.equal(changedVal, "v2");

		// Update value externally
		list.updateValue("s1", "off");
		assert.equal(items[0].currentValue, "off");

		// Cancel
		list.handleInput("\x1b");
		assert.equal(cancelled, true);
	});

	it("supports search filtering and empty states", () => {
		const items: SettingItem[] = [
			{ id: "a", label: "Alpha", currentValue: "1" },
			{ id: "b", label: "Beta", currentValue: "2" },
		];

		const list = new SettingsList(
			items,
			5,
			theme,
			() => {},
			() => {},
			{ enableSearch: true },
		);
		let lines = list.render(40);
		assert.equal(
			lines.some((l) => l.includes("Alpha")),
			true,
		);

		// Filter
		list.handleInput("B");
		lines = list.render(40);
		assert.equal(
			lines.some((l) => l.includes("Beta")),
			true,
		);

		// Invalidate
		list.invalidate();
	});

	it("supports submenus", () => {
		let subSelected: string | undefined;

		const submenuChild: Component = {
			render: () => ["Submenu Open"],
			handleInput: (data: string) => {
				if (data === "select") {
					subDone("newValue");
				}
			},
			invalidate: () => {},
		};

		let subDone!: (val?: string) => void;

		const items: SettingItem[] = [
			{
				id: "sub",
				label: "Submenu Setting",
				currentValue: "oldValue",
				submenu: (_val, done) => {
					subDone = done;
					return submenuChild;
				},
			},
		];

		const list = new SettingsList(
			items,
			5,
			theme,
			(_id, val) => {
				subSelected = val;
			},
			() => {},
		);

		// Open submenu
		list.handleInput(" "); // Space activates item
		let lines = list.render(40);
		assert.equal(lines[0], "Submenu Open");

		// Delegate input to submenu
		list.handleInput("select");
		assert.equal(subSelected, "newValue");

		// Submenu closed
		lines = list.render(40);
		assert.equal(
			lines.some((l) => l.includes("Submenu Setting")),
			true,
		);
	});

	it("renders empty list states when items array is empty", () => {
		const list = new SettingsList(
			[],
			5,
			theme,
			() => {},
			() => {},
			{ enableSearch: true },
		);
		const lines = list.render(40);
		assert.equal(
			lines.some((l) => l.includes("No settings available")),
			true,
		);
	});
});
