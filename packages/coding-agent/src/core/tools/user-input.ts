import type { AgentTool } from "@dst0/p-agent-core";
import { Text } from "@dst0/p-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ExtensionContext, ExtensionUIDialogOptions, ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_CUSTOM_OPTION_LABEL = "Other";
const DEFAULT_CONFIRM_LABEL = "Yes";
const DEFAULT_CANCEL_LABEL = "No";
const DEFAULT_PLAN_CONFIRM_LABEL = "Approve plan";
const DEFAULT_PLAN_REVISE_LABEL = "Revise plan";

const userInputOptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option." }),
	description: Type.Optional(Type.String({ description: "Optional short description for the option." })),
});

const askUserSchema = Type.Object({
	question: Type.String({ description: "The question to ask the user." }),
	options: Type.Optional(
		Type.Array(userInputOptionSchema, {
			description: "Optional answer options. The user can choose one or provide a custom answer by default.",
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({
			description: "Whether to allow a free-form custom answer when options are provided. Defaults to true.",
		}),
	),
	customOptionLabel: Type.Optional(
		Type.String({
			description: `Label for the free-form answer choice. Defaults to "${DEFAULT_CUSTOM_OPTION_LABEL}".`,
		}),
	),
	defaultAnswer: Type.Optional(
		Type.String({
			description: "Answer to use if the user cancels or the dialog times out.",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Optional dialog timeout in milliseconds. Clamped to ${MAX_TIMEOUT_MS}.`,
		}),
	),
});

const confirmUserSchema = Type.Object({
	question: Type.String({ description: "The confirmation question to ask the user." }),
	details: Type.Optional(Type.String({ description: "Optional context shown below the question." })),
	confirmLabel: Type.Optional(
		Type.String({ description: `Positive choice label. Defaults to "${DEFAULT_CONFIRM_LABEL}".` }),
	),
	cancelLabel: Type.Optional(
		Type.String({ description: `Negative choice label. Defaults to "${DEFAULT_CANCEL_LABEL}".` }),
	),
	defaultValue: Type.Optional(
		Type.Boolean({
			description: "Confirmation value to use if the user cancels or the dialog times out. Defaults to false.",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Optional dialog timeout in milliseconds. Clamped to ${MAX_TIMEOUT_MS}.`,
		}),
	),
});

const planStepSchema = Type.Object({
	step: Type.String({ description: "A concrete step in the proposed plan." }),
	details: Type.Optional(
		Type.String({ description: "Optional implementation or verification detail for this step." }),
	),
});

const submitPlanSchema = Type.Object({
	summary: Type.String({ description: "Short summary of the proposed plan." }),
	steps: Type.Array(planStepSchema, { description: "Ordered plan steps to show the user for approval." }),
	risks: Type.Optional(Type.Array(Type.String({ description: "Risk, assumption, or tradeoff to call out." }))),
	openQuestions: Type.Optional(
		Type.Array(Type.String({ description: "Open question that remains before or during execution." })),
	),
	confirmationQuestion: Type.Optional(
		Type.String({ description: "Question shown above the approve/revise choices." }),
	),
	confirmLabel: Type.Optional(
		Type.String({ description: `Positive choice label. Defaults to "${DEFAULT_PLAN_CONFIRM_LABEL}".` }),
	),
	reviseLabel: Type.Optional(
		Type.String({ description: `Revision choice label. Defaults to "${DEFAULT_PLAN_REVISE_LABEL}".` }),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Optional dialog timeout in milliseconds. Clamped to ${MAX_TIMEOUT_MS}.`,
		}),
	),
});

export type AskUserToolInput = Static<typeof askUserSchema>;
export type ConfirmUserToolInput = Static<typeof confirmUserSchema>;
export type SubmitPlanToolInput = Static<typeof submitPlanSchema>;

export interface AskUserToolDetails {
	question: string;
	answer: string | null;
	selectedOption?: string;
	wasCustom: boolean;
	status: "answered" | "cancelled" | "defaulted" | "ui_unavailable";
}

export interface ConfirmUserToolDetails {
	question: string;
	confirmed: boolean;
	status: "answered" | "defaulted" | "ui_unavailable";
}

export interface SubmitPlanToolDetails {
	summary: string;
	steps: Array<{ step: string; details?: string }>;
	risks: string[];
	openQuestions: string[];
	confirmed: boolean;
	status: "approved" | "rejected" | "ui_unavailable";
}

export interface SubmitPlanToolOptions {
	onApproved?: (details: SubmitPlanToolDetails) => void;
}

function normalizeTimeout(timeoutMs: number | undefined): number | undefined {
	if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return undefined;
	return Math.min(MAX_TIMEOUT_MS, Math.max(1, timeoutMs));
}

function getDialogOptions(timeoutMs: number | undefined, signal: AbortSignal | undefined): ExtensionUIDialogOptions {
	return {
		signal,
		timeout: normalizeTimeout(timeoutMs),
	};
}

function trimOrDefault(value: string | undefined, fallback: string): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function formatQuestionWithOptionDescriptions(question: string, options: AskUserToolInput["options"]): string {
	const descriptions = options
		?.map((option, index) => {
			const description = option.description?.trim();
			return description ? `${index + 1}. ${option.label}: ${description}` : undefined;
		})
		.filter((line): line is string => line !== undefined);

	if (!descriptions || descriptions.length === 0) {
		return question;
	}
	return `${question}\n\n${descriptions.join("\n")}`;
}

function defaultAskResult(question: string, defaultAnswer: string | undefined): AskUserToolDetails {
	if (defaultAnswer !== undefined) {
		return {
			question,
			answer: defaultAnswer,
			wasCustom: false,
			status: "defaulted",
		};
	}
	return {
		question,
		answer: null,
		wasCustom: false,
		status: "cancelled",
	};
}

function formatAskToolResult(details: AskUserToolDetails): string {
	if (details.status === "ui_unavailable") {
		return "User input UI is not available in this mode.";
	}
	if (details.status === "cancelled") {
		return "User did not provide an answer.";
	}
	if (details.status === "defaulted") {
		return `User did not answer; using default answer: ${details.answer ?? ""}`;
	}
	if (details.wasCustom) {
		return `User answered: ${details.answer ?? ""}`;
	}
	return `User selected: ${details.answer ?? ""}`;
}

function formatConfirmToolResult(details: ConfirmUserToolDetails): string {
	if (details.status === "ui_unavailable") {
		return "User confirmation UI is not available in this mode.";
	}
	if (details.status === "defaulted") {
		return `User did not confirm; using default: ${details.confirmed ? "confirmed" : "rejected"}.`;
	}
	return details.confirmed ? "User confirmed." : "User rejected the request.";
}

function normalizeStringList(values: string[] | undefined): string[] {
	return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function formatSubmitPlanDialog(params: SubmitPlanToolInput): string {
	const lines: string[] = [];
	const question = params.confirmationQuestion?.trim() || "Approve this plan?";
	lines.push(question);
	lines.push("");
	lines.push(params.summary.trim());
	lines.push("");
	params.steps.forEach((step, index) => {
		const detail = step.details?.trim();
		lines.push(`${index + 1}. ${step.step.trim()}${detail ? ` - ${detail}` : ""}`);
	});

	const risks = normalizeStringList(params.risks);
	if (risks.length > 0) {
		lines.push("");
		lines.push("Risks:");
		for (const risk of risks) {
			lines.push(`- ${risk}`);
		}
	}

	const openQuestions = normalizeStringList(params.openQuestions);
	if (openQuestions.length > 0) {
		lines.push("");
		lines.push("Open questions:");
		for (const questionText of openQuestions) {
			lines.push(`- ${questionText}`);
		}
	}

	return lines.join("\n");
}

function createSubmitPlanDetails(
	params: SubmitPlanToolInput,
	confirmed: boolean,
	status: SubmitPlanToolDetails["status"],
): SubmitPlanToolDetails {
	return {
		summary: params.summary,
		steps: params.steps,
		risks: normalizeStringList(params.risks),
		openQuestions: normalizeStringList(params.openQuestions),
		confirmed,
		status,
	};
}

function formatSubmitPlanToolResult(details: SubmitPlanToolDetails): string {
	if (details.status === "ui_unavailable") {
		return "Plan confirmation UI is not available; plan was not approved.";
	}
	if (details.confirmed) {
		return "User approved the plan. Plan mode is now off; proceed with the approved plan.";
	}
	return "User requested plan changes. Stay in plan mode, revise the plan, and submit it again.";
}

function renderUserInputCall(name: string, question: string | undefined, theme: Theme): string {
	const prompt = question?.trim() ?? "";
	const suffix = prompt ? ` ${theme.fg("muted", prompt)}` : "";
	return `${theme.fg("toolTitle", theme.bold(name))}${suffix}`;
}

export function createAskUserToolDefinition(): ToolDefinition<typeof askUserSchema, AskUserToolDetails> {
	return {
		name: "ask_user",
		label: "ask user",
		description:
			"Ask the user a question and wait for their answer. Supports fixed options and an optional free-form custom answer.",
		promptSnippet: "Ask the user a question and wait for their answer",
		promptGuidelines: [
			"Use ask_user only when the user explicitly asks you to ask, collect, clarify, or wait for information before proceeding.",
			"Do not use ask_user just because you are uncertain; make a reasonable assumption unless the user asked you to ask.",
		],
		parameters: askUserSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext | undefined) {
			if (ctx?.hasUI !== true) {
				const details: AskUserToolDetails = {
					question: params.question,
					answer: null,
					wasCustom: false,
					status: "ui_unavailable",
				};
				return {
					content: [{ type: "text", text: formatAskToolResult(details) }],
					details,
				};
			}

			const options = params.options ?? [];
			const allowCustom = params.allowCustom ?? true;
			const customOptionLabel = trimOrDefault(params.customOptionLabel, DEFAULT_CUSTOM_OPTION_LABEL);
			const dialogOptions = getDialogOptions(params.timeoutMs, signal);
			const question = formatQuestionWithOptionDescriptions(params.question, options);
			let answer: string | undefined;
			let wasCustom = false;
			let selectedOption: string | undefined;

			if (options.length > 0) {
				const optionLabels = options.map((option) => option.label);
				const choices = allowCustom ? [...optionLabels, customOptionLabel] : optionLabels;
				const selected = await ctx.ui.select(question, choices, dialogOptions);

				if (selected === customOptionLabel && allowCustom) {
					const customAnswer = await ctx.ui.input(params.question, "Type your answer", dialogOptions);
					const trimmed = customAnswer?.trim();
					if (trimmed && trimmed.length > 0) {
						answer = trimmed;
						wasCustom = true;
					}
				} else if (selected) {
					answer = selected;
					selectedOption = selected;
				}
			} else {
				const input = await ctx.ui.input(question, "Type your answer", dialogOptions);
				const trimmed = input?.trim();
				if (trimmed && trimmed.length > 0) {
					answer = trimmed;
					wasCustom = true;
				}
			}

			const details: AskUserToolDetails =
				answer !== undefined
					? {
							question: params.question,
							answer,
							selectedOption,
							wasCustom,
							status: "answered",
						}
					: defaultAskResult(params.question, params.defaultAnswer);

			return {
				content: [{ type: "text", text: formatAskToolResult(details) }],
				details,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderUserInputCall("ask_user", args.question, theme));
			return text;
		},
		renderResult(result, _options, theme) {
			const details = result.details;
			const prefix = details.status === "answered" ? "answered" : details.status;
			return new Text(`${theme.fg("toolTitle", prefix)} ${theme.fg("muted", formatAskToolResult(details))}`, 0, 0);
		},
	};
}

export function createConfirmUserToolDefinition(): ToolDefinition<typeof confirmUserSchema, ConfirmUserToolDetails> {
	return {
		name: "confirm_user",
		label: "confirm user",
		description: "Ask the user for explicit confirmation and wait before proceeding.",
		promptSnippet: "Ask the user for explicit confirmation before proceeding",
		promptGuidelines: [
			"Use confirm_user only when the user explicitly asks you to wait for confirmation or approval before continuing.",
			"Treat a rejected or missing confirmation as a stop signal for the requested action instead of proceeding.",
		],
		parameters: confirmUserSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext | undefined) {
			if (ctx?.hasUI !== true) {
				const details: ConfirmUserToolDetails = {
					question: params.question,
					confirmed: false,
					status: "ui_unavailable",
				};
				return {
					content: [{ type: "text", text: formatConfirmToolResult(details) }],
					details,
				};
			}

			const confirmLabel = trimOrDefault(params.confirmLabel, DEFAULT_CONFIRM_LABEL);
			const cancelLabel = trimOrDefault(params.cancelLabel, DEFAULT_CANCEL_LABEL);
			const title = params.details?.trim() ? `${params.question}\n\n${params.details}` : params.question;
			const selected = await ctx.ui.select(
				title,
				[confirmLabel, cancelLabel],
				getDialogOptions(params.timeoutMs, signal),
			);
			const details: ConfirmUserToolDetails =
				selected === confirmLabel || selected === cancelLabel
					? {
							question: params.question,
							confirmed: selected === confirmLabel,
							status: "answered",
						}
					: {
							question: params.question,
							confirmed: params.defaultValue ?? false,
							status: "defaulted",
						};

			return {
				content: [{ type: "text", text: formatConfirmToolResult(details) }],
				details,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderUserInputCall("confirm_user", args.question, theme));
			return text;
		},
		renderResult(result, _options, theme) {
			const details = result.details;
			const prefix = details.confirmed ? "confirmed" : "not confirmed";
			return new Text(
				`${theme.fg("toolTitle", prefix)} ${theme.fg("muted", formatConfirmToolResult(details))}`,
				0,
				0,
			);
		},
	};
}

export function createSubmitPlanToolDefinition(
	options: SubmitPlanToolOptions = {},
): ToolDefinition<typeof submitPlanSchema, SubmitPlanToolDetails> {
	return {
		name: "submit_plan",
		label: "submit plan",
		description: "Show the proposed plan to the user and wait for approval before leaving plan mode.",
		promptSnippet: "Submit a proposed plan to the user for approval",
		promptGuidelines: [
			"In plan mode, use submit_plan when you have enough context to propose a concrete plan.",
			"Do not start implementation work while plan mode is active. Gather context, ask targeted questions if needed, then submit the plan.",
			"If submit_plan is rejected or unavailable, stay in plan mode and revise the plan or ask a follow-up question.",
		],
		parameters: submitPlanSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext | undefined) {
			if (ctx?.hasUI !== true) {
				const details = createSubmitPlanDetails(params, false, "ui_unavailable");
				return {
					content: [{ type: "text", text: formatSubmitPlanToolResult(details) }],
					details,
				};
			}

			const confirmLabel = trimOrDefault(params.confirmLabel, DEFAULT_PLAN_CONFIRM_LABEL);
			const reviseLabel = trimOrDefault(params.reviseLabel, DEFAULT_PLAN_REVISE_LABEL);
			const selected = await ctx.ui.select(
				formatSubmitPlanDialog(params),
				[confirmLabel, reviseLabel],
				getDialogOptions(params.timeoutMs, signal),
			);
			const confirmed = selected === confirmLabel;
			const details = createSubmitPlanDetails(params, confirmed, confirmed ? "approved" : "rejected");
			if (confirmed) {
				options.onApproved?.(details);
			}

			return {
				content: [{ type: "text", text: formatSubmitPlanToolResult(details) }],
				details,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(renderUserInputCall("submit_plan", args.summary, theme));
			return text;
		},
		renderResult(result, _options, theme) {
			const details = result.details;
			const prefix = details.confirmed ? "approved" : details.status;
			return new Text(
				`${theme.fg("toolTitle", prefix)} ${theme.fg("muted", formatSubmitPlanToolResult(details))}`,
				0,
				0,
			);
		},
	};
}

export function createAskUserTool(): AgentTool<typeof askUserSchema, AskUserToolDetails> {
	return wrapToolDefinition(createAskUserToolDefinition());
}

export function createConfirmUserTool(): AgentTool<typeof confirmUserSchema, ConfirmUserToolDetails> {
	return wrapToolDefinition(createConfirmUserToolDefinition());
}

export function createSubmitPlanTool(
	options: SubmitPlanToolOptions = {},
): AgentTool<typeof submitPlanSchema, SubmitPlanToolDetails> {
	return wrapToolDefinition(createSubmitPlanToolDefinition(options));
}
