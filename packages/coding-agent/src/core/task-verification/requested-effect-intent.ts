import { inferTaskKind, taskTextHasAmbiguousEffect, taskTextRequestsEffect } from "./task-kind-inference.ts";

export type RequestedEffectIntent = "response_only" | "effect_required" | "unknown";

export function requestedEffectIntent(promptTexts: readonly string[]): RequestedEffectIntent {
  let unknown = false;
  const prompts = promptTexts.map((text) => text.trim()).filter(Boolean);
  for (const taskText of prompts) {
    if (taskTextRequestsEffect(taskText)) return "effect_required";
    if (taskTextHasAmbiguousEffect(taskText)) unknown = true;
    if (inferTaskKind(taskText) !== "investigation") unknown = true;
  }
  return unknown || prompts.length === 0 ? "unknown" : "response_only";
}
