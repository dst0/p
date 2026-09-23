import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";

export const BEGIN_CODE_TASK_TOOL_NAME = "begin_code_task";

const beginCodeTaskSchema = Type.Object(
  {
    goal: Type.String({ minLength: 1, maxLength: 300, description: "The code change you are about to make" }),
    checklist: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), {
      minItems: 1,
      maxItems: 6,
      description: "Observable behaviors the finished change must show (not 'tests pass')",
    }),
  },
  { additionalProperties: false },
);

export type BeginCodeTaskInput = Static<typeof beginCodeTaskSchema>;

export interface BeginCodeTaskDetails {
  tier: "strict";
  checklistRecorded: boolean;
}

export interface BeginCodeTaskOutcome {
  text: string;
  checklistRecorded: boolean;
}

/**
 * Model-driven escalation to STRICT verification. The handler owns the tier transition and the
 * checklist recording; this definition only validates input and reports the outcome.
 */
export function createBeginCodeTaskToolDefinition(
  handler: (input: BeginCodeTaskInput) => BeginCodeTaskOutcome,
): ToolDefinition<typeof beginCodeTaskSchema, BeginCodeTaskDetails> {
  return {
    name: BEGIN_CODE_TASK_TOOL_NAME,
    label: "Begin Code Task",
    effect: { kind: "read", risk: "normal" },
    description:
      "Switch the current task to strict verification before changing source code or tests. " +
      "Records the goal and a short behavioral checklist. Do not call it for questions, reviews, or docs-only edits.",
    promptSnippet:
      "begin_code_task(goal, checklist): switch to strict verification before changing source code or tests",
    promptGuidelines: [
      "When the task requires changing source code or tests, call begin_code_task once, in the same response as your first such edit; answer questions and edit docs without it.",
    ],
    parameters: beginCodeTaskSchema,
    executionMode: "sequential",
    async execute(_toolCallId, input) {
      const outcome = handler(input);
      return {
        content: [{ type: "text", text: outcome.text }],
        details: { tier: "strict", checklistRecorded: outcome.checklistRecorded },
      };
    },
  };
}
