import type { AgentToolResult } from "@dst0/p-agent-core";
import { describe, expect, test, vi } from "vitest";
import type { ExtensionContext, ExtensionUIContext } from "../src/core/extensions/index.ts";
import {
	createAskUserToolDefinition,
	createConfirmUserToolDefinition,
	createSubmitPlanToolDefinition,
} from "../src/core/tools/index.ts";
import { theme } from "../src/modes/interactive/theme/theme.ts";

function createUi(overrides: Partial<ExtensionUIContext> = {}): ExtensionUIContext {
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		get theme() {
			return theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "not implemented" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
		...overrides,
	};
}

function createContext(ui: ExtensionUIContext, hasUI = true): ExtensionContext {
	return {
		ui,
		mode: "tui",
		hasUI,
		cwd: "/tmp",
		sessionManager: {} as ExtensionContext["sessionManager"],
		modelRegistry: {} as ExtensionContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		isProjectTrusted: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

function textResult(result: AgentToolResult<unknown>): string {
	const first = result.content[0];
	return first?.type === "text" ? first.text : "";
}

describe("user input tools", () => {
	test("ask_user lets the user choose a fixed option with a custom option available by default", async () => {
		const tool = createAskUserToolDefinition();
		let seenOptions: string[] = [];
		const ctx = createContext(
			createUi({
				select: async (_title, options) => {
					seenOptions = options;
					return "B";
				},
			}),
		);

		const result = await tool.execute(
			"call-1",
			{
				question: "Choose one",
				options: [{ label: "A" }, { label: "B" }],
			},
			undefined,
			undefined,
			ctx,
		);

		expect(seenOptions).toEqual(["A", "B", "Other"]);
		expect(textResult(result)).toBe("User selected: B");
		expect(result.details).toMatchObject({
			answer: "B",
			selectedOption: "B",
			wasCustom: false,
			status: "answered",
		});
	});

	test("ask_user collects a custom answer after the custom option is selected", async () => {
		const tool = createAskUserToolDefinition();
		const ctx = createContext(
			createUi({
				select: async () => "Other",
				input: async () => "custom value",
			}),
		);

		const result = await tool.execute(
			"call-1",
			{
				question: "Choose one",
				options: [{ label: "A" }],
			},
			undefined,
			undefined,
			ctx,
		);

		expect(textResult(result)).toBe("User answered: custom value");
		expect(result.details).toMatchObject({
			answer: "custom value",
			wasCustom: true,
			status: "answered",
		});
	});

	test("confirm_user uses the default value when the dialog is cancelled", async () => {
		const tool = createConfirmUserToolDefinition();
		const ctx = createContext(createUi({ select: async () => undefined }));

		const result = await tool.execute(
			"call-1",
			{
				question: "Proceed?",
				defaultValue: true,
			},
			undefined,
			undefined,
			ctx,
		);

		expect(textResult(result)).toBe("User did not confirm; using default: confirmed.");
		expect(result.details).toMatchObject({
			confirmed: true,
			status: "defaulted",
		});
	});

	test("tools report unavailable UI instead of prompting in non-interactive contexts", async () => {
		const tool = createAskUserToolDefinition();
		const ctx = createContext(createUi(), false);

		const result = await tool.execute(
			"call-1",
			{
				question: "Need input",
			},
			undefined,
			undefined,
			ctx,
		);

		expect(textResult(result)).toBe("User input UI is not available in this mode.");
		expect(result.details.status).toBe("ui_unavailable");
	});

	test("submit_plan calls onApproved only after the user approves", async () => {
		const onApproved = vi.fn();
		const tool = createSubmitPlanToolDefinition({ onApproved });
		const ctx = createContext(createUi({ select: async () => "Approve plan" }));

		const result = await tool.execute(
			"call-1",
			{
				summary: "Plan summary",
				steps: [{ step: "Inspect files" }, { step: "Make focused change", details: "Then run checks" }],
			},
			undefined,
			undefined,
			ctx,
		);

		expect(textResult(result)).toBe("User approved the plan. Plan mode is now off; proceed with the approved plan.");
		expect(result.details).toMatchObject({
			confirmed: true,
			status: "approved",
		});
		expect(onApproved).toHaveBeenCalledTimes(1);
	});

	test("submit_plan stays in plan mode when the user asks for revisions", async () => {
		const onApproved = vi.fn();
		const tool = createSubmitPlanToolDefinition({ onApproved });
		const ctx = createContext(createUi({ select: async () => "Revise plan" }));

		const result = await tool.execute(
			"call-1",
			{
				summary: "Plan summary",
				steps: [{ step: "Inspect files" }],
			},
			undefined,
			undefined,
			ctx,
		);

		expect(textResult(result)).toBe(
			"User requested plan changes. Stay in plan mode, revise the plan, and submit it again.",
		);
		expect(result.details).toMatchObject({
			confirmed: false,
			status: "rejected",
		});
		expect(onApproved).not.toHaveBeenCalled();
	});
});
