import type { AgentTool } from "@dst0/p-agent-core";
import { Text } from "@dst0/p-tui";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import {
  type askUserSchema,
  confirmUserSchema,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
  DEFAULT_PLAN_CONFIRM_LABEL,
  DEFAULT_PLAN_REVISE_LABEL,
  submitPlanSchema,
} from "./constants.ts";
import {
  createSubmitPlanDetails,
  formatConfirmToolResult,
  formatSubmitPlanDialog,
  formatSubmitPlanToolResult,
  getDialogOptions,
  renderUserInputCall,
  trimOrDefault,
} from "./helpers-part1.ts";
import { createAskUserToolDefinition } from "./helpers-part2.ts";
import type {
  AskUserToolDetails,
  ConfirmUserToolDetails,
  SubmitPlanToolDetails,
  SubmitPlanToolOptions,
} from "./types.ts";

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
      return new Text(`${theme.fg("toolTitle", prefix)} ${theme.fg("muted", formatConfirmToolResult(details))}`, 0, 0);
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
