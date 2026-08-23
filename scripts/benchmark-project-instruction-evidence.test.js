import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  createBaseSystemModeProof,
  projectInstructionPreflightFailure,
} from "./benchmark-project-instruction-probe.js";
import {
  captureProjectInstructionEvidence,
  captureRuntimeContextEvidence,
  captureUserTurnEvidence,
  hashFile,
  validateProjectInstructionEvidence,
} from "./benchmark-project-instruction-evidence.js";
import { createBenchmarkEventCapture } from "./benchmark-project-instruction-stream.js";
import { createCompiledFixture } from "./benchmark-project-instruction-evidence-fixture.js";

test("stream capture records one route per runtime-context message and assigns raw event ordinals", () => {
  const inputHash = "a".repeat(64);
  const capture = createBenchmarkEventCapture(new Set(["tool_execution_start"]), 100);
  const route = routeEvent(inputHash, ["rules/testing.md"]);
  capture.process(JSON.stringify(userEvent("calculator tests")));
  capture.process(JSON.stringify(route));
  capture.process(JSON.stringify({ ...route, type: "message_end" }));
  capture.process(JSON.stringify({ type: "tool_execution_start", toolName: "edit", toolCallId: "edit-1" }));
  assert.equal(capture.rawEventCount, 4);
  assert.deepEqual(capture.runtimeContexts.map((context) => context.eventOrdinal), [102]);
  assert.equal(capture.runtimeContexts[0].compiledInputHash, inputHash);
  assert.deepEqual(capture.userTurns.map((turn) => turn.eventOrdinal), [101]);
  assert.equal(JSON.parse(capture.metricOutput).benchmarkEventOrdinal, 104);
});

