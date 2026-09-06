import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyProjectInstructionOuterAuthority,
  createProjectInstructionOuterAuthorityCapture,
  createProjectInstructionOuterAuthorityEnvelope,
  hashProjectInstructionResult,
  sendCommittedProjectInstructionOuterAuthority,
  sendProjectInstructionOuterAuthority,
  writeExclusiveProjectInstructionResult,
  writeProjectInstructionResultPublication,
} from "../../src/project-instructions/outer-authority.ts";
import { runPairedBenchmarkCell } from "../../src/project-instructions/run-cell.ts";
import {
  bindProjectInstructionTurnAuthority,
  createProjectInstructionTurnChallenge,
  validateProjectInstructionTurnAuthoritySequence,
} from "../../src/project-instructions/turn-authority.ts";

type IpcTarget = NonNullable<Parameters<typeof sendCommittedProjectInstructionOuterAuthority>[2]>;
type CellContext = Parameters<typeof runPairedBenchmarkCell>[0];
type CellOperations = NonNullable<Parameters<typeof runPairedBenchmarkCell>[1]>;
type CreateSample = NonNullable<CellOperations["createSample"]>;
type SampleContext = Parameters<CreateSample>[1];

const hash = (character: string): string => character.repeat(64);

function rawProof() {
  return {
    requestedMode: "compiled",
    sourceSha256: hash("b"),
    systemPromptSha256: hash("c"),
    systemPromptBytes: 10,
    hasLegacyMarker: false,
    hasCompiledMarker: true,
    compiledInstructionsInjected: true,
    sourceLoaded: true,
    legacySourceInjected: false,
    legacyInjectedBlockHashes: [],
    legacyExpectedBlockHashes: [],
  };
}

test("each launched turn receives a prompt-bound non-replayable challenge", () => {
  const cellReceiptSha256 = hash("a");
  const first = createProjectInstructionTurnChallenge(cellReceiptSha256, 1, "inspect the fixture");
  const second = createProjectInstructionTurnChallenge(cellReceiptSha256, 2, "inspect the fixture");
  assert.notEqual(first.receiptSha256, second.receiptSha256);

  const userTurn = { eventOrdinal: 7, sha256: first.promptSha256, bytes: first.promptBytes };
  const proof = bindProjectInstructionTurnAuthority(rawProof(), first, [userTurn]);
  assert.ok(proof);
  assert.equal(proof.expectedPromptSha256, first.promptSha256);
  assert.equal(validateProjectInstructionTurnAuthoritySequence([proof], cellReceiptSha256, 1, [userTurn]), true);

  assert.equal(bindProjectInstructionTurnAuthority(rawProof(), first, []), undefined);
  assert.equal(bindProjectInstructionTurnAuthority(rawProof(), first, [{ ...userTurn, sha256: hash("d") }]), undefined);
  assert.equal(validateProjectInstructionTurnAuthoritySequence([proof], cellReceiptSha256, 2, [userTurn]), false);
  assert.equal(
    validateProjectInstructionTurnAuthoritySequence([proof, { ...proof, turnOrdinal: 2 }], cellReceiptSha256, 2, [
      userTurn,
      { ...userTurn, eventOrdinal: 8 },
    ]),
    false,
  );
});

test("outer authority accepts one receipt-bound frame committing exact result bytes", () => {
  const cellReceiptSha256 = hash("e");
  const resultText = `${JSON.stringify({ results: [{ status: "passed" }] })}\n`;
  const authority = {
    expectedTurnCount: 1,
    baseSystemModeProofs: [{ turnOrdinal: 1 }],
    userTurns: [{ eventOrdinal: 1 }],
  };
  const envelope = createProjectInstructionOuterAuthorityEnvelope(
    cellReceiptSha256,
    authority,
    hashProjectInstructionResult(resultText),
  );
  const capture = createProjectInstructionOuterAuthorityCapture(cellReceiptSha256);
  capture.accept(envelope);
  assert.deepEqual(capture.finish(), envelope.authority);

  const duplicate = createProjectInstructionOuterAuthorityCapture(cellReceiptSha256);
  duplicate.accept(envelope);
  duplicate.accept(envelope);
  assert.equal(duplicate.finish(), undefined);

  const replay = createProjectInstructionOuterAuthorityCapture(hash("f"));
  replay.accept(envelope);
  assert.equal(replay.finish(), undefined);

  const malformed = createProjectInstructionOuterAuthorityCapture(cellReceiptSha256);
  malformed.accept({ ...envelope, authority: { ...envelope.authority, extra: true } });
  assert.equal(malformed.finish(), undefined);
});

test("outer authority rejects child-result overwrite and proof substitution", () => {
  const resultSha256 = hash("1");
  const authority = {
    expectedTurnCount: 1,
    baseSystemModeProofs: [{ turnOrdinal: 1 }],
    userTurns: [{ eventOrdinal: 1 }],
    resultSha256,
  };
  const evidence = {
    proofExpectedTurnCount: 1,
    baseSystemModeProofs: [{ turnOrdinal: 1 }],
    userTurns: [{ eventOrdinal: 1 }],
  };
  assert.deepEqual(applyProjectInstructionOuterAuthority(evidence, authority, resultSha256), evidence);
  assert.throws(() => applyProjectInstructionOuterAuthority(evidence, authority, hash("2")), /result commitment/iu);
  assert.throws(
    () =>
      applyProjectInstructionOuterAuthority(
        { ...evidence, baseSystemModeProofs: [{ turnOrdinal: 2 }] },
        authority,
        resultSha256,
      ),
    /proof evidence/iu,
  );
});

