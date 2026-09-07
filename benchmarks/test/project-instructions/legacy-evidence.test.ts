import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatContextFileForPrompt } from "../../../packages/coding-agent/src/core/system-prompt/context-formatting.ts";
import { hashBenchmarkProjectInstructionCacheState } from "../../src/project-instructions/cache.ts";
import {
  captureProjectInstructionEvidence,
  captureRuntimeContextEvidence,
  captureUserTurnEvidence,
  validateProjectInstructionEvidence,
} from "../../src/project-instructions/evidence.ts";
import {
  createBaseSystemModeProof,
  formatLegacyContextFileForProof,
  projectInstructionPreflightFailure,
} from "../../src/project-instructions/probe.ts";

test("captures and validates hash-bound legacy prompt evidence", () => {
  const source = "# Rules\n\nAlways verify.\n";
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const path = "/fixture/AGENTS.md";
  const systemPrompt = [
    "base",
    "<project_context>",
    `<project_instructions path="${path}">`,
    source,
    "</project_instructions>",
    "</project_context>",
  ].join("\n");
  const proof = createBaseSystemModeProof(
    { systemPrompt, systemPromptOptions: { contextFiles: [{ path, content: source }] } },
    "legacy",
    sourceSha256,
  );
  assert.equal(proof.sourceLoaded, true);
  assert.equal(proof.legacySourceInjected, true);
  assert.equal(proof.hasLegacyMarker, true);
  assert.equal(proof.hasCompiledMarker, false);
  assert.equal("systemPrompt" in proof, false);
  assert.equal("content" in proof, false);
  const truncatedProof = createBaseSystemModeProof(
    {
      systemPrompt: systemPrompt.replace(source, "Always ver"),
      systemPromptOptions: { contextFiles: [{ path, content: source }] },
    },
    "legacy",
    sourceSha256,
  );
  assert.equal(truncatedProof.sourceLoaded, true);
  assert.equal(truncatedProof.legacySourceInjected, false);

  const runtime = captureRuntimeContextEvidence(
    {
      type: "message_start",
      message: { role: "custom", customType: "runtime_context", content: "<project_rules>selected</project_rules>" },
    },
    9,
  );
  assert.ok(runtime);
  assert.equal(runtime.hasLegacyProjectRules, true);
  assert.equal(runtime.hasCompiledProjectInstructions, false);
  assert.equal(runtime.eventOrdinal, 9);
  assert.equal("content" in runtime, false);
  const turn = captureUserTurnEvidence({ type: "message_start", message: { role: "user", content: "hello" } }, 1);
  assert.ok(turn);
  const evidence = {
    requestedMode: "legacy",
    sourceSha256,
    postRunCacheStateSha256: hashBenchmarkProjectInstructionCacheState("legacy", sourceSha256, "absent"),
    baseSystemModeProofs: [proof],
    runtimeContexts: [],
    userTurns: [turn],
  } as unknown as NonNullable<Parameters<typeof validateProjectInstructionEvidence>[0]>;
  assert.deepEqual(validateProjectInstructionEvidence(evidence, "legacy", sourceSha256), { passed: true });
  const wrongHashEvidence = {
    ...evidence,
    baseSystemModeProofs: [{ ...proof, legacyInjectedBlockHashes: ["d".repeat(64)] }],
  };
  assert.match(
    validateProjectInstructionEvidence(wrongHashEvidence, "legacy", sourceSha256).reason ?? "",
    /did not prove AGENTS injection/u,
  );
});

test("accepts the exact production legacy rendering for a compacted source", () => {
  const source = `${"ordinary detail line\n".repeat(500)}# Verification\nAlways run focused checks.\n`;
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const path = "/fixture/AGENTS.md";
  const rendered = formatContextFileForPrompt(path, source);
  for (const candidate of [
    "short source",
    source,
    `# ${"x".repeat(100)}\n`.repeat(100),
    `Uſe bland detail\n${"ordinary detail line\n".repeat(500)}`,
  ]) {
    assert.equal(formatLegacyContextFileForProof(path, candidate), formatContextFileForPrompt(path, candidate));
  }
  assert.notEqual(createHash("sha256").update(rendered).digest("hex"), sourceSha256);
  const proof = createBaseSystemModeProof(
    {
      systemPrompt: [
        "base",
        "<project_context>",
        `<project_instructions path="${path}">`,
        rendered,
        "</project_instructions>",
        "</project_context>",
      ].join("\n"),
      systemPromptOptions: { contextFiles: [{ path, content: source }] },
    },
    "legacy",
    sourceSha256,
  );

  assert.equal(proof.sourceLoaded, true);
  assert.equal(proof.legacySourceInjected, true);
  assert.equal(projectInstructionPreflightFailure(proof), undefined);
});

test("legacy evidence rejects compiled cache state created during the child run", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-legacy-cache-"));
  try {
    const sourceFile = join(root, "AGENTS.md");
    const source = "# Rules\nAlways verify.\n";
    writeFileSync(sourceFile, source);
    mkdirSync(join(root, ".pdev", "instructions"), { recursive: true });
    const proof = createBaseSystemModeProof(
      {
        systemPrompt: `<project_context>\n<project_instructions path="${sourceFile}">\n${source}\n</project_instructions>\n</project_context>`,
        systemPromptOptions: { contextFiles: [{ path: sourceFile, content: source }] },
      },
      "legacy",
      createHash("sha256").update(source).digest("hex"),
    );
    const userTurn = captureUserTurnEvidence({ type: "message_start", message: { role: "user", content: "hello" } }, 1);
    assert.ok(userTurn);
    const evidence = captureProjectInstructionEvidence({
      workspace: root,
      mode: "legacy",
      sourceFile,
      baseSystemModeProofs: [proof],
      runtimeContexts: [],
      userTurns: [userTurn],
    });
    rmSync(join(root, ".pdev"), { recursive: true });
    assert.match(
      validateProjectInstructionEvidence(
        evidence as unknown as NonNullable<Parameters<typeof validateProjectInstructionEvidence>[0]>,
        "legacy",
        createHash("sha256").update(source).digest("hex"),
      ).reason ?? "",
      /compiled cache state/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
