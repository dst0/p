import type { Context } from "@dst0/p-ai";
import { resolveCompactionSettings } from "./message-selection.ts";
import { createContextBudgetReport } from "./token-counting.ts";
import type { CompactionSettings, ContextBudgetReport } from "./types.ts";

export const MODEL_CALL_CONTEXT_SAFETY_TOKENS = 1024;

export interface ModelContextCapacity {
  contextWindow: number;
  maxTokens: number;
}

export interface ModelCallContextBudgetReport extends ContextBudgetReport {
  reservedOutputTokens: number;
  safetyMarginTokens: number;
}

const TOP_LEVEL_OUTPUT_LIMIT_FIELDS = [
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
  "maxOutputTokens",
  "maxTokens",
] as const;

function resolveModelCallCapacity(
  model: ModelContextCapacity,
  settings: CompactionSettings,
  requestedMaxTokens = model.maxTokens,
) {
  const resolved = resolveCompactionSettings(settings);
  const contextWindow = Math.max(0, Math.floor(model.contextWindow));
  const safetyMarginTokens = MODEL_CALL_CONTEXT_SAFETY_TOKENS;
  const advertisedOutputTokens = Math.max(0, Math.floor(model.maxTokens));
  const requestedOutputTokens = Math.max(0, Math.floor(requestedMaxTokens));
  const reservedOutputTokens = Math.min(advertisedOutputTokens, requestedOutputTokens);
  return { contextWindow, reservedOutputTokens, resolved, safetyMarginTokens };
}

/** Reserve room for a complete model response before starting the call. */
export function createModelCallContextBudgetReport(
  contextTokens: number,
  model: ModelContextCapacity,
  settings: CompactionSettings,
  requestedMaxTokens?: number,
): ModelCallContextBudgetReport {
  const { contextWindow, reservedOutputTokens, resolved, safetyMarginTokens } = resolveModelCallCapacity(
    model,
    settings,
    requestedMaxTokens,
  );
  const triggerReserveTokens = Math.min(
    contextWindow,
    Math.max(resolved.triggerReserveTokens, reservedOutputTokens + safetyMarginTokens),
  );
  return {
    ...createContextBudgetReport(contextTokens, contextWindow, {
      ...resolved,
      triggerReserveTokens,
    }),
    reservedOutputTokens,
    safetyMarginTokens,
  };
}

export function getModelCallMaxTokens(
  model: ModelContextCapacity,
  settings: CompactionSettings,
  requestedMaxTokens?: number,
): number | undefined {
  const { reservedOutputTokens } = resolveModelCallCapacity(model, settings, requestedMaxTokens);
  return reservedOutputTokens > 0 ? reservedOutputTokens : undefined;
}

/** Estimate the fully transformed provider request, including serialized tool schemas. */
export function estimatePreparedModelCallTokens(context: Context): number {
  const providerVisibleContext = {
    systemPrompt: context.systemPrompt,
    messages: context.messages,
    tools: context.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  };
  return Math.ceil(JSON.stringify(providerVisibleContext).length / 4);
}

/** Conservative upper bound for byte-fallback tokenizers, used only for the final safety decision. */
export function estimatePreparedModelCallTokenUpperBound(context: Context): number {
  const providerVisibleContext = {
    systemPrompt: context.systemPrompt,
    messages: context.messages,
    tools: context.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  };
  return new TextEncoder().encode(JSON.stringify(providerVisibleContext)).length;
}

interface ProviderOutputLimit {
  path: string;
  value: number;
}

function getProviderPayloadOutputLimits(payload: unknown): ProviderOutputLimit[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const limits = TOP_LEVEL_OUTPUT_LIMIT_FIELDS.flatMap((field) =>
    typeof record[field] === "number" ? [{ path: field, value: record[field] }] : [],
  );
  for (const [container, field] of [
    ["config", "maxOutputTokens"],
    ["inferenceConfig", "maxTokens"],
  ] as const) {
    const nested = record[container];
    if (typeof nested !== "object" || nested === null || Array.isArray(nested)) continue;
    const limit = (nested as Record<string, unknown>)[field];
    if (typeof limit === "number") limits.push({ path: `${container}.${field}`, value: limit });
  }
  return limits;
}

/** Fail before network I/O if a final provider-payload hook expands the request beyond its certified budget. */
export function guardProviderPayloadBudget<T>(
  payload: T,
  model: ModelContextCapacity,
  settings: CompactionSettings,
  requestedMaxTokens?: number,
  baselinePayload?: unknown,
): T {
  const serializedPayload = JSON.stringify(payload);
  const outputLimits = getProviderPayloadOutputLimits(payload);
  const baselineOutputLimits = getProviderPayloadOutputLimits(baselinePayload);
  const outputLimitByPath = new Map(outputLimits.map((limit) => [limit.path, limit.value]));
  const certifiedMaxTokens = getModelCallMaxTokens(model, settings, requestedMaxTokens);
  if (
    certifiedMaxTokens === undefined ||
    baselineOutputLimits.length === 0 ||
    outputLimits.length === 0 ||
    [...baselineOutputLimits, ...outputLimits].some((limit) => !Number.isInteger(limit.value) || limit.value <= 0) ||
    baselineOutputLimits.some((limit) => limit.value > certifiedMaxTokens) ||
    outputLimits.some((limit) => limit.value > certifiedMaxTokens) ||
    baselineOutputLimits.some((limit) => !outputLimitByPath.has(limit.path))
  ) {
    throw new Error("context_length_exceeded: final provider payload changed the certified output limit");
  }
  const payloadTokens = new TextEncoder().encode(serializedPayload).length;
  const budget = createModelCallContextBudgetReport(payloadTokens, model, settings, requestedMaxTokens);
  if (payloadTokens + budget.reservedOutputTokens + budget.safetyMarginTokens > budget.contextWindow) {
    throw new Error("context_length_exceeded: final provider payload exceeds the certified model-call budget");
  }
  return payload;
}
