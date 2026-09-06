import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import {
  captureProjectInstructionEvidence,
  captureRuntimeContextEvidence,
  captureUserTurnEvidence,
  validateProjectInstructionEvidence,
} from "../../src/project-instructions/evidence.ts";
import { createBaseSystemModeProof, projectInstructionPreflightFailure } from "../../src/project-instructions/probe.ts";
import { createBenchmarkEventCapture } from "../../src/project-instructions/stream.ts";
import { createCompiledFixture } from "./evidence-fixture.ts";

type ValidationEvidence = NonNullable<Parameters<typeof validateProjectInstructionEvidence>[0]>;
type ActionCall = NonNullable<ValidationEvidence["phaseRelevantToolCalls"]>[number];

function required<T>(value: T | undefined): T {
  assert.ok(value);
  return value;
}

function preflightFailure(proof: unknown): string | undefined {
  return projectInstructionPreflightFailure(
    proof as unknown as Parameters<typeof projectInstructionPreflightFailure>[0],
  );
}

function validateEvidence(evidence: unknown, mode: "compiled" | "legacy", sourceSha256: string) {
  return validateProjectInstructionEvidence(evidence as ValidationEvidence, mode, sourceSha256);
}

test("stream capture records one route per runtime-context message and assigns raw event ordinals", () => {
  const inputHash = "a".repeat(64);
  const capture = createBenchmarkEventCapture(new Set(["tool_execution_start"]), 100);
  const route = routeEvent(inputHash, ["rules/testing.md"]);
  capture.process(JSON.stringify(userEvent("calculator tests")));
  capture.process(JSON.stringify(route));
  capture.process(JSON.stringify({ ...route, type: "message_end" }));
  capture.process(JSON.stringify({ type: "tool_execution_start", toolName: "edit", toolCallId: "edit-1" }));
  assert.equal(capture.rawEventCount, 4);
  assert.deepEqual(
    capture.runtimeContexts.map((context) => context.eventOrdinal),
    [102],
  );
  assert.equal(capture.runtimeContexts[0].compiledInputHash, inputHash);
  assert.deepEqual(
    capture.userTurns.map((turn) => turn.eventOrdinal),
    [101],
  );
  assert.equal(JSON.parse(capture.metricOutput).benchmarkEventOrdinal, 104);
});

test("fails startup immediately for fallback compiled artifacts and invalid legacy injection", () => {
  assert.match(
    preflightFailure({
      requestedMode: "compiled",
      hasLegacyMarker: false,
      hasCompiledMarker: true,
      compiledInstructionsInjected: true,
      compiledArtifactMode: "fallback",
    }) ?? "",
    /compiler did not produce/u,
  );
  assert.match(
    preflightFailure({ requestedMode: "legacy", sourceLoaded: true, legacySourceInjected: false }) ?? "",
    /expected legacy/u,
  );
  assert.equal(
    preflightFailure({
      requestedMode: "compiled",
      hasLegacyMarker: false,
      hasCompiledMarker: true,
      compiledInstructionsInjected: true,
      compiledArtifactMode: "compiled",
    }),
    undefined,
  );
});

