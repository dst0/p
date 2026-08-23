import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureVerifiedCompiledCache,
  hashBenchmarkProjectInstructionCacheState,
} from "./benchmark-project-instruction-cache.js";
import {
  projectBaseSystemModeProof,
  projectPhaseRelevantToolCall,
  projectReadRulesBatch,
  projectRuntimeContextEvidence,
  projectUserTurnEvidence,
} from "./benchmark-project-instruction-evidence-projection.js";
import { parseCompiledProjectInstructionMarker } from "./benchmark-project-instruction-marker.js";
import { selectBenchmarkProjectInstructionRuleLinks } from "./benchmark-project-instruction-routing.js";

export { validateProjectInstructionEvidence } from "./benchmark-project-instruction-validation.js";

export function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

export function captureUserTurnEvidence(event, eventOrdinal) {
  if (event?.type !== "message_start" || event.message?.role !== "user") return undefined;
  const query = messageText(event.message.content);
  const evidence = {
    eventOrdinal,
    sha256: hashText(query),
    bytes: Buffer.byteLength(query, "utf8"),
  };
  Object.defineProperty(evidence, "query", { value: query, enumerable: false });
  return evidence;
}

export function captureRuntimeContextEvidence(event, eventOrdinal) {
  if (event?.type !== "message_start") return undefined;
  const message = event?.message;
  if (message?.role !== "custom" || message.customType !== "runtime_context" || typeof message.content !== "string") {
    return undefined;
  }
  const content = message.content;
  const compiled = parseCompiledProjectInstructionMarker(content);
  const routes = /<project_rule_routes input_sha256="([a-f0-9]{64})">([\s\S]*?)<\/project_rule_routes>/u.exec(content);
  const routeLinks = routes?.[2].match(/`(rules\/[a-z0-9./-]+)`/gu)?.map((match) => match.slice(1, -1)) ?? [];
  return {
    eventOrdinal,
    sha256: hashText(content),
    bytes: Buffer.byteLength(content, "utf8"),
    hasLegacyProjectRules: content.includes("<project_rules>"),
    hasLegacyProjectContext: /<project_context>|<project_instructions path="/u.test(content),
    hasCompiledProjectInstructions: compiled !== undefined,
    compiledAgentsHash: compiled?.agentsSha256,
    compiledInputHash: compiled?.inputSha256,
    compiledArtifactMode: compiled?.mode,
    routeInputHash: routes?.[1],
    routeLinkCount: routeLinks.length,
    routeLinks,
  };
}

function compiledCacheState(workspace) {
  try {
    lstatSync(join(workspace, ".pdev", "instructions"));
    return "present";
  } catch (error) {
    return error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? "absent" : "unverifiable";
  }
}

export function captureProjectInstructionEvidence(options) {
  const sourceSha256 = hashFile(options.sourceFile);
  const compiled = options.mode === "compiled" ? captureVerifiedCompiledCache(options.workspace, sourceSha256) : undefined;
  const userTurns = (options.userTurns ?? []).filter(Boolean).flatMap((turn) => {
    const selectionVerified = compiled !== undefined && typeof turn.query === "string";
    const expectedRouteLinks =
      compiled && typeof turn.query === "string"
        ? selectBenchmarkProjectInstructionRuleLinks(compiled.rules, turn.query)
        : [];
    const evidence = projectUserTurnEvidence(turn, selectionVerified, expectedRouteLinks);
    return evidence ? [evidence] : [];
  });
  const phaseRelevantToolCalls = (options.phaseRelevantToolCalls ?? []).flatMap((call) => {
    const queries = Array.isArray(call.actionQueries)
      ? call.actionQueries.filter((query) => typeof query === "string")
      : typeof call.actionQuery === "string"
        ? [call.actionQuery]
        : [];
    const evidence = projectPhaseRelevantToolCall(
      call,
      compiled !== undefined && queries.length > 0,
      compiled ? selectBenchmarkProjectInstructionRuleLinks(compiled.rules, queries.join("\n")) : [],
    );
    return evidence ? [evidence] : [];
  });
  return {
    requestedMode: options.mode,
    sourceSha256,
    proofReceiptSha256: options.proofReceiptSha256,
    proofExpectedTurnCount: options.proofExpectedTurnCount,
    postRunCacheStateSha256: hashBenchmarkProjectInstructionCacheState(
      options.mode,
      sourceSha256,
      compiledCacheState(options.workspace),
    ),
    baseSystemModeProofs: (options.baseSystemModeProofs ?? []).filter(Boolean).flatMap((proof) => {
      const evidence = projectBaseSystemModeProof(proof);
      return evidence ? [evidence] : [];
    }),
    runtimeContexts: options.runtimeContexts.filter(Boolean).flatMap((context) => {
      const evidence = projectRuntimeContextEvidence(context);
      return evidence ? [evidence] : [];
    }),
    userTurns,
    readRulesBatches: (options.readRulesBatches ?? []).flatMap((batch) => {
      const evidence = projectReadRulesBatch(batch);
      return evidence ? [evidence] : [];
    }),
    phaseRelevantToolCalls,
    cache: compiled?.evidence,
  };
}

export function captureRecordedProjectInstructionEvidence(workspace, mode, sourceFile, runResult, metrics) {
  return captureProjectInstructionEvidence({
    workspace,
    mode,
    sourceFile,
    proofReceiptSha256: runResult.proofReceiptSha256,
    proofExpectedTurnCount: runResult.proofExpectedTurnCount,
    baseSystemModeProofs: runResult.baseSystemModeProofs,
    runtimeContexts: runResult.runtimeContexts,
    userTurns: runResult.userTurns,
    readRulesBatches: metrics.readRulesBatches,
    phaseRelevantToolCalls: metrics.phaseRelevantToolCalls,
  });
}

export function configureProjectInstructionProbe(args, env, options, workspace, receiptSha256) {
  if (!options.projectInstructions) return;
  if (!/^[a-f0-9]{64}$/u.test(receiptSha256)) {
    throw new Error("Project instruction startup-proof receipt is required before each benchmark turn");
  }
  args.push("--extension", options.projectInstructionProbe, "--project-instructions", options.projectInstructions);
  if (options.projectInstructionCompilerModel) args.push("--project-instruction-compiler-model", options.projectInstructionCompilerModel);
  env.P_BENCHMARK_PROJECT_INSTRUCTION_RECEIPT = receiptSha256;
  env.P_BENCHMARK_PROJECT_INSTRUCTION_MODE = options.projectInstructions;
  env.P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_SHA256 = hashFile(options.projectInstructionsFile);
  env.P_BENCHMARK_PROJECT_INSTRUCTION_SOURCE_PATH = join(workspace, "AGENTS.md");
}
