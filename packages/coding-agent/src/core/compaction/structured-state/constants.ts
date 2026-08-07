export const STRUCTURED_SESSION_STATE_CUSTOM_TYPE = "pi.structured-session-state";

export const STRUCTURED_SESSION_STATE_VERSION = 1;

export const SESSION_STATE_UPDATE_START_TAG = "<session_state_update>";

export const SESSION_STATE_UPDATE_END_TAG = "</session_state_update>";

export const STATE_RENDER_MARKERS = {
  goal: "🚩",
  notStarted: "•",
  inProgress: "⏳",
  done: "✅",
  failed: "❌",
  blocked: "🚧",
  risk: "⚠️",
} as const;

export const MAX_CANONICAL_REQUEST_CHARS = 480;

export const MAX_REQUEST_SUMMARY_CHARS = 280;

export const termsCache = new Map<string, Set<string>>();

export const TERM_SPLIT_REGEX = /[^a-z0-9/_-]+/;

export const COMPARABLE_TEXT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "without",
]);

export const NORMALIZE_PREFIX_REGEX = /^(?:(?:✅|⏳|•|➖|❌|🚧|📌|🚩|⚠️)|[\s-])+/gu;

export const NORMALIZE_ACTION_REGEX =
  /^(?:impl|implement|explore|check|verify|run|change|find|fix|investigate|update|create)\s*:\s*/g;

export const NORMALIZE_PARENS_REGEX = /\([^)]*\)\s*$/g;

export const NORMALIZE_SPACE_REGEX = /\s+/g;

export const normalizationCache = new Map<string, string>();
