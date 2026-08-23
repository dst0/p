import { assertSeededManifestEvidence } from "./benchmark-project-instruction-seed-record.js";
import { hashBenchmarkProjectInstructionCacheState } from "./benchmark-project-instruction-cache.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function sameLinks(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  const expected = [...right].sort();
  return [...left].sort().every((link, index) => link === expected[index]);
}

function sameOrderedLinks(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return left.every((link, index) => link === right[index]);
}

function authoritativeBatchLinks(turnLinks, actionLinks) {
  const primaryActionLink = actionLinks[0];
  return [
    ...new Set([
      ...(primaryActionLink ? [primaryActionLink] : []),
      ...turnLinks,
      ...actionLinks.slice(1),
    ]),
  ].slice(0, 3);
}

function validateBaseProofs(proofs, mode, sourceSha256, cache, userTurnCount) {
  if (!Array.isArray(proofs) || proofs.length === 0 || proofs.length !== userTurnCount) {
    return "base-system mode proof is missing for one or more user turns";
  }
  for (const proof of proofs) {
    if (
      proof.requestedMode !== mode ||
      proof.sourceSha256 !== sourceSha256 ||
      !HASH_PATTERN.test(proof.systemPromptSha256) ||
      !Number.isInteger(proof.systemPromptBytes) ||
      proof.systemPromptBytes <= 0
    ) {
      return "base-system mode proof identity is invalid";
    }
    if (
      mode === "legacy" &&
      (!proof.sourceLoaded ||
        !proof.legacySourceInjected ||
        !proof.hasLegacyMarker ||
        proof.hasCompiledMarker ||
        !Array.isArray(proof.legacyExpectedBlockHashes) ||
        !proof.legacyExpectedBlockHashes.every((hash) => HASH_PATTERN.test(hash)) ||
        !Array.isArray(proof.legacyInjectedBlockHashes) ||
        !proof.legacyInjectedBlockHashes.every((hash) => HASH_PATTERN.test(hash)) ||
        !proof.legacyExpectedBlockHashes.some((hash) => proof.legacyInjectedBlockHashes.includes(hash)))
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
      (proof.compiledAgentsHash !== cache.manifest.agentsHash ||
        proof.compiledInputHash !== cache.manifest.inputHash ||
        proof.compiledArtifactMode !== cache.manifest.mode)
    ) {
      return "compiled base-system marker does not match the cache manifest";
    }
    if (mode === "off" && (proof.hasLegacyMarker || proof.hasCompiledMarker)) {
      return "off base-system prompt contains a project-instruction marker";
    }
  }
  return undefined;
}

