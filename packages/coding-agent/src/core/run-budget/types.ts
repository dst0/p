import type { RunBudgetPolicy } from "../run-budget-policy.ts";

export interface RunBudgetSnapshot {
  scopeId: string;
  policy: RunBudgetPolicy;
  requests: number;
  tokens: number;
  usd: number;
  pending: number;
  uncertainTokens: boolean;
  uncertainUsd: boolean;
  status: "ready" | "exhausted" | "uncertain";
  reason?: string;
}

export interface RunBudgetState {
  version: 1;
  scopeId: string;
  policy: RunBudgetPolicy;
  requests: number;
  tokens: number;
  usd: number;
  pending: string[];
  uncertainTokens: boolean;
  uncertainUsd: boolean;
}
