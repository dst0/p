import type { CompletionMode } from "@dst0/p-agent-core";

export const DEFAULT_AGENT_RETRY_BASE_DELAY_MS = 500;

export const COMPLETION_MODE_ALIASES = {
  implicit: "implicit",
  explicit: "explicit_finish",
  explicit_finish: "explicit_finish",
  hybrid: "hybrid",
} satisfies Record<string, CompletionMode>;
