import assert from "node:assert/strict";
import { test } from "node:test";
import { inferProjectInstructionActionPhases } from "../../../packages/coding-agent/src/core/agent-session/project-instruction-action-phases.ts";
import { selectProjectInstructionRuleLinks } from "../../../packages/coding-agent/src/core/project-instructions/routing.ts";
import { parsePRecording } from "../../src/harness/p-recording.ts";
import { validateProjectInstructionEvidence } from "../../src/project-instructions/evidence.ts";
import {
  inferBenchmarkProjectInstructionActionPhases,
  selectBenchmarkProjectInstructionRuleLinks,
} from "../../src/project-instructions/routing.ts";

const sourceSha256 = "a".repeat(64);
const inputHash = "b".repeat(64);
const agentsHash = "c".repeat(64);
const promptHash = "d".repeat(64);
const canonicalPromptHash = "f".repeat(64);
type ValidationEvidence = NonNullable<Parameters<typeof validateProjectInstructionEvidence>[0]>;
type PhaseRelevantToolCall = NonNullable<ValidationEvidence["phaseRelevantToolCalls"]>[number];
type BenchmarkRule = Parameters<typeof selectBenchmarkProjectInstructionRuleLinks>[0][number] &
  Parameters<typeof selectProjectInstructionRuleLinks>[0][number];
const baseProof = {
  requestedMode: "compiled",
  sourceSha256,
  systemPromptSha256: "e".repeat(64),
  systemPromptBytes: 2000,
  hasLegacyMarker: false,
  hasCompiledMarker: true,
  compiledInstructionsInjected: true,
  compiledInstructionsSha256: promptHash,
  compiledAgentsHash: agentsHash,
  compiledInputHash: inputHash,
  compiledArtifactMode: "compiled",
};
const baseEvidence = {
  requestedMode: "compiled",
  sourceSha256,
  baseSystemModeProofs: [baseProof],
  runtimeContexts: [],
  userTurns: [{ eventOrdinal: 10, selectionVerified: true, expectedRouteLinks: [] }],
  readRulesBatches: [],
  phaseRelevantToolCalls: [],
  cache: {
    manifest: {
      mode: "compiled",
      compilerStatus: "success",
      compilerUsage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, total: 110 },
      inputHash,
      agentsHash,
      promptHash: canonicalPromptHash,
    },
    promptHashVerified: true,
    authorizedPromptHashes: [promptHash],
    promptMarkerVerified: true,
    sourceHashVerified: true,
    currentMatchesManifest: true,
    artifactClosureVerified: true,
  },
} as unknown as ValidationEvidence;

test("benchmark action phases stay in parity with production classification", () => {
  const cases: Array<[string, Record<string, unknown>, string?]> = [
    ["read", { path: "src/app.ts" }],
    ["repository_view", { path: "src/app.ts" }],
    ["edit", { path: "src/app.ts" }],
    ["process", { action: "poll" }],
    ["bash", { command: "npm run test:unit && npm run check" }],
    ["bash", { command: "git status && git push origin main" }],
    ["bash", { command: "printf value > output.txt" }],
    ["bash", { command: "echo hello" }],
    ["finish_work", { status: "success" }],
    ["list_skills", { query: "testing" }],
    ["read_skills", { links: ["skills/testing/SKILL.md"] }],
    ["read_rules", { links: ["rules/testing.md"] }],
    ["ask_user", { question: "Proceed?" }],
    ["remote_operation", { target: "primary" }, "Deploy production services"],
  ];
  for (const [toolName, args, description] of cases) {
    assert.deepEqual(
      inferBenchmarkProjectInstructionActionPhases(toolName, args, description),
      inferProjectInstructionActionPhases(toolName, args, description),
      toolName,
    );
  }
});

