import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBaseSystemModeProof } from "./benchmark-project-instruction-probe.js";
import {
  captureProjectInstructionEvidence,
  captureRuntimeContextEvidence,
  captureUserTurnEvidence,
} from "./benchmark-project-instruction-evidence.js";
import { createCompiledFixture } from "./benchmark-project-instruction-evidence-fixture.js";
import { projectProjectInstructionEvidence } from "./benchmark-project-instruction-evidence-projection.js";
import { createValidatedPairedSample } from "./benchmark-project-instructions-sample.js";
import {
  bindProjectInstructionTurnAuthority,
  createProjectInstructionTurnChallenge,
} from "./benchmark-project-instruction-turn-authority.js";

test("captured project-instruction evidence exact-picks nested public fields", () => {
  const fixture = createCompiledFixture();
  const privateMarker = "private-contamination-marker";
  try {
    const baseProof = createBaseSystemModeProof(
      {
        systemPrompt: fixture.prompt,
        systemPromptOptions: { contextFiles: [], projectInstructions: fixture.prompt },
      },
      "compiled",
      fixture.sourceSha256,
    );
    baseProof.rawResponse = { provider: privateMarker };
    const runtimeContext = captureRuntimeContextEvidence(
      {
        type: "message_start",
        message: { role: "custom", customType: "runtime_context", content: fixture.prompt },
      },
      11,
    );
    runtimeContext.source = { rawResponse: privateMarker };
    const userTurn = captureUserTurnEvidence(
      { type: "message_start", message: { role: "user", content: "calculator tests" } },
      10,
    );
    userTurn.provider = privateMarker;
    const evidence = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      baseSystemModeProofs: [baseProof],
      runtimeContexts: [runtimeContext],
      userTurns: [userTurn],
      readRulesBatches: [{
        links: ["rules/testing.md"],
        succeeded: true,
        startOrdinal: 12,
        endOrdinal: 13,
        rawResponse: privateMarker,
      }],
      phaseRelevantToolCalls: [{
        toolName: "bash",
        phases: ["testing"],
        eventOrdinal: 14,
        endOrdinal: 15,
        blockedByProjectRuleGate: true,
        projectRuleGateBlockKind: "pending",
        pendingRuleBatches: [["rules/testing.md"]],
        actionQueries: ['bash\n{"command":"npm run test:unit"}'],
        args: { rawResponse: privateMarker },
      }],
    });
    const serialized = JSON.stringify(evidence);
    assert.equal(serialized.includes(privateMarker), false);
    assert.deepEqual(evidence.readRulesBatches[0].links, ["rules/testing.md"]);
    assert.deepEqual(evidence.phaseRelevantToolCalls[0].phases, ["testing"]);
    assert.deepEqual(evidence.phaseRelevantToolCalls[0].pendingRuleBatches, [["rules/testing.md"]]);

    const invalidLinks = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      baseSystemModeProofs: [baseProof],
      runtimeContexts: [runtimeContext],
      userTurns: [userTurn],
      readRulesBatches: [{
        links: ["rules/testing.md", { rawResponse: privateMarker }],
        succeeded: true,
        startOrdinal: 12,
        endOrdinal: 13,
      }],
      phaseRelevantToolCalls: [{
        toolName: "bash",
        phases: ["testing"],
        eventOrdinal: 14,
        pendingRuleBatches: [["rules/testing.md", { provider: privateMarker }]],
        actionQueries: ['bash\n{"command":"npm run test:unit"}'],
      }],
    });
    assert.equal(JSON.stringify(invalidLinks).includes(privateMarker), false);
    assert.deepEqual(invalidLinks.readRulesBatches, []);
    assert.deepEqual(invalidLinks.phaseRelevantToolCalls, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("malformed high-risk evidence arrays are dropped whole", () => {
  const fixture = createCompiledFixture();
  const privateMarker = "private-array-marker";
  try {
    const proof = createBaseSystemModeProof(
      { systemPrompt: fixture.prompt, systemPromptOptions: { contextFiles: [], projectInstructions: fixture.prompt } },
      "compiled",
      fixture.sourceSha256,
    );
    const captured = captureProjectInstructionEvidence({
      workspace: fixture.root,
      mode: "compiled",
      sourceFile: fixture.sourceFile,
      baseSystemModeProofs: [proof],
      runtimeContexts: [],
      userTurns: [captureUserTurnEvidence(
        { type: "message_start", message: { role: "user", content: "hello" } },
        1,
      )],
      readRulesBatches: [],
      phaseRelevantToolCalls: [],
    });
    const projected = projectProjectInstructionEvidence({
      ...captured,
      baseSystemModeProofs: [{
        ...captured.baseSystemModeProofs[0],
        legacyInjectedBlockHashes: [{ rawResponse: privateMarker }],
      }],
      cache: {
        ...captured.cache,
        authorizedPromptHashes: [...captured.cache.authorizedPromptHashes, { source: privateMarker }],
        manifest: {
          ...captured.cache.manifest,
          sourceHashes: [...captured.cache.manifest.sourceHashes, { provider: privateMarker }],
        },
      },
    });
    assert.equal(JSON.stringify(projected).includes(privateMarker), false);
    assert.deepEqual(projected.baseSystemModeProofs, []);
    assert.equal(projected.cache, undefined);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("validated parent samples replace contaminated child instruction evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-evidence-privacy-"));
  const privateMarker = "private-child-evidence-marker";
  try {
    const task = "privacy-fixture";
    const scratchOutput = join(root, "scratch");
    const workspace = join(scratchOutput, "workspaces", "p", "run-1", task);
    const workspaceAgents = join(workspace, "AGENTS.md");
    const sourceFile = join(root, "source-AGENTS.md");
    const source = "# Rules\nAlways verify.";
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const proofReceiptSha256 = "f".repeat(64);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(workspaceAgents, source);
    writeFileSync(sourceFile, source);
    const systemPrompt = `<project_context>\n<project_instructions path="${workspaceAgents}">\n${source}\n</project_instructions>\n</project_context>`;
    const proof = createBaseSystemModeProof(
      { systemPrompt, systemPromptOptions: { contextFiles: [{ path: workspaceAgents, content: source }] } },
      "legacy",
      sourceSha256,
    );
    const turn = captureUserTurnEvidence(
      { type: "message_start", message: { role: "user", content: "inspect the fixture" } },
      1,
    );
    const challenge = createProjectInstructionTurnChallenge(proofReceiptSha256, 1, "inspect the fixture");
    const boundProof = bindProjectInstructionTurnAuthority(proof, challenge, [turn]);
    const evidence = captureProjectInstructionEvidence({
      workspace,
      mode: "legacy",
      sourceFile,
      proofReceiptSha256,
      proofExpectedTurnCount: 1,
      baseSystemModeProofs: [{
        ...boundProof,
        rawResponse: { source: privateMarker },
      }],
      runtimeContexts: [],
      userTurns: [turn],
      readRulesBatches: [],
      phaseRelevantToolCalls: [],
    });
    evidence.rawResponse = { provider: privateMarker };
    const projectedEvidence = projectProjectInstructionEvidence(evidence);
    const resultSha256 = "e".repeat(64);
    const sample = createValidatedPairedSample(
      {
        document: {
          startupProbes: {},
          projectInstructions: "legacy",
          runs: 1,
          agents: ["p"],
          models: { p: "provider/model" },
        },
        result: {
          run: 1,
          agent: "p",
          task,
          status: "failed",
          elapsedMs: 1,
          metrics: {
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              args: privateMarker,
            },
            model: { provider: "provider", id: "model", api: "test", source: privateMarker },
            rawResponse: privateMarker,
          },
          quality: {
            passed: false,
            score: 0,
            maxScore: 1,
            rawScore: 0,
            checks: [{ name: "fixture", passed: false, weight: 1, source: privateMarker }],
            rawResponse: privateMarker,
          },
          projectInstructionEvidence: evidence,
          rawResponse: privateMarker,
          source: { provider: privateMarker },
          provider: privateMarker,
          args: { rawResponse: privateMarker },
        },
        resultSha256,
      },
      {
        options: { model: "provider/model", sourceSha256 },
        pair: { run: 2, task },
        mode: "legacy",
        scratchOutput,
        runtimeSha256: "runtime-sha",
        proofReceiptSha256,
        projectInstructionAuthority: {
          expectedTurnCount: 1,
          baseSystemModeProofs: projectedEvidence.baseSystemModeProofs,
          userTurns: projectedEvidence.userTurns,
          resultSha256,
        },
      },
    );
    const serialized = JSON.stringify(sample);
    assert.equal(serialized.includes(privateMarker), false);
    assert.equal(serialized.includes("rawResponse"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
