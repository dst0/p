import assert from "node:assert/strict";
import { test } from "node:test";
import { runPairedBenchmarkCell } from "../../src/project-instructions/run-cell.ts";
import { createUnavailableCellLiveness } from "../../src/project-instructions/run-liveness.ts";

const privateSnapshots = {
  models: { path: "", present: false, sha256: "", dispose() {} },
  auth: { path: "", present: false, dispose() {} },
  dispose() {},
};

function context() {
  return {
    options: { privateSnapshots, authFiles: [], sourceSha256: "a".repeat(64) } as unknown as Parameters<
      typeof runPairedBenchmarkCell
    >[0]["options"],
    pair: { run: 1, task: "typescript-calculator" },
    condition: "legacy" as const,
    cellOutput: "/tmp/unused-cell-output",
    scratchOutput: "/tmp/unused-scratch-output",
    remainingSeconds: 60,
    runtimeSnapshot: "/tmp/unused-runtime",
    runtimeSha256: "b".repeat(64),
    progressPath: "/tmp/unused-progress.jsonl",
    output: "/tmp/unused-output",
    repoRoot: "/tmp/unused-repo",
  };
}

async function captureFailure(result: Record<string, unknown>): Promise<Error> {
  const sample = {
    run: 1,
    task: "typescript-calculator",
    condition: "legacy" as const,
    mode: "legacy" as const,
    taskVerificationMode: "evidence" as const,
    status: result.status as string,
    elapsedMs: 1,
    quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
    metrics: { usage: { totalTokens: 1 } },
  };
  try {
    await runPairedBenchmarkCell(context(), {
      verifyPrivateInputs: () => true,
      assertLegacyUnseeded: () => {},
      hashRuntime: () => "b".repeat(64),
      buildArgs: () => [],
      resolveRunner: () => "/tmp/unused-runner.js",
      buildEnvironment: () => process.env,
      createProofReceipt: (identity) => ({ ...identity, nonce: "nonce", sha256: "c".repeat(64) }),
      createMonitor: () => ({
        observe() {},
        heartbeat() {},
        finalize: async () => ({
          ...createUnavailableCellLiveness(),
          semanticEvidenceAvailable: false,
          semanticEvidenceComplete: false,
        }),
      }),
      runChild: async () => ({
        status: 0,
        signal: null,
        projectInstructionAuthority: {
          resultSha256: "d".repeat(64),
          expectedTurnCount: 1,
          baseSystemModeProofs: [],
          userTurns: [],
        },
      }),
      readResult: () => ({
        document: { results: [result] },
        result,
        recordingCapture: {
          format: "chunked-brotli-v1",
          archiveBytes: 1,
          archiveLimitBytes: 2,
          bytes: 1,
          limitBytes: 2,
          partial: false,
          storageBytes: 1,
          storageLimitBytes: 2,
        },
        captureOverflow: undefined,
        resultSha256: "d".repeat(64),
      }),
      createSample: () => sample,
      settleEvidence: () => {},
    });
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new Error("expected paired cell to fail");
}

test("paired cell preserves explicit timeout over incomplete semantic evidence", async () => {
  const error = await captureFailure({ status: "timed_out", metrics: {} });
  assert.equal(error.message, "run status timed_out");
});

test("paired cell preserves provider termination over incomplete semantic evidence", async () => {
  const error = await captureFailure({ status: "failed", metrics: { errors: ["provider stopped"] } });
  assert.equal(error.message, "provider terminated before successful completion");
});