test("benchmark route recomputation stays in parity with lexical-first production routing", () => {
  const rules = [
    benchmarkRule("discovery", "Repository inspection", "Read source files before diagnosis"),
    benchmarkRule("implementation", "Code changes", "Edit source files carefully"),
    benchmarkRule("implementation-extra", "Code lifecycle", "Build source changes carefully"),
    benchmarkRule("credentials", "Credential policy", "Protect secrets"),
    benchmarkRule("testing", "Quality suite", "Vitest execution"),
  ];
  const queries = [
    "diagnose frobnicator state",
    "edit credential values",
    "edit credential",
    "coverage for frobnicator",
    "rules/testing.md",
    "hello there",
  ];
  for (const query of queries) {
    assert.deepEqual(
      selectBenchmarkProjectInstructionRuleLinks(rules, query),
      selectProjectInstructionRuleLinks(rules, query),
      query,
    );
  }
  assert.deepEqual(selectBenchmarkProjectInstructionRuleLinks(rules, "edit credential values"), [
    "rules/credentials.md",
    "rules/implementation.md",
  ]);
  assert.equal(
    selectBenchmarkProjectInstructionRuleLinks(rules, "edit credential values").includes(
      "rules/implementation-extra.md",
    ),
    false,
  );
  assert.deepEqual(selectBenchmarkProjectInstructionRuleLinks(rules, "edit credential"), [
    "rules/credentials.md",
    "rules/implementation.md",
  ]);
  assert.deepEqual(selectBenchmarkProjectInstructionRuleLinks(rules, "coverage for frobnicator"), ["rules/testing.md"]);
});

test("records conservative phase-less actions and suppresses builtin descriptions", () => {
  const calls: Array<[string, Record<string, unknown>, string?]> = [
    ["bash", { command: "echo hello" }, "Deploy production services"],
    ["remote_operation", { target: "primary" }, undefined],
    ["list_skills", { query: "testing" }, "Deploy production services"],
    ["record_requirement_audit", { action: "define" }, "Define authoritative user requirements"],
    ["record_task_verification", { action: "ready_to_finish" }, "Check finish readiness"],
    ["record_task_verification", { action: "unknown" }, "Unknown verification action"],
  ];
  const events = calls.flatMap(([toolName, args, toolDescription], index) => [
    {
      type: "tool_execution_start",
      toolCallId: `call-${index}`,
      toolName,
      toolDescription,
      args,
      benchmarkEventOrdinal: index * 2 + 1,
    },
    {
      type: "tool_execution_end",
      toolCallId: `call-${index}`,
      toolName,
      isError: false,
      benchmarkEventOrdinal: index * 2 + 2,
    },
  ]);

  const metrics = parsePRecording(events as Parameters<typeof parsePRecording>[0], () => "");
  assert.deepEqual(
    metrics.phaseRelevantToolCalls.map(({ toolName, phases }) => ({ toolName, phases })),
    [
      { toolName: "bash", phases: [] },
      { toolName: "remote_operation", phases: [] },
      { toolName: "record_task_verification", phases: ["verification"] },
    ],
  );
  assert.deepEqual(metrics.phaseRelevantToolCalls[0].actionQueries, ['bash\n{"command":"echo hello"}']);
  assert.equal(metrics.phaseRelevantToolCalls[1].actionQueries.at(-1), "remote_operation\ncustom tool action");
});

function blocked(links: string[], actionLinks = links): PhaseRelevantToolCall {
  return {
    toolName: "bash",
    phases: ["testing"],
    eventOrdinal: 12,
    endOrdinal: 13,
    blockedByProjectRuleGate: true,
    projectRuleGateBlockKind: "pending",
    pendingRuleBatches: [links],
    selectionVerified: true,
    expectedActionRuleLinks: actionLinks,
  } as unknown as PhaseRelevantToolCall;
}

function completed(actionLinks: string[], eventOrdinal = 20): PhaseRelevantToolCall {
  return {
    toolName: "bash",
    phases: ["testing"],
    eventOrdinal,
    endOrdinal: eventOrdinal + 1,
    blockedByProjectRuleGate: false,
    selectionVerified: true,
    expectedActionRuleLinks: actionLinks,
  } as unknown as PhaseRelevantToolCall;
}

