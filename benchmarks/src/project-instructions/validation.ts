import { hashBenchmarkProjectInstructionCacheState } from "./cache.ts";
import { validateRoutedTurns } from "./routed-turn-validation.ts";
import { assertSeededManifestEvidence } from "./seed-manifest.ts";
import { validateProjectInstructionTurnAuthoritySequence } from "./turn-authority.ts";
import { taskVerificationStartupFailure } from "./verification-startup-proof.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

type BaseProof = {
  requestedMode?: string;
  requestedTaskVerificationMode?: string;
  effectiveTaskVerificationMode?: string;
  registeredVerificationTools?: string[];
  activeVerificationTools?: string[];
  verificationToolSurfaceRegistered?: boolean;
  verificationToolSurfaceActive?: boolean;
  sourceSha256?: string;
  systemPromptSha256?: string;
  systemPromptBytes?: number;
  sourceLoaded?: boolean;
  legacySourceInjected?: boolean;
  hasLegacyMarker?: boolean;
  hasCompiledMarker?: boolean;
  legacyExpectedBlockHashes?: string[];
  legacyInjectedBlockHashes?: string[];
  compiledInstructionsInjected?: boolean;
  compiledInstructionsSha256?: string;
  compiledAgentsHash?: string;
  compiledInputHash?: string;
  compiledArtifactMode?: string;
  expectedPromptBytes?: number;
  expectedPromptSha256?: string;
  receiptSha256?: string;
  turnOrdinal?: number;
  userBytes?: number;
  userEventOrdinal?: number;
  userSha256?: string;
};
type UserTurn = {
  eventOrdinal: number;
  expectedRouteLinks: string[];
  bytes?: number;
  sha256?: string;
  selectionVerified?: boolean;
};
type RuntimeRoute = { eventOrdinal: number; routeInputHash?: string; routeLinkCount: number; routeLinks: string[] };
type ReadRulesBatch = { succeeded?: boolean; startOrdinal: number; endOrdinal: number; links: string[] };
type ActionCall = {
  eventOrdinal: number;
  endOrdinal: number;
  selectionVerified?: boolean;
  phases?: string[];
  expectedActionRuleLinks?: string[];
  projectRuleGateBlockKind?: string;
  pendingRuleBatches?: string[][];
  blockedByProjectRuleGate?: boolean;
};
type EvidenceCache = {
  authorizedPromptHashes?: string[];
  cacheClosureSha256: string;
  promptHashVerified: boolean;
  promptMarkerVerified: boolean;
  sourceHashVerified: boolean;
  currentMatchesManifest: boolean;
  artifactClosureVerified: boolean;
  manifest: {
    agentsHash: string;
    inputHash: string;
    mode: string;
    compilerStatus: string;
    compilerUsage?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    [key: string]: unknown;
  };
};
type ProjectInstructionEvidence = {
  requestedMode?: string;
  requestedTaskVerificationMode?: string;
  sourceSha256?: string;
  proofReceiptSha256?: string;
  proofExpectedTurnCount?: number;
  postRunCacheStateSha256?: string;
  baseSystemModeProofs?: BaseProof[];
  runtimeContexts?: Array<
    RuntimeRoute & {
      hasLegacyProjectRules?: boolean;
      hasLegacyProjectContext?: boolean;
      hasCompiledProjectInstructions?: boolean;
    }
  >;
  userTurns?: UserTurn[];
  readRulesBatches?: ReadRulesBatch[];
  phaseRelevantToolCalls?: ActionCall[];
  cache?: EvidenceCache;
};
type SeededEvidence = { receipt: unknown; certificate: unknown };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateBaseProofs(
  proofs: BaseProof[] | undefined,
  mode: string,
  sourceSha256: string,
  cache: EvidenceCache | undefined,
  userTurns: UserTurn[],
  trustedReceiptSha256: string | undefined,
  expectedTurnCount: number | undefined,
  expectedTaskVerificationMode: string | undefined,
): string | undefined {
  if (!Array.isArray(proofs) || proofs.length === 0 || proofs.length !== userTurns.length) {
    return "base-system mode proof is missing for one or more user turns";
  }
  if (
    trustedReceiptSha256 !== undefined &&
    (typeof expectedTurnCount !== "number" ||
      !validateProjectInstructionTurnAuthoritySequence(proofs, trustedReceiptSha256, expectedTurnCount, userTurns))
  ) {
    return "base-system proof receipt, turn, or user-event binding is invalid";
  }
  for (let index = 0; index < proofs.length; index += 1) {
    const proof = proofs[index];
    const legacyInjectedBlockHashes = proof.legacyInjectedBlockHashes;
    if (mode === "compiled" && !cache) return "compiled cache evidence is missing";
    if (
      proof.requestedMode !== mode ||
      (expectedTaskVerificationMode !== undefined &&
        (proof.requestedTaskVerificationMode !== expectedTaskVerificationMode ||
          proof.effectiveTaskVerificationMode !== expectedTaskVerificationMode)) ||
      proof.sourceSha256 !== sourceSha256 ||
      typeof proof.systemPromptSha256 !== "string" ||
      !HASH_PATTERN.test(proof.systemPromptSha256) ||
      typeof proof.systemPromptBytes !== "number" ||
      !Number.isInteger(proof.systemPromptBytes) ||
      proof.systemPromptBytes <= 0
    ) {
      return "base-system mode proof identity is invalid";
    }
    if (expectedTaskVerificationMode !== undefined) {
      if (taskVerificationStartupFailure(proof as Parameters<typeof taskVerificationStartupFailure>[0])) {
        return "task-verification tool inventory or controller activation is invalid";
      }
    }
    if (
      mode === "legacy" &&
      (!proof.sourceLoaded ||
        !proof.legacySourceInjected ||
        !proof.hasLegacyMarker ||
        proof.hasCompiledMarker ||
        !isStringArray(proof.legacyExpectedBlockHashes) ||
        !proof.legacyExpectedBlockHashes.every((hash) => HASH_PATTERN.test(hash)) ||
        !isStringArray(legacyInjectedBlockHashes) ||
        !legacyInjectedBlockHashes.every((hash) => HASH_PATTERN.test(hash)) ||
        !proof.legacyExpectedBlockHashes.some((hash) => legacyInjectedBlockHashes.includes(hash)))
    ) {
      return "legacy base-system prompt did not prove AGENTS injection";
    }
    if (
      mode === "compiled" &&
      (proof.hasLegacyMarker ||
        !proof.hasCompiledMarker ||
        !proof.compiledInstructionsInjected ||
        !isAuthorizedPromptHash(proof.compiledInstructionsSha256, cache))
    ) {
      return "compiled base-system prompt contains a legacy marker or lacks the compiled marker";
    }
    if (
      mode === "compiled" &&
      (proof.compiledAgentsHash !== cache?.manifest.agentsHash ||
        proof.compiledInputHash !== cache?.manifest.inputHash ||
        proof.compiledArtifactMode !== cache?.manifest.mode)
    ) {
      return "compiled base-system marker does not match the cache manifest";
    }
    if (mode === "off" && (proof.hasLegacyMarker || proof.hasCompiledMarker)) {
      return "off base-system prompt contains a project-instruction marker";
    }
  }
  return undefined;
}

