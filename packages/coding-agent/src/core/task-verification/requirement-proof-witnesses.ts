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
const MAX_PROOF_REJECTION_DETAILS = 8;
export interface ProofWitnessAnalysis {
  frameCount: number;
  rejectedFrameCount: number;
  rejectionDetails: string[];
  witnesses?: TaskVerificationProofWitness[];
}
export function collectProofWitnesses(
  content: AfterToolCallContext["result"]["content"],
  requirements: readonly TaskRequirement[],
  requirementSetHash: string | undefined,
  mutationRevision: number,
): TaskVerificationProofWitness[] | undefined {
  return analyzeProofWitnesses(content, requirements, requirementSetHash, mutationRevision).witnesses;
}
export function analyzeProofWitnesses(
  content: AfterToolCallContext["result"]["content"],
  requirements: readonly TaskRequirement[],
  requirementSetHash: string | undefined,
  mutationRevision: number,
): ProofWitnessAnalysis {
  const witnesses: TaskVerificationProofWitness[] = [];
  const seen = new Set<string>();
  const rejectionDetails: string[] = [];
  let frameCount = 0;
  let rejectedFrameCount = 0;
  const reject = (frameNumber: number, reason: string): void => {
    rejectedFrameCount++;
    if (rejectionDetails.length < MAX_PROOF_REJECTION_DETAILS) {
      rejectionDetails.push(`Frame ${frameNumber} rejected: ${reason}`);
    }
  };
  for (const part of content) {
    if (part.type !== "text") continue;
    for (const line of part.text.split(/\r?\n/u)) {
      const markerIndex = line.indexOf(PROOF_MARKER);
      if (markerIndex < 0) continue;
      frameCount++;
      if (!requirementSetHash) {
        reject(frameCount, "the controller has no active proof requirement set");
        continue;
      }
      if (witnesses.length >= MAX_PROOF_FRAMES) {
        reject(frameCount, `the ${MAX_PROOF_FRAMES}-frame acceptance limit was already reached`);
        continue;
      }
      const encoded = line.slice(markerIndex + PROOF_MARKER.length).trim();
      if (!encoded) {
        reject(frameCount, "the JSON payload is empty");
        continue;
      }
      if (Buffer.byteLength(encoded) > MAX_PROOF_FRAME_BYTES) {
        reject(frameCount, `the JSON payload exceeds ${MAX_PROOF_FRAME_BYTES} bytes`);
        continue;
      }
      const parsed = parseFrame(encoded);
      if (!("frame" in parsed)) {
        reject(
          frameCount,
          parsed.reason === "unknown policy"
            ? `${parsed.reason}; ${authoritativePolicies(requirements)}`
            : parsed.reason,
        );
        continue;
      }
      const frame = parsed.frame;
      const requirement = requirements.find((candidate) => candidate.id === frame.requirementId);
      if (!requirement) {
        reject(frameCount, `unknown requirementId; ${authoritativeRequirementIds(requirements)}`);
        continue;
      }
      if (!requirement.proofPolicies?.includes(frame.policy)) {
        reject(
          frameCount,
          `policy ${boundedQuoted(frame.policy)} is not required for requirementId ${boundedQuoted(requirement.id)}; authoritative expected ${formatPolicies(requirement)}`,
        );
        continue;
      }
      if (!validateFacts(frame.policy, frame.facts)) {
        reject(
          frameCount,
          `facts do not satisfy policy ${boundedQuoted(frame.policy)} for requirementId ${boundedQuoted(requirement.id)}`,
        );
        continue;
      }
      const key = `${frame.requirementId}\n${frame.policy}`;
      if (seen.has(key)) {
        reject(
          frameCount,
          `duplicate requirementId ${boundedQuoted(frame.requirementId)} with policy ${boundedQuoted(frame.policy)}`,
        );
        continue;
      }
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
  return {
    frameCount,
    rejectedFrameCount,
    rejectionDetails,
    ...(witnesses.length > 0 ? { witnesses } : {}),
  };
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

type ProofFrameParseResult = { frame: ProofFrame } | { reason: string };

function parseFrame(value: string): ProofFrameParseResult {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return { reason: "the JSON payload must be an object" };
    if (typeof parsed.requirementId !== "string" || parsed.requirementId.length === 0) {
      return { reason: "requirementId must be a non-empty string copied from the controller template" };
    }
    if (typeof parsed.policy !== "string")
      return { reason: "policy must be a string copied from the controller template" };
    if (!(REQUIREMENT_PROOF_POLICIES as readonly string[]).includes(parsed.policy)) {
      return { reason: "unknown policy" };
    }
    if (!isRecord(parsed.facts)) return { reason: "facts must be a JSON object" };
    return {
      frame: {
        requirementId: parsed.requirementId,
        policy: parsed.policy as RequirementProofPolicy,
        facts: parsed.facts,
      },
    };
  } catch {
    return { reason: "the payload is not valid JSON" };
  }
}

function authoritativeRequirementIds(requirements: readonly TaskRequirement[]): string {
  if (requirements.length === 0) return "the controller has no active proof obligations";
  const ids = requirements.slice(0, 4).map((requirement) => boundedQuoted(requirement.id));
  const suffix = requirements.length > ids.length ? `, and ${requirements.length - ids.length} more` : "";
  return `${requirements.length === 1 ? "authoritative expected ID" : "authoritative expected IDs"}: ${ids.join(", ")}${suffix}`;
}

function formatPolicies(requirement: TaskRequirement): string {
  const policies = requirement.proofPolicies ?? [];
  return `${policies.length === 1 ? "policy" : "policies"}: ${policies.map(boundedQuoted).join(", ")}`;
}

function authoritativePolicies(requirements: readonly TaskRequirement[]): string {
  const policies = [...new Set(requirements.flatMap((requirement) => requirement.proofPolicies ?? []))];
  return `authoritative expected ${policies.length === 1 ? "policy" : "policies"}: ${policies.map(boundedQuoted).join(", ")}`;
}

function boundedQuoted(value: string): string {
  return JSON.stringify(value.length > 128 ? `${value.slice(0, 125)}...` : value);
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
    return pair !== undefined && !pair.original.equals(pair.candidate);
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