function isAuthorizedPromptHash(hash, cache) {
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

function validateRoutedTurns(evidence, cache) {
  const turns = Array.isArray(evidence.userTurns)
    ? [...evidence.userTurns].sort((left, right) => left.eventOrdinal - right.eventOrdinal)
    : [];
  if (turns.length === 0 || turns.some((turn) => !turn.selectionVerified || !Number.isInteger(turn.eventOrdinal))) {
    return "compiled user-turn routing evidence is missing";
  }
  const contexts = Array.isArray(evidence.runtimeContexts) ? evidence.runtimeContexts : [];
  const routes = contexts.filter((context) => context.routeInputHash !== undefined || context.routeLinkCount > 0);
  const batches = Array.isArray(evidence.readRulesBatches) ? evidence.readRulesBatches : [];
  const actions = Array.isArray(evidence.phaseRelevantToolCalls) ? evidence.phaseRelevantToolCalls : [];
  const usedRoutes = new Set();
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const end = turns[index + 1]?.eventOrdinal ?? Number.POSITIVE_INFINITY;
    const turnRoutes = routes.filter((route) => route.eventOrdinal > turn.eventOrdinal && route.eventOrdinal < end);
    if (turn.expectedRouteLinks.length === 0) {
      if (turnRoutes.length > 0) return "zero-route turn emitted an unexpected runtime route";
      continue;
    }
    if (turnRoutes.length !== 1) return "every routed turn must emit exactly one runtime route";
    const [route] = turnRoutes;
    usedRoutes.add(route);
    if (
      route.routeInputHash !== cache.manifest.inputHash ||
      route.routeLinkCount < 1 ||
      route.routeLinkCount > 3 ||
      !sameLinks(route.routeLinks, turn.expectedRouteLinks)
    ) {
      return "compiled runtime route does not match recomputed selection";
    }
  }
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const end = turns[index + 1]?.eventOrdinal ?? Number.POSITIVE_INFINITY;
    const successfulTurnBatches = batches.filter(
      (batch) =>
        batch.succeeded === true &&
        Number.isInteger(batch.startOrdinal) &&
        Number.isInteger(batch.endOrdinal) &&
        batch.startOrdinal > turn.eventOrdinal &&
        batch.endOrdinal < end,
    );
    const turnActions = actions
      .filter((call) => call.eventOrdinal > turn.eventOrdinal && call.eventOrdinal < end)
      .sort((left, right) => left.eventOrdinal - right.eventOrdinal);
    let authoritativeLinks;
    let authoritativeRead;
    for (const action of turnActions) {
      if (
        !action.selectionVerified ||
        !Array.isArray(action.phases) ||
        !Array.isArray(action.expectedActionRuleLinks)
      ) {
        return "compiled mutating-action selection evidence is missing";
      }
      if (
        action.expectedActionRuleLinks.length > 3 ||
        new Set(action.expectedActionRuleLinks).size !== action.expectedActionRuleLinks.length
      ) {
        return "compiled mutating action selected an invalid rule-link batch";
      }
      if (action.projectRuleGateBlockKind === "pending") {
        if (!Array.isArray(action.pendingRuleBatches) || action.pendingRuleBatches.length !== 1) {
          return "runtime pending action batches are missing from benchmark evidence";
        }
        const pendingBatch = action.pendingRuleBatches[0];
        if (authoritativeLinks) {
          if (!sameLinks(pendingBatch, authoritativeLinks)) {
            return "compiled user turn requested more than one authoritative rule batch";
          }
        } else {
          const expected = authoritativeBatchLinks(turn.expectedRouteLinks, action.expectedActionRuleLinks);
          if (
            !Array.isArray(pendingBatch) ||
            pendingBatch.length < 1 ||
            pendingBatch.length > 3 ||
            !sameOrderedLinks(pendingBatch, expected)
          ) {
            return "runtime authoritative batch does not match action-first query and mutating-action selection";
          }
          authoritativeLinks = pendingBatch;
          const matchingReads = successfulTurnBatches.filter(
            (batch) => batch.startOrdinal > action.endOrdinal && sameLinks(batch.links, authoritativeLinks),
          );
          if (matchingReads.length !== 1) {
            return "authoritative project-rule batch requires exactly one successful read_rules call";
          }
          authoritativeRead = matchingReads[0];
        }
      }
      if (
        action.projectRuleGateBlockKind === "cap" ||
        action.projectRuleGateBlockKind === "fixed"
      ) {
        return "runtime tried to reroute or restage the sole authoritative batch";
      }
      if (action.blockedByProjectRuleGate !== false) continue;
      const requiredLinks = authoritativeBatchLinks(turn.expectedRouteLinks, action.expectedActionRuleLinks);
      if (requiredLinks.length === 0) continue;
      if (!authoritativeLinks) return "completed mutating action had no authoritative rule batch";
      if (!authoritativeRead || authoritativeRead.endOrdinal >= action.eventOrdinal) {
        return "authoritative read_rules call did not complete before the mutating action";
      }
    }
  }
  if (routes.some((route) => !usedRoutes.has(route))) return "runtime route is not attached to a captured user turn";
  if (routes.some((route) => !Number.isInteger(route.eventOrdinal))) return "runtime route ordinal is missing";
  return undefined;
}

export function validateProjectInstructionEvidence(evidence, expectedMode, expectedSourceSha256, seeded) {
  if (evidence?.requestedMode !== expectedMode) {
    return { passed: false, reason: `requested mode ${evidence?.requestedMode ?? "missing"}; expected ${expectedMode}` };
  }
  if (evidence.sourceSha256 !== expectedSourceSha256) {
    return { passed: false, reason: "fixture source SHA-256 does not match the immutable input" };
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
  if (expectedMode === "compiled" && legacyLeak) return { passed: false, reason: "compiled evidence contains a legacy marker" };
  if (expectedMode !== "compiled" && contexts.some((context) => context.hasCompiledProjectInstructions)) {
    return { passed: false, reason: `${expectedMode} evidence contains a compiled marker` };
  }
  const cache = evidence.cache;
  if (expectedMode === "compiled" && !cache) return { passed: false, reason: "compiled cache evidence is missing" };
  const userTurnCount = Array.isArray(evidence.userTurns) ? evidence.userTurns.length : 0;
  const proofFailure = validateBaseProofs(
    evidence.baseSystemModeProofs,
    expectedMode,
    expectedSourceSha256,
    cache,
    userTurnCount,
  );
  if (proofFailure) return { passed: false, reason: proofFailure };
  if (expectedMode === "legacy" || expectedMode === "off") return { passed: true };
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
