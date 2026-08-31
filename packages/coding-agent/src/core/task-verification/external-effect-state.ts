import type {
  ResolvedToolEffect,
  ToolEffectDomain,
  ToolEffectKind,
  ToolEffectRisk,
  ToolEffectSource,
} from "@dst0/p-agent-core";

export const TOOL_EFFECT_KINDS = [
  "read",
  "workspace_write",
  "external_write",
  "unknown",
] as const satisfies readonly ToolEffectKind[];
export const TOOL_EFFECT_RISKS = ["normal", "high"] as const satisfies readonly ToolEffectRisk[];
export const TOOL_EFFECT_DOMAINS = [
  "credentials",
  "destructive",
  "deployment",
  "network_send",
  "persistent_state",
  "publication",
] as const satisfies readonly ToolEffectDomain[];
export const TOOL_EFFECT_SOURCES = [
  "builtin",
  "declared",
  "default_unknown",
] as const satisfies readonly ToolEffectSource[];
export const MAX_EXTERNAL_EFFECT_RECEIPTS = 128;

export type TaskVerificationResolvedToolEffect = ResolvedToolEffect;

export interface TaskVerificationExternalEffectReceipt {
  id: string;
  toolCallId: string;
  toolName: string;
  effect: TaskVerificationResolvedToolEffect;
  effectRevision: number;
}

export function externalEffectReceiptsAreValid(value: unknown): value is TaskVerificationExternalEffectReceipt[] {
  if (!Array.isArray(value) || value.length > MAX_EXTERNAL_EFFECT_RECEIPTS) return false;
  const ids = new Set<string>();
  return value.every((receipt) => {
    if (!isRecord(receipt) || !isNonempty(receipt.id) || ids.has(receipt.id)) return false;
    if (!isNonempty(receipt.toolCallId) || !isNonempty(receipt.toolName)) return false;
    if (!Number.isSafeInteger(receipt.effectRevision) || (receipt.effectRevision as number) < 0) return false;
    if (!resolvedToolEffectIsValid(receipt.effect)) return false;
    ids.add(receipt.id);
    return true;
  });
}

export function resolvedToolEffectIsValid(value: unknown): value is TaskVerificationResolvedToolEffect {
  return (
    isRecord(value) &&
    includes(TOOL_EFFECT_KINDS, value.kind) &&
    includes(TOOL_EFFECT_RISKS, value.risk) &&
    includes(TOOL_EFFECT_SOURCES, value.source) &&
    Array.isArray(value.domains) &&
    new Set(value.domains).size === value.domains.length &&
    value.domains.every((domain) => includes(TOOL_EFFECT_DOMAINS, domain))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500;
}

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}
