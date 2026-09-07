import { createHash } from "node:crypto";
import type { TaskVerificationResolvedToolEffect } from "../external-effect-state.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";

interface ExternalReadbackBinding {
  receiptId: string;
  criterionSha256: string;
  outcome: "confirmed" | "not_confirmed";
}

interface ExternalReadbackProofDetails {
  version: 1;
  kind: "external_effect_readback";
  externalEffectToolCallId: string;
  outcome: "confirmed" | "not_confirmed";
  criterion: string;
}

export function externalReadbackBinding(
  self: TaskVerificationController,
  details: unknown,
  effect: TaskVerificationResolvedToolEffect,
): ExternalReadbackBinding | undefined {
  const proof = readbackProof(details);
  if (!proof) return undefined;
  const receipt = (self.state.externalEffectReceipts ?? []).find(
    (candidate) => candidate.toolCallId === proof.externalEffectToolCallId,
  );
  if (
    !receipt ||
    effect.kind !== "read" ||
    effect.source !== "declared" ||
    effect.domains.length === 0 ||
    !effect.domains.some((domain) => receipt.effect.domains.includes(domain))
  ) {
    return undefined;
  }
  return {
    receiptId: receipt.id,
    criterionSha256: externalReadbackCriterionHash(proof.criterion),
    outcome: proof.outcome,
  };
}

export function snapshotExternalReadbackProofDetails(details: unknown): unknown {
  const proof = readbackProof(details);
  return proof ? { taskVerificationReadback: { ...proof } } : undefined;
}

export function externalReadbackCriterionHash(criterion: string): string {
  const normalized = criterion.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readbackProof(details: unknown): ExternalReadbackProofDetails | undefined {
  if (!isRecord(details) || !isRecord(details.taskVerificationReadback)) return undefined;
  const proof = details.taskVerificationReadback;
  return proof.version === 1 &&
    proof.kind === "external_effect_readback" &&
    (proof.outcome === "confirmed" || proof.outcome === "not_confirmed") &&
    isBoundedString(proof.externalEffectToolCallId, 500) &&
    isBoundedString(proof.criterion, 300)
    ? {
        version: 1,
        kind: "external_effect_readback",
        externalEffectToolCallId: proof.externalEffectToolCallId,
        outcome: proof.outcome,
        criterion: proof.criterion,
      }
    : undefined;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}
