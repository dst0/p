import { Type } from "typebox";

export const MAX_TIMEOUT_MS = 300_000;

export const DEFAULT_CUSTOM_OPTION_LABEL = "Other";

export const DEFAULT_CONFIRM_LABEL = "Yes";

export const DEFAULT_CANCEL_LABEL = "No";

export const DEFAULT_PLAN_CONFIRM_LABEL = "Approve plan";

export const DEFAULT_PLAN_REVISE_LABEL = "Revise plan";

export const userInputOptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option." }),
  description: Type.Optional(Type.String({ description: "Optional short description for the option." })),
});

export const askUserSchema = Type.Object({
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

export const confirmUserSchema = Type.Object({
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

export const planStepSchema = Type.Object({
  step: Type.String({ description: "A concrete step in the proposed plan." }),
  details: Type.Optional(Type.String({ description: "Optional implementation or verification detail for this step." })),
});

export const submitPlanSchema = Type.Object({
  summary: Type.String({ description: "Short summary of the proposed plan." }),
  steps: Type.Array(planStepSchema, { description: "Ordered plan steps to show the user for approval." }),
  risks: Type.Optional(Type.Array(Type.String({ description: "Risk, assumption, or tradeoff to call out." }))),
  openQuestions: Type.Optional(
    Type.Array(Type.String({ description: "Open question that remains before or during execution." })),
  ),
  confirmationQuestion: Type.Optional(Type.String({ description: "Question shown above the approve/revise choices." })),
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
