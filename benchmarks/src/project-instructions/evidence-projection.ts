import { BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "./diagnostics.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
export type ProjectionInput = Record<string, unknown> & {
  authorizedPromptHashes?: ProjectionInput;
  compilerUsage?: ProjectionInput;
  current?: ProjectionInput;
  manifest?: ProjectionInput;
};

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const boolean = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);

function strings(value: unknown, unique = false): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string") ||
    (unique && new Set(value).size !== value.length)
  ) {
    return undefined;
  }
  return [...value];
}

function hashes(value: unknown, unique = false): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !HASH_PATTERN.test(entry)) ||
    (unique && new Set(value).size !== value.length)
  ) {
    return undefined;
  }
  return [...value];
}

function links(value: unknown, allowEmpty = true): string[] | undefined {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || !/^rules\/[a-z0-9./-]+$/u.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return [...value];
}

function stringBatches(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const projected = value.map((batch) => links(batch, false));
  return projected.some((batch) => batch === undefined)
    ? undefined
    : projected.flatMap((batch) => (batch ? [batch] : []));
}

function projectionInput(value: unknown): ProjectionInput | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ProjectionInput) : undefined;
}

export function projectBaseSystemModeProof(proof: ProjectionInput | null | undefined) {
  const injectedHashes = hashes(proof?.legacyInjectedBlockHashes, true);
  const expectedHashes = hashes(proof?.legacyExpectedBlockHashes, true);
  if (!injectedHashes || !expectedHashes) return undefined;
  return {
    requestedMode: text(proof?.requestedMode),
    requestedTaskVerificationMode: text(proof?.requestedTaskVerificationMode),
    effectiveTaskVerificationMode: text(proof?.effectiveTaskVerificationMode),
    registeredVerificationTools: strings(proof?.registeredVerificationTools, true),
    activeVerificationTools: strings(proof?.activeVerificationTools, true),
    verificationToolSurfaceRegistered: boolean(proof?.verificationToolSurfaceRegistered),
    verificationToolSurfaceActive: boolean(proof?.verificationToolSurfaceActive),
    receiptSha256: text(proof?.receiptSha256),
    turnOrdinal: number(proof?.turnOrdinal),
    userEventOrdinal: number(proof?.userEventOrdinal),
    userSha256: text(proof?.userSha256),
    userBytes: number(proof?.userBytes),
    expectedPromptSha256: text(proof?.expectedPromptSha256),
    expectedPromptBytes: number(proof?.expectedPromptBytes),
    sourceSha256: text(proof?.sourceSha256),
    systemPromptSha256: text(proof?.systemPromptSha256),
    systemPromptBytes: number(proof?.systemPromptBytes),
    hasLegacyMarker: boolean(proof?.hasLegacyMarker),
    hasCompiledMarker: boolean(proof?.hasCompiledMarker),
    compiledAgentsHash: text(proof?.compiledAgentsHash),
    compiledInputHash: text(proof?.compiledInputHash),
    compiledArtifactMode: text(proof?.compiledArtifactMode),
    compiledInstructionsSha256: text(proof?.compiledInstructionsSha256),
    compiledInstructionsInjected: boolean(proof?.compiledInstructionsInjected),
    sourceLoaded: boolean(proof?.sourceLoaded),
    legacySourceInjected: boolean(proof?.legacySourceInjected),
    legacyInjectedBlockHashes: injectedHashes,
    legacyExpectedBlockHashes: expectedHashes,
  };
}

export function projectRuntimeContextEvidence(context: ProjectionInput | null | undefined) {
  const routeLinks = links(context?.routeLinks);
  if (!routeLinks) return undefined;
  return {
    eventOrdinal: number(context?.eventOrdinal),
    sha256: text(context?.sha256),
    bytes: number(context?.bytes),
    hasLegacyProjectRules: boolean(context?.hasLegacyProjectRules),
    hasLegacyProjectContext: boolean(context?.hasLegacyProjectContext),
    hasCompiledProjectInstructions: boolean(context?.hasCompiledProjectInstructions),
    compiledAgentsHash: text(context?.compiledAgentsHash),
    compiledInputHash: text(context?.compiledInputHash),
    compiledArtifactMode: text(context?.compiledArtifactMode),
    routeInputHash: text(context?.routeInputHash),
    routeLinkCount: number(context?.routeLinkCount),
    routeLinks,
  };
}

export function projectUserTurnEvidence(
  turn: ProjectionInput | null | undefined,
  selectionVerified: unknown,
  expectedRouteLinks: unknown,
) {
  const projectedLinks = links(expectedRouteLinks);
  if (!projectedLinks) return undefined;
  return {
    eventOrdinal: number(turn?.eventOrdinal),
    sha256: text(turn?.sha256),
    bytes: number(turn?.bytes),
    selectionVerified,
    expectedRouteLinks: projectedLinks,
  };
}

export function projectReadRulesBatch(batch: ProjectionInput | null | undefined) {
  const projectedLinks = links(batch?.links, false);
  if (!projectedLinks) return undefined;
  return {
    links: projectedLinks,
    succeeded: boolean(batch?.succeeded),
    startOrdinal: number(batch?.startOrdinal),
    endOrdinal: number(batch?.endOrdinal),
  };
}

