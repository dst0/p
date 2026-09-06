import type { RunBudgetSnapshot } from "./types.ts";

export function formatRunBudget(snapshot: RunBudgetSnapshot): string {
  const policy = snapshot.policy;
  const ceiling = policy.mode === "unlimited" ? "Unlimited" : `${policy.limit.toLocaleString()} ${policy.unit}`;
  const money = snapshot.uncertainUsd
    ? `$${snapshot.usd.toFixed(4)} recorded (incomplete)`
    : `~$${snapshot.usd.toFixed(4)}`;
  const tokens = `${snapshot.tokens.toLocaleString()} tokens${snapshot.uncertainTokens ? " recorded (incomplete)" : ""}`;
  return [
    `Task budget: ${ceiling} [${snapshot.status}]`,
    `Spent: ${snapshot.requests.toLocaleString()} model requests; ${tokens}; USD ${money}.`,
    `Scope: ${snapshot.scopeId}; pending usage: ${snapshot.pending}.`,
    ...(snapshot.reason ? [snapshot.reason] : []),
    "Includes helper calls and retries. Token/USD thresholds may be exceeded by the final response.",
  ].join("\n");
}
