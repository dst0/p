export type RunBudgetPolicy =
  | { mode: "unlimited" }
  | { mode: "limited"; unit: "requests" | "tokens" | "usd"; limit: number };

export const RUN_BUDGET_ARGUMENT_HELP = "unlimited | requests:N | tokens:N | usd:N";

/** A complete user choice, never a partial settings merge or an implicit cap. */
export function validateRunBudgetPolicy(value: unknown): RunBudgetPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid run budget policy: choose Unlimited or a positive limit");
  }
  const policy = value as Record<string, unknown>;
  const keys = Object.keys(policy);
  if (policy.mode === "unlimited" && keys.length === 1) return { mode: "unlimited" };
  if (
    policy.mode !== "limited" ||
    keys.length !== 3 ||
    !keys.every((key) => ["mode", "unit", "limit"].includes(key)) ||
    (policy.unit !== "requests" && policy.unit !== "tokens" && policy.unit !== "usd") ||
    typeof policy.limit !== "number" ||
    !Number.isFinite(policy.limit) ||
    policy.limit <= 0 ||
    (policy.unit !== "usd" && !Number.isSafeInteger(policy.limit))
  ) {
    throw new Error("Invalid run budget policy: limits must be positive, finite, and whole for requests/tokens");
  }
  return { mode: "limited", unit: policy.unit, limit: policy.limit };
}

export function parseRunBudgetArgument(value: string): RunBudgetPolicy {
  if (value === "unlimited") return { mode: "unlimited" };
  const match = /^(requests|tokens|usd):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error(`--budget requires ${RUN_BUDGET_ARGUMENT_HELP}`);
  return validateRunBudgetPolicy({ mode: "limited", unit: match[1], limit: Number(match[2]) });
}
