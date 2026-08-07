import type { Static } from "typebox";
import type { askUserSchema, confirmUserSchema, submitPlanSchema } from "./constants.ts";

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