test("exclusive result publication rejects precreated files and symlink escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "p-authority-publication-"));
  try {
    const target = join(root, "target.json");
    const result = join(root, "results.json");
    writeFileSync(target, "unchanged\n");
    symlinkSync(target, result);
    assert.throws(() => writeExclusiveProjectInstructionResult(result, "forged\n"), /exist|exclusive/iu);
    assert.equal(readFileSync(target, "utf8"), "unchanged\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("published result authority retains exact original bytes and mode after descendant rewrite", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-authority-commitment-"));
  try {
    const result = join(root, "results.json");
    const evidence = { proofExpectedTurnCount: 1, baseSystemModeProofs: [{}], userTurns: [{}] };
    const authority = writeProjectInstructionResultPublication(
      result,
      { results: [{ projectInstructionEvidence: evidence }] },
      true,
    );
    assert.ok(authority);
    const originalSha256 = authority.resultSha256;
    assert.equal(statSync(result).mode & 0o777, 0o600);
    writeFileSync(result, "descendant rewrite\n");
    let sent: Parameters<typeof sendProjectInstructionOuterAuthority>[0] | undefined;
    const target = {
      connected: true,
      send(message: unknown, callback: (error?: Error | null) => void) {
        sent = message as Parameters<typeof sendProjectInstructionOuterAuthority>[0];
        callback();
      },
      disconnect() {},
    } as unknown as IpcTarget;
    await sendCommittedProjectInstructionOuterAuthority(hash("7"), authority, target);
    assert.ok(sent);
    assert.equal(sent.authority.resultSha256, originalSha256);
    assert.notEqual(sent.authority.resultSha256, hashProjectInstructionResult(readFileSync(result)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outer sender rejects malformed and oversized authority frames before IPC", () => {
  const malformed = { schemaVersion: 1, kind: "project-instruction-outer-authority" };
  assert.throws(
    () =>
      sendProjectInstructionOuterAuthority(
        malformed as unknown as Parameters<typeof sendProjectInstructionOuterAuthority>[0],
        {} as unknown as IpcTarget,
      ),
    /invalid/iu,
  );
  const oversized = {
    schemaVersion: 1,
    kind: "project-instruction-outer-authority",
    cellReceiptSha256: hash("8"),
    authority: {
      expectedTurnCount: 1,
      baseSystemModeProofs: [{ payload: "x".repeat(65_536) }],
      userTurns: [{}],
      resultSha256: hash("9"),
    },
  };
  assert.throws(
    () =>
      sendProjectInstructionOuterAuthority(
        oversized as unknown as Parameters<typeof sendProjectInstructionOuterAuthority>[0],
        {} as unknown as IpcTarget,
      ),
    /oversized/iu,
  );
});

test("paired cell accepts proof authority only from the outer IPC capture", async () => {
  const receiptSha256 = hash("3");
  const authority = {
    expectedTurnCount: 1,
    baseSystemModeProofs: [{ turnOrdinal: 1 }],
    userTurns: [{ eventOrdinal: 1 }],
    resultSha256: hash("4"),
  };
  let capturedContext: SampleContext | undefined;
  const context = {
    options: {
      privateSnapshots: {},
      authFiles: [],
      model: "provider/model",
      sourceSha256: hash("5"),
    },
    pair: { run: 1, task: "authority-fixture" },
    condition: "legacy",
    scratchOutput: "/tmp/p-authority-scratch",
    cellOutput: "/tmp/p-authority-cell",
    remainingSeconds: 60,
    runtimeSnapshot: "/tmp/p-authority-runtime",
    runtimeSha256: hash("6"),
    progressPath: "/tmp/p-authority-progress.jsonl",
    output: "/tmp/p-authority-output",
    repoRoot: "/tmp",
  } as unknown as CellContext;
  const operations = {
    verifyPrivateInputs: () => true,
    assertLegacyUnseeded: () => {},
    hashRuntime: () => hash("6"),
    buildArgs: () => [],
    resolveRunner: () => "/runtime/benchmarks/src/run-agents.ts",
    buildEnvironment: () => ({}),
    runChild: async () => ({ status: 0, signal: null, projectInstructionAuthority: authority }),
    createMonitor: () => ({
      finalize: async () => ({
        semanticEvidenceAvailable: true,
        semanticEvidenceComplete: true,
        taskVerification: {
          readinessAttemptCount: 1,
          evidenceCertificateCount: 1,
          auditToolCallCount: 0,
          auditDefinitionAttemptCount: 0,
          auditRepairAttemptCount: 0,
          auditVerdictAttemptCount: 0,
          auditCertificateCount: 0,
          finishCertificateSubmissionCount: 1,
          acceptedFinishCount: 1,
        },
      }),
    }),
    readResult: () => ({
      result: { status: "passed", metrics: {} },
      recordingCapture: { format: "chunked-brotli-v1" },
      captureOverflow: undefined,
      resultSha256: authority.resultSha256,
    }),
    createSample: (_parsed: Parameters<CreateSample>[0], sampleContext: SampleContext) => {
      capturedContext = sampleContext;
      return { status: "passed" };
    },
    settleEvidence: () => {},
    createProofReceipt: () => ({ sha256: receiptSha256 }),
  } as unknown as CellOperations;
  let readCalled = false;
  await assert.rejects(
    runPairedBenchmarkCell(context, {
      ...operations,
      runChild: async () => ({ status: 0, signal: null }),
      readResult: () => {
        readCalled = true;
        throw new Error("result read must not run without outer proof authority");
      },
    }),
    /outer proof authority is missing/iu,
  );
  assert.equal(readCalled, false);
  const sample = await runPairedBenchmarkCell(context, operations);
  assert.equal(sample.status, "passed");
  assert.ok(capturedContext);
  assert.deepEqual(capturedContext.projectInstructionAuthority, authority);
  assert.equal(capturedContext.proofReceiptSha256, receiptSha256);
});