function isAuthorizedPromptHash(hash: unknown, cache: EvidenceCache | undefined): boolean {
  if (!cache || typeof hash !== "string") return false;
  const authorized = cache.authorizedPromptHashes;
  return (
    HASH_PATTERN.test(hash) &&
    Array.isArray(authorized) &&
    authorized.length >= 1 &&
    authorized.length <= 16 &&
    new Set(authorized).size === authorized.length &&
    authorized.every((entry) => HASH_PATTERN.test(entry)) &&
    authorized.includes(hash)
  );
}

export function validateProjectInstructionEvidence(
  evidence: ProjectInstructionEvidence | undefined,
  expectedMode: string,
  expectedSourceSha256: string,
  seeded?: SeededEvidence,
  trustedReceiptSha256?: string,
  expectedTaskVerificationMode?: string,
): { passed: boolean; reason?: string } {
  if (evidence?.requestedMode !== expectedMode) {
    return {
      passed: false,
      reason: "requested project-instruction mode is invalid",
    };
  }
  if (!evidence) return { passed: false, reason: "project instruction evidence is missing" };
  if (
    expectedTaskVerificationMode !== undefined &&
    evidence.requestedTaskVerificationMode !== expectedTaskVerificationMode
  ) {
    return { passed: false, reason: "requested task-verification profile is invalid" };
  }
  if (evidence.sourceSha256 !== expectedSourceSha256) {
    return { passed: false, reason: "fixture source SHA-256 does not match the immutable input" };
  }
  if (
    trustedReceiptSha256 !== undefined &&
    (!HASH_PATTERN.test(trustedReceiptSha256) || evidence.proofReceiptSha256 !== trustedReceiptSha256)
  ) {
    return { passed: false, reason: "base-system proof receipt identity is invalid" };
  }
  if (
    expectedMode !== "compiled" &&
    evidence.postRunCacheStateSha256 !==
      hashBenchmarkProjectInstructionCacheState(expectedMode, expectedSourceSha256, "absent")
  ) {
    return { passed: false, reason: `${expectedMode} evidence contains post-run compiled cache state` };
  }
  const contexts = Array.isArray(evidence.runtimeContexts) ? evidence.runtimeContexts : [];
  const legacyLeak = contexts.some((context) => context.hasLegacyProjectRules || context.hasLegacyProjectContext);
  if (expectedMode === "compiled" && legacyLeak)
    return { passed: false, reason: "compiled evidence contains a legacy marker" };
  if (expectedMode !== "compiled" && contexts.some((context) => context.hasCompiledProjectInstructions)) {
    return { passed: false, reason: `${expectedMode} evidence contains a compiled marker` };
  }
  const cache = evidence.cache;
  if (expectedMode === "compiled" && !cache) return { passed: false, reason: "compiled cache evidence is missing" };
  const userTurns = Array.isArray(evidence.userTurns) ? evidence.userTurns : [];
  const proofFailure = validateBaseProofs(
    evidence.baseSystemModeProofs,
    expectedMode,
    expectedSourceSha256,
    cache,
    userTurns,
    trustedReceiptSha256,
    evidence.proofExpectedTurnCount,
    expectedTaskVerificationMode,
  );
  if (proofFailure) return { passed: false, reason: proofFailure };
  if (expectedMode === "legacy" || expectedMode === "off") return { passed: true };
  if (!cache) return { passed: false, reason: "compiled cache evidence is missing" };
  if (
    cache.manifest.mode !== "compiled" ||
    cache.manifest.compilerStatus !== "success" ||
    !cache.promptHashVerified ||
    !cache.promptMarkerVerified ||
    !cache.sourceHashVerified ||
    !cache.currentMatchesManifest ||
    !cache.artifactClosureVerified
  ) {
    return { passed: false, reason: "compiled cache manifest failed integrity checks" };
  }
  if (seeded) {
    try {
      assertSeededManifestEvidence(
        {
          ...cache.manifest,
          cacheClosureSha256: cache.cacheClosureSha256,
          authorizedPromptHashes: cache.authorizedPromptHashes,
        },
        seeded.receipt,
        seeded.certificate,
      );
    } catch (error) {
      return { passed: false, reason: error instanceof Error ? error.message : "seeded cache evidence is invalid" };
    }
  } else {
    const usage = cache.manifest.compilerUsage;
    if (
      !usage ||
      ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.total].every(
        (value) => Number.isFinite(value) && value >= 0,
      ) ||
      usage.total <= 0
    ) {
      return { passed: false, reason: "fresh compiled cache is missing compiler token usage" };
    }
  }
  if (!HASH_PATTERN.test(cache.manifest.inputHash) || !HASH_PATTERN.test(cache.manifest.agentsHash)) {
    return { passed: false, reason: "compiled cache manifest hashes are malformed" };
  }
  const routeFailure = validateRoutedTurns(evidence, cache);
  return routeFailure ? { passed: false, reason: routeFailure } : { passed: true };
}
