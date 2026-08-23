import { createHash } from "node:crypto";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { REQUIREMENT_PROOF_POLICIES } from "./requirement-proof-policies.ts";
import type {
  RequirementProofPolicy,
  TaskRequirement,
  TaskVerificationEvidence,
  TaskVerificationProofWitness,
} from "./types.ts";

const PROOF_MARKER = "P_PROOF_V1 ";
const MAX_PROOF_FRAMES = 32;
const MAX_PROOF_FRAME_BYTES = 12_288;
const MAX_PROOF_VALUE_BYTES = 4_096;

export function collectProofWitnesses(
  content: AfterToolCallContext["result"]["content"],
  requirements: readonly TaskRequirement[],
  requirementSetHash: string | undefined,
  mutationRevision: number,
): TaskVerificationProofWitness[] | undefined {
  if (!requirementSetHash) return undefined;
  const witnesses: TaskVerificationProofWitness[] = [];
  const seen = new Set<string>();
  for (const part of content) {
    if (part.type !== "text") continue;
    for (const line of part.text.split(/\r?\n/u)) {
      const markerIndex = line.indexOf(PROOF_MARKER);
      if (markerIndex < 0 || witnesses.length >= MAX_PROOF_FRAMES) continue;
      const encoded = line.slice(markerIndex + PROOF_MARKER.length).trim();
      if (!encoded || Buffer.byteLength(encoded) > MAX_PROOF_FRAME_BYTES) continue;
      const frame = parseFrame(encoded);
      if (!frame) continue;
      const requirement = requirements.find((candidate) => candidate.id === frame.requirementId);
      if (!requirement?.proofPolicies?.includes(frame.policy) || !validateFacts(frame.policy, frame.facts)) continue;
      const key = `${frame.requirementId}\n${frame.policy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      witnesses.push({
        requirementId: frame.requirementId,
        policy: frame.policy,
        requirementSetHash,
        mutationRevision,
        factsHash: createHash("sha256")
          .update(JSON.stringify({ policy: frame.policy, facts: frame.facts }))
          .digest("hex"),
      });
    }
  }
  return witnesses.length > 0 ? witnesses : undefined;
}

export function redactProofFrames(
  content: AfterToolCallContext["result"]["content"],
): AfterToolCallContext["result"]["content"] {
  return content.map((part) =>
    part.type === "text"
      ? {
          ...part,
          text: part.text
            .split(/\r?\n/u)
            .map((line) => (line.includes(PROOF_MARKER) ? "[proof witness payload omitted]" : line))
            .join("\n"),
        }
      : part,
  );
}

export function countProofFrameMarkers(content: AfterToolCallContext["result"]["content"]): number {
  return content.reduce(
    (count, part) =>
      part.type === "text"
        ? count + part.text.split(/\r?\n/u).filter((line) => line.includes(PROOF_MARKER)).length
        : count,
    0,
  );
}

export function evidenceHasProofWitnesses(
  evidence: TaskVerificationEvidence,
  requirement: TaskRequirement,
  requirementSetHash: string | undefined,
): boolean {
  return (requirement.proofPolicies ?? []).every((policy) =>
    evidence.proofWitnesses?.some(
      (witness) =>
        witness.requirementId === requirement.id &&
        witness.policy === policy &&
        witness.requirementSetHash === requirementSetHash &&
        witness.mutationRevision === evidence.mutationRevision,
    ),
  );
}

export function isProofWitness(value: unknown): value is TaskVerificationProofWitness {
  if (!isRecord(value)) return false;
  return (
    typeof value.requirementId === "string" &&
    value.requirementId.length > 0 &&
    typeof value.policy === "string" &&
    (REQUIREMENT_PROOF_POLICIES as readonly string[]).includes(value.policy) &&
    typeof value.requirementSetHash === "string" &&
    value.requirementSetHash.length > 0 &&
    Number.isInteger(value.mutationRevision) &&
    Number(value.mutationRevision) >= 0 &&
    typeof value.factsHash === "string" &&
    value.factsHash.length > 0
  );
}

export function areProofWitnesses(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isProofWitness));
}

interface ProofFrame {
  requirementId: string;
  policy: RequirementProofPolicy;
  facts: Record<string, unknown>;
}

function parseFrame(value: string): ProofFrame | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !isRecord(parsed.facts)) return undefined;
    if (typeof parsed.requirementId !== "string" || typeof parsed.policy !== "string") return undefined;
    if (!(REQUIREMENT_PROOF_POLICIES as readonly string[]).includes(parsed.policy)) return undefined;
    return {
      requirementId: parsed.requirementId,
      policy: parsed.policy as RequirementProofPolicy,
      facts: parsed.facts,
    };
  } catch {
    return undefined;
  }
}

function validateFacts(policy: RequirementProofPolicy, facts: Record<string, unknown>): boolean {
  if (policy === "remove_exact_final_byte") {
    const pair = artifactPair(facts);
    return (
      pair !== undefined &&
      facts.outcome === "threw" &&
      pair.original.length > 0 &&
      pair.original[pair.original.length - 1] === 0x0a &&
      pair.candidate.length === pair.original.length - 1 &&
      pair.original.subarray(0, -1).equals(pair.candidate)
    );
  }
  if (policy === "change_artifact_bytes") {
    const pair = artifactPair(facts);
    return pair !== undefined && facts.outcome === "threw" && !pair.original.equals(pair.candidate);
  }
  if (policy === "preserve_state_on_failure" || policy === "preserve_log_on_failure") {
    const before = decodeBoundedBase64(facts.beforeBase64);
    const after = decodeBoundedBase64(facts.afterFailureBase64);
    return before !== undefined && after !== undefined && facts.failedOutcome === "threw" && before.equals(after);
  }
  if (policy === "preserve_version_on_failure" || policy === "preserve_position_on_failure") {
    return (
      isSafeInteger(facts.before) &&
      isSafeInteger(facts.afterFailure) &&
      isSafeInteger(facts.afterSuccess) &&
      facts.failedOutcome === "threw" &&
      facts.successOutcome === "succeeded" &&
      facts.afterFailure === facts.before &&
      facts.afterSuccess === facts.before + 1
    );
  }
  return (
    boundedString(facts.failedIdentity) &&
    boundedString(facts.retryIdentity) &&
    facts.failedIdentity === facts.retryIdentity &&
    facts.failedOutcome === "threw" &&
    facts.retryOutcome === "succeeded"
  );
}

function artifactPair(facts: Record<string, unknown>): { original: Buffer; candidate: Buffer } | undefined {
  const original = decodeBoundedBase64(facts.originalBase64);
  const candidate = decodeBoundedBase64(facts.candidateBase64);
  return original === undefined || candidate === undefined ? undefined : { original, candidate };
}

function decodeBoundedBase64(value: unknown): Buffer | undefined {
  if (typeof value !== "string" || value.length > MAX_PROOF_VALUE_BYTES * 2) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64");
  return decoded.length <= MAX_PROOF_VALUE_BYTES && decoded.toString("base64") === value ? decoded : undefined;
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 256;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