test("requires one exact authoritative read before a completed mutating action", () => {
  const links = ["rules/testing.md"];
  const withoutRead = { ...baseEvidence, phaseRelevantToolCalls: [blocked(links), completed(links)] };
  assert.match(
    validateProjectInstructionEvidence(withoutRead, "compiled", sourceSha256).reason ?? "",
    /requires exactly one/u,
  );
  const withRead = {
    ...withoutRead,
    readRulesBatches: [{ links, succeeded: true, startOrdinal: 15, endOrdinal: 16 }],
  };
  assert.deepEqual(validateProjectInstructionEvidence(withRead, "compiled", sourceSha256), { passed: true });
  const repeatedBlock = {
    ...withoutRead,
    readRulesBatches: [{ links, succeeded: true, startOrdinal: 17, endOrdinal: 18 }],
    phaseRelevantToolCalls: [blocked(links), { ...blocked(links), eventOrdinal: 14, endOrdinal: 15 }, completed(links)],
  };
  assert.deepEqual(validateProjectInstructionEvidence(repeatedBlock, "compiled", sourceSha256), { passed: true });
  assert.match(
    validateProjectInstructionEvidence(
      {
        ...withRead,
        readRulesBatches: [...withRead.readRulesBatches, { links, succeeded: true, startOrdinal: 17, endOrdinal: 18 }],
      },
      "compiled",
      sourceSha256,
    ).reason ?? "",
    /requires exactly one successful/u,
  );
});

test("rejects split reads and accepts an action-first query union in one batch", () => {
  const testing = "rules/testing.md";
  const deployment = "rules/deployment.md";
  const links = [deployment, testing];
  const routed = {
    ...baseEvidence,
    runtimeContexts: [{ eventOrdinal: 11, routeInputHash: inputHash, routeLinkCount: 1, routeLinks: [testing] }],
    userTurns: [{ eventOrdinal: 10, selectionVerified: true, expectedRouteLinks: [testing] }],
    phaseRelevantToolCalls: [blocked(links, [deployment]), completed([deployment])],
  };
  const split = {
    ...routed,
    readRulesBatches: [
      { links: [testing], succeeded: true, startOrdinal: 14, endOrdinal: 15 },
      { links: [deployment], succeeded: true, startOrdinal: 16, endOrdinal: 17 },
    ],
  };
  assert.match(
    validateProjectInstructionEvidence(split, "compiled", sourceSha256).reason ?? "",
    /requires exactly one/u,
  );
  const combined = {
    ...routed,
    readRulesBatches: [
      { links: [testing], succeeded: true, startOrdinal: 8, endOrdinal: 9 },
      { links, succeeded: true, startOrdinal: 15, endOrdinal: 16 },
    ],
  };
  assert.deepEqual(validateProjectInstructionEvidence(combined, "compiled", sourceSha256), { passed: true });
  const reversed = {
    ...routed,
    readRulesBatches: [{ links: [testing, deployment], succeeded: true, startOrdinal: 15, endOrdinal: 16 }],
    phaseRelevantToolCalls: [blocked([testing, deployment], [deployment]), completed([deployment])],
  };
  assert.match(
    validateProjectInstructionEvidence(reversed, "compiled", sourceSha256).reason ?? "",
    /does not match action-first query and mutating-action selection/u,
  );
});

test("allows a zero-route action without an authoritative read", () => {
  assert.deepEqual(
    validateProjectInstructionEvidence(
      { ...baseEvidence, phaseRelevantToolCalls: [completed([])] },
      "compiled",
      sourceSha256,
    ),
    { passed: true },
  );
});

test("reserves the primary action route before filling from three turn routes", () => {
  const routeLinks = ["rules/testing.md", "rules/deployment.md", "rules/formatting.md"];
  const actionLinks = ["rules/migration.md"];
  const authoritativeLinks = [actionLinks[0], ...routeLinks.slice(0, 2)];
  const evidence = {
    ...baseEvidence,
    runtimeContexts: [{ eventOrdinal: 11, routeInputHash: inputHash, routeLinkCount: 3, routeLinks }],
    userTurns: [{ eventOrdinal: 10, selectionVerified: true, expectedRouteLinks: routeLinks }],
    readRulesBatches: [{ links: authoritativeLinks, succeeded: true, startOrdinal: 14, endOrdinal: 15 }],
    phaseRelevantToolCalls: [blocked(authoritativeLinks, actionLinks), completed(actionLinks, 20)],
  };
  assert.deepEqual(validateProjectInstructionEvidence(evidence, "compiled", sourceSha256), { passed: true });
});

function benchmarkRule(id: string, title: string, trigger: string): BenchmarkRule {
  return {
    id,
    link: `rules/${id}.md`,
    file: `rules/${id}.md`,
    title,
    trigger,
    routable: true,
    sourcePath: "/workspace/AGENTS.md",
    contentHash: "0".repeat(64),
  };
}