test("fails startup immediately for fallback compiled artifacts and invalid legacy injection", () => {
  assert.match(
    projectInstructionPreflightFailure({
      requestedMode: "compiled",
      hasLegacyMarker: false,
      hasCompiledMarker: true,
      compiledInstructionsInjected: true,
      compiledArtifactMode: "fallback",
    }),
    /compiler did not produce/u,
  );
  assert.match(
    projectInstructionPreflightFailure({ requestedMode: "legacy", sourceLoaded: true, legacySourceInjected: false }),
    /expected legacy/u,
  );
  assert.equal(
    projectInstructionPreflightFailure({
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
    const routedContext = captureRuntimeContextEvidence(routeEvent(fixture.inputHash, ["rules/testing.md"]), 12);
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      runtimeContexts: [routedContext],
      userTurns: [
        captureUserTurnEvidence(userEvent("Please add calculator tests"), 10),
        captureUserTurnEvidence(userEvent("hello there"), 40),
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
    assert.deepEqual(validateProjectInstructionEvidence(evidence, "compiled", fixture.sourceSha256), { passed: true });
    assert.deepEqual(evidence.userTurns.map((turn) => turn.expectedRouteLinks), [["rules/testing.md"], []]);
    assert.equal(evidence.cache.promptHashVerified, true);
    assert.equal(evidence.cache.promptMarkerVerified, true);
    assert.equal(evidence.cache.sourceHashVerified, true);
    assert.equal(evidence.cache.manifest.compilerUsage.total, 130);
    assert.equal(routedContext.eventOrdinal, 12);
    assert.equal("content" in evidence.userTurns[0], false);

    const wrongBasePrompt = {
      ...evidence,
      baseSystemModeProofs: [{ ...baseProof, compiledInstructionsSha256: "d".repeat(64) }, baseProof],
    };
    assert.match(
      validateProjectInstructionEvidence(wrongBasePrompt, "compiled", fixture.sourceSha256).reason,
      /compiled marker/u,
    );

    const lateBatch = {
      ...evidence,
      readRulesBatches: [{ links: ["rules/testing.md"], succeeded: true, startOrdinal: 21, endOrdinal: 22 }],
    };
    assert.match(
      validateProjectInstructionEvidence(lateBatch, "compiled", fixture.sourceSha256).reason,
      /before.*mutating action/u,
    );
    const abandoned = {
      ...evidence,
      readRulesBatches: [],
      phaseRelevantToolCalls: [evidence.phaseRelevantToolCalls[0]],
    };
    assert.match(validateProjectInstructionEvidence(abandoned, "compiled", fixture.sourceSha256).reason, /exactly one/u);
    const legacyLeak = {
      ...evidence,
      runtimeContexts: [
        ...evidence.runtimeContexts,
        captureRuntimeContextEvidence(
          { type: "message_start", message: { role: "custom", customType: "runtime_context", content: "<project_rules>x</project_rules>" } },
          30,
        ),
      ],
    };
    assert.match(validateProjectInstructionEvidence(legacyLeak, "compiled", fixture.sourceSha256).reason, /legacy marker/u);
    const laterUnseen = {
      ...evidence,
      phaseRelevantToolCalls: [...evidence.phaseRelevantToolCalls, {
        toolName: "edit", phases: ["implementation"], eventOrdinal: 22, endOrdinal: 23,
        blockedByProjectRuleGate: false,
        selectionVerified: true, expectedActionRuleLinks: ["rules/unseen.md"],
      }],
    };
    assert.deepEqual(validateProjectInstructionEvidence(laterUnseen, "compiled", fixture.sourceSha256), { passed: true });
    laterUnseen.phaseRelevantToolCalls.at(-1).blockedByProjectRuleGate = true;
    laterUnseen.phaseRelevantToolCalls.at(-1).projectRuleGateBlockKind = "fixed";
    assert.match(validateProjectInstructionEvidence(laterUnseen, "compiled", fixture.sourceSha256).reason, /reroute/u);
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
        captureUserTurnEvidence(userEvent("calculator tests"), 10),
        captureUserTurnEvidence(userEvent("more calculator tests"), 30),
      ],
      runtimeContexts: [
        captureRuntimeContextEvidence(routeEvent(fixture.inputHash, ["rules/testing.md"]), 11),
        captureRuntimeContextEvidence(routeEvent(fixture.inputHash, ["rules/testing.md"]), 31),
      ],
      readRulesBatches: [],
      phaseRelevantToolCalls: [],
    });
    assert.deepEqual(validateProjectInstructionEvidence(evidence, "compiled", fixture.sourceSha256), { passed: true });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const [label, corrupt] of [
  ["compiler usage", (manifest) => (manifest.compilerUsage.total += 1)],
  ["rule trigger", (manifest) => (manifest.rules[0].trigger = "release deployment")],
  ["rule routability", (manifest) => (manifest.rules[0].routable = false)],
  ["marker input hash", () => {}],
]) {
  test(`rejects compiled cache with corrupted ${label}`, () => {
    const fixture = createCompiledFixture(label === "marker input hash" ? { markerInputHash: "d".repeat(64) } : undefined);
    try {
      const manifest = JSON.parse(readFileSync(fixture.manifestFile, "utf8"));
      corrupt(manifest);
      writeFileSync(fixture.manifestFile, `${JSON.stringify(manifest)}\n`);
      const evidence = captureProjectInstructionEvidence({
        workspace: fixture.root,
        mode: "compiled",
        sourceFile: fixture.sourceFile,
        runtimeContexts: [],
        userTurns: [],
      });
      assert.equal(
        label === "marker input hash" ? evidence.cache?.promptMarkerVerified : evidence.cache,
        label === "marker input hash" ? false : undefined,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("rejects a corrupted rule artifact even when the manifest is unchanged", () => {
  const fixture = createCompiledFixture();
  try {
    writeFileSync(join(fixture.versionDir, "rules/testing.md"), "corrupted\n");
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      runtimeContexts: [],
      userTurns: [],
    });
    assert.equal(evidence.cache, undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a symlinked compiled-cache root without changing its external target", () => {
  const fixture = createCompiledFixture();
  const external = createCompiledFixture();
  try {
    const cacheRoot = join(fixture.root, ".pdev", "instructions");
    const externalRoot = join(external.root, ".pdev", "instructions");
    const sentinel = readFileSync(join(externalRoot, "current.json"), "utf8");
    rmSync(cacheRoot, { recursive: true });
    symlinkSync(externalRoot, cacheRoot);
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      runtimeContexts: [],
      userTurns: [],
    });
    assert.equal(evidence.cache, undefined);
    assert.equal(readFileSync(join(externalRoot, "current.json"), "utf8"), sentinel);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(external.root, { recursive: true, force: true });
  }
});

function userEvent(content) {
  return { type: "message_start", message: { role: "user", content, timestamp: 1 } };
}

function routeEvent(inputHash, links) {
  return {
    type: "message_start",
    message: {
      role: "custom",
      customType: "runtime_context",
      content: `<project_instructions agents_sha256="${"b".repeat(64)}" input_sha256="${inputHash}" mode="compiled">\n</project_instructions>\n<project_rule_routes input_sha256="${inputHash}">\n${links.map((link) => `- \`${link}\``).join("\n")}\n</project_rule_routes>`,
    },
  };
}
