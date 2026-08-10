import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ExtensionUIDialogOptions } from "../../extensions/types.ts";
import { MAX_TIMEOUT_MS } from "./constants.ts";
import type {
  AskUserToolDetails,
  AskUserToolInput,
  ConfirmUserToolDetails,
  SubmitPlanToolDetails,
  SubmitPlanToolInput,
} from "./types.ts";

export function normalizeTimeout(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return undefined;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, timeoutMs));
}

export function getDialogOptions(
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): ExtensionUIDialogOptions {
  return {
    signal,
    timeout: normalizeTimeout(timeoutMs),
  };
}

export function trimOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function formatQuestionWithOptionDescriptions(question: string, options: AskUserToolInput["options"]): string {
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

export function defaultAskResult(question: string, defaultAnswer: string | undefined): AskUserToolDetails {
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

export function formatAskToolResult(details: AskUserToolDetails): string {
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

export function formatConfirmToolResult(details: ConfirmUserToolDetails): string {
  if (details.status === "ui_unavailable") {
    return "User confirmation UI is not available in this mode.";
  }
  if (details.status === "defaulted") {
    return `User did not confirm; using default: ${details.confirmed ? "confirmed" : "rejected"}.`;
  }
  return details.confirmed ? "User confirmed." : "User rejected the request.";
}

export function normalizeStringList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

export function formatSubmitPlanDialog(params: SubmitPlanToolInput): string {
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

export function createSubmitPlanDetails(
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

export function formatSubmitPlanToolResult(details: SubmitPlanToolDetails): string {
  if (details.status === "ui_unavailable") {
    return "Plan confirmation UI is not available; plan was not approved.";
  }
  if (details.confirmed) {
    return "User approved the plan. Plan mode is now off; proceed with the approved plan.";
  }
  return "User requested plan changes. Stay in plan mode, revise the plan, and submit it again.";
}

export function renderUserInputCall(name: string, question: string | undefined, theme: Theme): string {
  const prompt = question?.trim() ?? "";
  const suffix = prompt ? ` ${theme.fg("muted", prompt)}` : "";
  return `${theme.fg("toolTitle", theme.bold(name))}${suffix}`;
}
