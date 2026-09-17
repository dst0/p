import type { Api, ImagesApi, ImagesModel, Model, Usage } from "./types.ts";

export type ModelCallAccounting =
  | Readonly<{ tokens: "reported"; usd: "reported" | "model-rates" | "unsupported" }>
  | Readonly<{ tokens: "unsupported"; usd: "reported" | "unsupported" }>;

/** Validate and snapshot a provider declaration at its trust boundary. */
export function validateModelCallAccounting(value: unknown): ModelCallAccounting {
  if (!value || typeof value !== "object") throw new Error("Invalid model call accounting declaration");
  const record = value as Record<string, unknown>;
  const tokens = record.tokens;
  const usd = record.usd;
  if (tokens !== "reported" && tokens !== "unsupported") {
    throw new Error("Invalid model call accounting token declaration");
  }
  if (usd !== "reported" && usd !== "model-rates" && usd !== "unsupported") {
    throw new Error("Invalid model call accounting USD declaration");
  }
  if (tokens === "unsupported" && usd === "model-rates") {
    throw new Error("Invalid model call accounting declaration: model rates require token reports");
  }
  return Object.freeze({ tokens, usd }) as ModelCallAccounting;
}

export interface ModelCallAdmission {
  kind: "text" | "image";
  model: Model<Api> | ImagesModel<ImagesApi>;
  signal?: AbortSignal;
  /** Image adapters declare what a successful response can account for. */
  accounting?: ModelCallAccounting;
}

export interface ModelCallSettlementDetails {
  /** Exact request cost reported by the provider, separate from token usage. */
  reportedUsd?: number;
}

export interface ModelCallReceipt {
  /** Called exactly once, before terminal completion; undefined means unknown usage. */
  settle(usage: Usage | undefined, details?: ModelCallSettlementDetails): void;
}

export type ModelCallGuard = (call: ModelCallAdmission) => ModelCallReceipt | undefined;

let guard: ModelCallGuard | undefined;

/** Install one admission authority. The resolver may select an async-local scope. */
export function registerModelCallGuard(next: ModelCallGuard): () => void {
  if (guard) throw new Error("A model-call admission authority is already registered");
  guard = next;
  return () => {
    if (guard === next) guard = undefined;
  };
}

export function admitModelCall(call: ModelCallAdmission): ModelCallReceipt | undefined {
  return guard?.(call);
}
