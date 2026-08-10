import type { Model, SimpleStreamOptions } from "../../types.ts";
import type { MistralReasoningEffort } from "./types.ts";

export function usesReasoningEffort(model: Model<"mistral-conversations">): boolean {
  return model.id === "mistral-small-2603" || model.id === "mistral-small-latest" || model.id === "mistral-medium-3.5";
}

export function usesPromptModeReasoning(model: Model<"mistral-conversations">): boolean {
  return model.reasoning && !usesReasoningEffort(model);
}

export function mapReasoningEffort(
  model: Model<"mistral-conversations">,
  level: Exclude<SimpleStreamOptions["reasoning"], undefined>,
): MistralReasoningEffort {
  return (model.thinkingLevelMap?.[level] ?? "high") as MistralReasoningEffort;
}
