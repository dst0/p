import type { StreamOptions } from "../../types.ts";

export type MistralReasoningEffort = "none" | "high";

export interface MistralOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "any" | "required" | { type: "function"; function: { name: string } };
  promptMode?: "reasoning";
  reasoningEffort?: MistralReasoningEffort;
}