export function projectPhaseRelevantToolCall(
  call: ProjectionInput | null | undefined,
  selectionVerified: unknown,
  expectedActionRuleLinks: unknown,
) {
  const phases = strings(call?.phases, true);
  const expectedLinks = links(expectedActionRuleLinks);
  const pendingRuleBatches =
    call?.pendingRuleBatches === undefined ? undefined : stringBatches(call.pendingRuleBatches);
  if (!phases || !expectedLinks || (call?.pendingRuleBatches !== undefined && !pendingRuleBatches)) return undefined;
  return {
    toolName: text(call?.toolName),
    phases,
    eventOrdinal: number(call?.eventOrdinal),
    endOrdinal: number(call?.endOrdinal),
    blockedByProjectRuleGate: boolean(call?.blockedByProjectRuleGate),
    projectRuleGateBlockKind: text(call?.projectRuleGateBlockKind),
    pendingRuleBatches,
    selectionVerified,
    expectedActionRuleLinks: expectedLinks,
  };
}

function projectCompilerUsage(usage: ProjectionInput | null | undefined) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const projected = {
    input: number(usage.input),
    output: number(usage.output),
    cacheRead: number(usage.cacheRead),
    cacheWrite: number(usage.cacheWrite),
    total: number(usage.total),
  };
  return Object.values(projected).every((value) => value !== undefined && value >= 0) ? projected : undefined;
}

function projectCacheEvidence(cache: ProjectionInput | null | undefined) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return undefined;
  const manifest = cache.manifest;
  const candidateDiagnostic = text(manifest?.compilerDiagnostic);
  const diagnostic =
    candidateDiagnostic &&
    BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS.some((entry) => entry === candidateDiagnostic)
      ? candidateDiagnostic
      : undefined;
  const sourceHashes = hashes(manifest?.sourceHashes);
  const authorizedPromptHashes = hashes(cache.authorizedPromptHashes, true);
  if (!sourceHashes || !authorizedPromptHashes) return undefined;
  return {
    current: {
      schemaVersion: number(cache.current?.schemaVersion),
      agentsHash: text(cache.current?.agentsHash),
      inputHash: text(cache.current?.inputHash),
      version: text(cache.current?.version),
    },
    manifest: {
      schemaVersion: number(cache.manifest?.schemaVersion),
      compilerVersion: text(cache.manifest?.compilerVersion),
      agentsHash: text(cache.manifest?.agentsHash),
      inputHash: text(cache.manifest?.inputHash),
      resultHash: text(cache.manifest?.resultHash),
      promptHash: text(cache.manifest?.promptHash),
      rulesCatalogHash: text(cache.manifest?.rulesCatalogHash),
      skillsCatalogHash: text(cache.manifest?.skillsCatalogHash),
      mode: text(cache.manifest?.mode),
      compilerStatus: text(cache.manifest?.compilerStatus),
      compilerDiagnostic: diagnostic,
      compilerUsage: projectCompilerUsage(cache.manifest?.compilerUsage),
      sourceHashes,
    },
    promptBytes: number(cache.promptBytes),
    authorizedPromptHashes,
    promptHashVerified: boolean(cache.promptHashVerified),
    promptMarkerVerified: boolean(cache.promptMarkerVerified),
    sourceHashVerified: boolean(cache.sourceHashVerified),
    currentMatchesManifest: boolean(cache.currentMatchesManifest),
    artifactClosureVerified: boolean(cache.artifactClosureVerified),
    cacheClosureSha256: text(cache.cacheClosureSha256),
  };
}

export function projectProjectInstructionEvidence(evidence: ProjectionInput | null | undefined) {
  return {
    requestedMode: text(evidence?.requestedMode),
    requestedTaskVerificationMode: text(evidence?.requestedTaskVerificationMode),
    sourceSha256: text(evidence?.sourceSha256),
    proofReceiptSha256: text(evidence?.proofReceiptSha256),
    proofExpectedTurnCount: number(evidence?.proofExpectedTurnCount),
    postRunCacheStateSha256: text(evidence?.postRunCacheStateSha256),
    baseSystemModeProofs: Array.isArray(evidence?.baseSystemModeProofs)
      ? evidence.baseSystemModeProofs.flatMap((proof) => {
          const projected = projectBaseSystemModeProof(proof);
          return projected ? [projected] : [];
        })
      : [],
    runtimeContexts: Array.isArray(evidence?.runtimeContexts)
      ? evidence.runtimeContexts.flatMap((context) => {
          const projected = projectRuntimeContextEvidence(context);
          return projected ? [projected] : [];
        })
      : [],
    userTurns: Array.isArray(evidence?.userTurns)
      ? evidence.userTurns.flatMap((turn) => {
          const projected = projectUserTurnEvidence(turn, boolean(turn?.selectionVerified), turn?.expectedRouteLinks);
          return projected ? [projected] : [];
        })
      : [],
    readRulesBatches: Array.isArray(evidence?.readRulesBatches)
      ? evidence.readRulesBatches.flatMap((batch) => {
          const projected = projectReadRulesBatch(batch);
          return projected ? [projected] : [];
        })
      : [],
    phaseRelevantToolCalls: Array.isArray(evidence?.phaseRelevantToolCalls)
      ? evidence.phaseRelevantToolCalls.flatMap((call) => {
          const projected = projectPhaseRelevantToolCall(
            call,
            boolean(call?.selectionVerified),
            call?.expectedActionRuleLinks,
          );
          return projected ? [projected] : [];
        })
      : [],
    cache: projectCacheEvidence(projectionInput(evidence?.cache)),
  };
}
