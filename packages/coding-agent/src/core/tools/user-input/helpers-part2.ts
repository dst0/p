import { Text } from "@dst0/p-tui";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { askUserSchema, DEFAULT_CUSTOM_OPTION_LABEL } from "./constants.ts";
import {
  defaultAskResult,
  formatAskToolResult,
  formatQuestionWithOptionDescriptions,
  getDialogOptions,
  renderUserInputCall,
  trimOrDefault,
} from "./helpers-part1.ts";
import type { AskUserToolDetails } from "./types.ts";

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
