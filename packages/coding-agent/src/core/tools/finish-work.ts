import { Text } from "@dst0/p-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../extensions/types.ts";
import { DEFAULT_TASK_VERIFICATION_MODE, type TaskVerificationMode } from "../task-verification/mode.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export interface FinishWorkPayload {
  status: "success" | "partial" | "failed";
  summary: string;
  verification_token?: string;
  files_changed?: string[];
  tests_run?: string[];
  remaining_work?: string[];
  notes?: string;
}

const finishWorkSchema = Type.Object({
  status: Type.Union([Type.Literal("success"), Type.Literal("partial"), Type.Literal("failed")], {
    description: "Final status of the task",
  }),
  summary: Type.String({
    description:
      "The complete final user-visible response. Preserve requested structure, formatting, content, and language; do not merely describe it.",
  }),
  verification_token: Type.Optional(
    Type.String({
      description: "Completion certificate returned by the active task-verification policy",
    }),
  ),
  files_changed: Type.Optional(Type.Array(Type.String({ description: "Files changed during this task" }))),
  tests_run: Type.Optional(Type.Array(Type.String({ description: "Tests run during this task" }))),
  remaining_work: Type.Optional(Type.Array(Type.String({ description: "Remaining incomplete work items" }))),
  notes: Type.Optional(Type.String({ description: "Additional notes or context" })),
});

export type FinishWorkInput = Static<typeof finishWorkSchema>;

export interface FinishWorkGateCheck {
  /** Returns null if the gate passes, or an error message string if blocked */
  check(input: FinishWorkInput): string | null;
}

export interface FinishWorkToolOptions {
  /** Optional gate check that can block finish_work execution */
  gateCheck?: FinishWorkGateCheck;
  /** Controls mode-specific completion guidance. */
  taskVerificationMode?: TaskVerificationMode;
}

function verificationPromptGuideline(mode: TaskVerificationMode): string | undefined {
  if (mode === "off") return undefined;
  if (mode === "audit") {
    return "For successful mutating tasks, call record_task_verification with action 'ready_to_finish', submit one complete record_requirement_audit verdict batch, then pass the resulting verification_token unchanged.";
  }
  return "In evidence mode, for response-only tasks first call record_task_verification with action 'record_completion_checklist' and verification_scope 'response_only' to record one concise completion checklist, then call finish_work without ready_to_finish. For mutating or effectful tasks, record the checklist before the first effect; after the final effect and verification, call ready_to_finish once without manually mapping evidence handles, then pass the resulting verification_token unchanged. Do not construct an exhaustive clause-to-requirement matrix.";
}

function validateFinishWorkInput(input: FinishWorkInput): string | null {
  if (!input.summary || input.summary.trim().length === 0) {
    return "summary is required and must not be empty";
  }
  if (input.status === "success" && input.remaining_work?.length) {
    return 'status "success" is incompatible with non-empty remaining_work';
  }
  return null;
}

function formatFinishWorkResult(payload: FinishWorkPayload, theme: Theme): string {
  const lines: string[] = [];

  // Status line
  const statusIcon =
    payload.status === "success"
      ? theme.fg("success", "✔")
      : payload.status === "partial"
        ? theme.fg("warning", "◐")
        : theme.fg("error", "✖");

  const statusLabel =
    payload.status === "success"
      ? theme.fg("success", "Success")
      : payload.status === "partial"
        ? theme.fg("warning", "Partial")
        : theme.fg("error", "Failed");

  lines.push(`${statusIcon} ${statusLabel}`);
  lines.push("");

  // Summary
  if (payload.summary) {
    lines.push(theme.fg("text", payload.summary));
  }

  // Files changed
  if (payload.files_changed?.length) {
    lines.push("");
    lines.push(theme.fg("muted", "Files:"));
    for (const file of payload.files_changed) {
      lines.push(`  ${theme.fg("text", file)}`);
    }
  }

  // Tests run
  if (payload.tests_run?.length) {
    lines.push("");
    lines.push(theme.fg("muted", "Tests:"));
    for (const test of payload.tests_run) {
      lines.push(`  ${theme.fg("text", test)}`);
    }
  }

  // Remaining work
  if (payload.remaining_work?.length) {
    lines.push("");
    lines.push(theme.fg("muted", "Remaining:"));
    for (const item of payload.remaining_work) {
      lines.push(`  ${theme.fg("warning", item)}`);
    }
  }

  // Notes
  if (payload.notes) {
    lines.push("");
    lines.push(theme.fg("dim", payload.notes));
  }

  return lines.join("\n");
}

export function createFinishWorkToolDefinition(
  options?: FinishWorkToolOptions,
): ToolDefinition<typeof finishWorkSchema, FinishWorkPayload> {
  const gateCheck = options?.gateCheck;
  const verificationGuideline = verificationPromptGuideline(
    options?.taskVerificationMode ?? DEFAULT_TASK_VERIFICATION_MODE,
  );
  return {
    name: "finish_work",
    label: "Finish Work",
    description: "Terminate the agent run with an explicit final status and summary.",
    effect: { kind: "read", risk: "normal" },
    promptSnippet: "Explicitly terminate the task with final status and user-visible result",
    promptGuidelines: [
      "Call finish_work exactly once when the task is complete, partially complete, or blocked.",
      verificationGuideline,
      "summary is printed verbatim as the final response; preserve the user's requested structure and content. Do not rely on an earlier assistant message.",
      "status 'success' is incompatible with non-empty remaining_work.",
      "summary is required and must not be empty.",
    ].filter((guideline): guideline is string => guideline !== undefined),
    parameters: finishWorkSchema,
    execute: async (_toolCallId, input: FinishWorkInput, _signal, _onUpdate, _ctx) => {
      const error = validateFinishWorkInput(input);
      if (error) {
        throw new Error(`finish_work validation error: ${error}`);
      }
      if (gateCheck) {
        const gateError = gateCheck.check(input);
        if (gateError) {
          throw new Error(`finish_work blocked: ${gateError}`);
        }
      }
      return {
        content: [{ type: "text", text: `Task finished with status: ${input.status}` }],
        details: input as FinishWorkPayload,
      };
    },
    renderCall(_args, theme, _context: ToolRenderContext) {
      return new Text(theme.fg("toolTitle", theme.bold("finish_work")), 1, 0);
    },
    renderResult(result, _options: ToolRenderResultOptions, theme, _context: ToolRenderContext) {
      const payload = result.details as FinishWorkPayload;
      const text = formatFinishWorkResult(payload, theme);
      return new Text(text, 1, 0);
    },
  };
}

export function createFinishWorkTool(options?: FinishWorkToolOptions) {
  return wrapToolDefinition(createFinishWorkToolDefinition(options));
}