test("validates compiled routing, exact batches, ordering, and zero-route turns", () => {
  const fixture = createCompiledFixture();
  try {
    const baseProof = createBaseSystemModeProof(
      {
        systemPrompt: `base\n${fixture.prompt}`,
        systemPromptOptions: { contextFiles: [], projectInstructions: fixture.prompt },
      },
      "compiled",
      fixture.sourceSha256,
    );
    const routedContext = required(
      captureRuntimeContextEvidence(routeEvent(fixture.inputHash, ["rules/testing.md"]), 12),
    );
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      runtimeContexts: [routedContext],
      userTurns: [
        required(captureUserTurnEvidence(userEvent("Please add calculator tests"), 10)),
        required(captureUserTurnEvidence(userEvent("hello there"), 40)),
      ],
      baseSystemModeProofs: [baseProof, baseProof],
      readRulesBatches: [
        { links: ["rules/testing.md"], succeeded: false, startOrdinal: 14, endOrdinal: 15 },
        { links: ["rules/testing.md"], succeeded: true, startOrdinal: 16, endOrdinal: 17 },
      ],
      phaseRelevantToolCalls: [
        {
          toolName: "bash",
          phases: ["testing"],
          eventOrdinal: 13,
          endOrdinal: 14,
          blockedByProjectRuleGate: true,
          projectRuleGateBlockKind: "pending",
          pendingRuleBatches: [["rules/testing.md"]],
          actionQuery: 'bash\n{"command":"npm test calculator"}',
        },
        {
          toolName: "edit",
          phases: ["implementation"],
          eventOrdinal: 20,
          blockedByProjectRuleGate: false,
          actionQuery: 'edit\n{"path":"calculator.ts"}',
        },
      ],
    });
    assert.deepEqual(validateEvidence(evidence, "compiled", fixture.sourceSha256), { passed: true });
    assert.deepEqual(
      evidence.userTurns.map((turn) => turn.expectedRouteLinks),
      [["rules/testing.md"], []],
    );
    assert.ok(evidence.cache);
    assert.equal(evidence.cache.promptHashVerified, true);
    assert.equal(evidence.cache.promptMarkerVerified, true);
    assert.equal(evidence.cache.sourceHashVerified, true);
    assert.ok(evidence.cache.manifest.compilerUsage);
    assert.equal(evidence.cache.manifest.compilerUsage.total, 130);
    assert.equal(routedContext.eventOrdinal, 12);
    assert.equal("content" in evidence.userTurns[0], false);

    const wrongBasePrompt = {
      ...evidence,
      baseSystemModeProofs: [{ ...baseProof, compiledInstructionsSha256: "d".repeat(64) }, baseProof],
    };
    assert.match(validateEvidence(wrongBasePrompt, "compiled", fixture.sourceSha256).reason ?? "", /compiled marker/u);

    const lateBatch = {
      ...evidence,
      readRulesBatches: [{ links: ["rules/testing.md"], succeeded: true, startOrdinal: 21, endOrdinal: 22 }],
    };
    assert.match(
      validateEvidence(lateBatch, "compiled", fixture.sourceSha256).reason ?? "",
      /before.*mutating action/u,
    );
    const abandoned = {
      ...evidence,
      readRulesBatches: [],
      phaseRelevantToolCalls: [evidence.phaseRelevantToolCalls[0]],
    };
    assert.match(validateEvidence(abandoned, "compiled", fixture.sourceSha256).reason ?? "", /exactly one/u);
    const legacyLeak = {
      ...evidence,
      runtimeContexts: [
        ...evidence.runtimeContexts,
        required(
          captureRuntimeContextEvidence(
            {
              type: "message_start",
              message: { role: "custom", customType: "runtime_context", content: "<project_rules>x</project_rules>" },
            },
            30,
          ),
        ),
      ],
    };
    assert.match(validateEvidence(legacyLeak, "compiled", fixture.sourceSha256).reason ?? "", /legacy marker/u);
    const laterUnseen = {
      ...evidence,
      phaseRelevantToolCalls: [
        ...evidence.phaseRelevantToolCalls,
        {
          toolName: "edit",
          phases: ["implementation"],
          eventOrdinal: 22,
          endOrdinal: 23,
          blockedByProjectRuleGate: false,
          selectionVerified: true,
          expectedActionRuleLinks: ["rules/unseen.md"],
        } as ActionCall,
      ],
    };
    assert.deepEqual(validateEvidence(laterUnseen, "compiled", fixture.sourceSha256), { passed: true });
    const laterAction = required(laterUnseen.phaseRelevantToolCalls.at(-1));
    laterAction.blockedByProjectRuleGate = true;
    laterAction.projectRuleGateBlockKind = "fixed";
    assert.match(validateEvidence(laterUnseen, "compiled", fixture.sourceSha256).reason ?? "", /reroute/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("query routes remain candidates until a mutation forms the batch", () => {
  const fixture = createCompiledFixture();
  try {
    const baseProof = createBaseSystemModeProof(
      { systemPrompt: fixture.prompt, systemPromptOptions: { contextFiles: [], projectInstructions: fixture.prompt } },
      "compiled",
      fixture.sourceSha256,
    );
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      baseSystemModeProofs: [baseProof, baseProof],
      userTurns: [
        required(captureUserTurnEvidence(userEvent("calculator tests"), 10)),
        required(captureUserTurnEvidence(userEvent("more calculator tests"), 30)),
      ],
      runtimeContexts: [
        required(captureRuntimeContextEvidence(routeEvent(fixture.inputHash, ["rules/testing.md"]), 11)),
        required(captureRuntimeContextEvidence(routeEvent(fixture.inputHash, ["rules/testing.md"]), 31)),
      ],
      readRulesBatches: [],
      phaseRelevantToolCalls: [],
    });
    assert.deepEqual(validateEvidence(evidence, "compiled", fixture.sourceSha256), { passed: true });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function userEvent(content: string) {
  return { type: "message_start", message: { role: "user", content, timestamp: 1 } };
}

function routeEvent(inputHash: string, links: string[]) {
  return {
    type: "message_start",
    message: {
      role: "custom",
      customType: "runtime_context",
      content: `<project_instructions agents_sha256="${"b".repeat(64)}" input_sha256="${inputHash}" mode="compiled">\n</project_instructions>\n<project_rule_routes input_sha256="${inputHash}">\n${links.map((link) => `- \`${link}\``).join("\n")}\n</project_rule_routes>`,
    },
  };
}
