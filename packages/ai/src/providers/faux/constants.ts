import type { Usage } from "../../types.ts";

export const DEFAULT_API = "faux";

export const DEFAULT_PROVIDER = "faux";

export const DEFAULT_MODEL_ID = "faux-1";

export const DEFAULT_MODEL_NAME = "Faux Model";

export const DEFAULT_BASE_URL = "http://localhost:0";

export const DEFAULT_MIN_TOKEN_SIZE = 3;

export const DEFAULT_MAX_TOKEN_SIZE = 5;

export const DEFAULT_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
