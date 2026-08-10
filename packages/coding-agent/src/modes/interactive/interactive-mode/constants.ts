import { getProviders } from "@dst0/p-ai";

export const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN"]);

export const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
  "Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage.";

export const RECENT_MODEL_SWITCH_MS = 10 * 60 * 1000;

export const DEFAULT_PLAN_PANEL_WIDTH = 50;

export const MIN_PLAN_PANEL_WIDTH = 30;

export const MIN_PLAN_PANEL_HEIGHT = 8;

export const BEDROCK_PROVIDER_ID = "amazon-bedrock";

export const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());
