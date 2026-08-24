import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { createCellLivenessMonitor } from "../../src/project-instructions/run-liveness.ts";

const BROTLI_PARAMETERS = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};

function compress(value: Buffer): Buffer {
  return brotliCompressSync(value, { params: BROTLI_PARAMETERS });
}

function toolEvent(toolCallId: string, toolName: string, args: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify({ type: "tool_execution_start", toolCallId, toolName, args })}\n`);
}

function recordingCapture(bytes: Buffer) {
  const manifest = recordingManifest(bytes);
  return {
    format: "chunked-brotli-v1",
    archiveBytes: compress(bytes).length + Buffer.byteLength(`${JSON.stringify(manifest)}\n`),
    archiveLimitBytes: 8_192,
    bytes: bytes.length,
    limitBytes: 8_192,
    partial: false,
    storageBytes: 128,
    storageLimitBytes: 4_096,
  };
}

type RecordingManifestFixture = {
  schemaVersion?: number;
  bytes?: number;
  sha256?: string;
  chunkCount?: number;
};

function recordingManifest(bytes: Buffer): RecordingManifestFixture {
  return {
    schemaVersion: 1,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test("chunk rotation preserves exact-once semantic progress across active and missed generations", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunked-liveness-"));
  const finalRecordingPath = join(root, "recording.jsonl.br");
  const chunkDirectory = `${finalRecordingPath}.chunks`;
  const manifestPath = `${finalRecordingPath}.manifest.json`;
  const progressPath = join(root, "progress.jsonl");
  mkdirSync(chunkDirectory, { mode: 0o700 });
  try {
    const events = Buffer.concat([
      toolEvent("write-1", "write", { path: "src/π.ts" }),
      toolEvent("define-1", "record_requirement_audit", { action: "define" }),
      toolEvent("repair-1", "record_requirement_audit", { action: "repair_definition" }),
      toolEvent("repair-2", "record_requirement_audit", { action: "repair_definition" }),
      toolEvent("verdict-1", "record_requirement_audit", { action: "verdict" }),
    ]);
    const unicodeSplit = events.indexOf(Buffer.from("π")) + 1;
    const secondEvent = events.indexOf(Buffer.from('{"type":"tool_execution_start"'), 1);
    const firstGenerationEnd = secondEvent + 19;
    const firstGeneration = events.subarray(0, firstGenerationEnd);
    const activeZero = join(chunkDirectory, "active.jsonl.active");
    writeFileSync(activeZero, firstGeneration.subarray(0, unicodeSplit), { mode: 0o600 });

    const monitor = createCellLivenessMonitor({
      progressPath,
      finalRecordingPath,
      chunkDirectory,
      manifestPath,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    monitor.observe();

    writeFileSync(join(chunkDirectory, "chunk-000000000000.jsonl.br"), compress(firstGeneration), { mode: 0o600 });
    rmSync(activeZero);
    writeFileSync(join(chunkDirectory, "chunk-000000000001.jsonl.br"), compress(events.subarray(firstGenerationEnd)), {
      mode: 0o600,
    });
    monitor.heartbeat();

    writeFileSync(finalRecordingPath, compress(events), { mode: 0o600 });
    writeFileSync(manifestPath, `${JSON.stringify(recordingManifest(events))}\n`, { mode: 0o600 });
    rmSync(chunkDirectory, { recursive: true });
    const evidence = await monitor.finalize({
      outcome: "process_completed",
      captureMetadataValid: true,
      recordingCapture: recordingCapture(events),
    });

    assert.equal(evidence.semanticEvidenceAvailable, true);
    assert.equal(evidence.semanticEvidenceComplete, true);
    assert.equal(evidence.semanticSequence, 5);
    assert.equal(evidence.mutationCount, 1);
    assert.equal(evidence.requirementDefinitionAttemptCount, 1);
    assert.equal(evidence.requirementDefinitionRepairAttemptCount, 2);
    const progress = brotliDecompressSync(readFileSync(`${progressPath}.br`))
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(progress.at(-2).semanticEventCount, 5);
    assert.equal(progress.at(-2).mutationCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("chunked final recording without a valid terminal manifest stays incomplete", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-chunked-manifest-"));
  try {
    const finalRecordingPath = join(root, "recording.jsonl.br");
    const bytes = toolEvent("write-1", "write", { path: "src/value.ts" });
    writeFileSync(finalRecordingPath, compress(bytes), { mode: 0o600 });
    const monitor = createCellLivenessMonitor({
      progressPath: join(root, "progress.jsonl"),
      finalRecordingPath,
      chunkDirectory: `${finalRecordingPath}.chunks`,
      manifestPath: `${finalRecordingPath}.manifest.json`,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    const evidence = await monitor.finalize({
      outcome: "process_completed",
      captureMetadataValid: true,
      recordingCapture: recordingCapture(bytes),
    });
    assert.equal(evidence.semanticEvidenceAvailable, true);
    assert.equal(evidence.semanticEvidenceComplete, false);
    assert.equal(evidence.requirementDefinitionAttemptCount, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("terminal manifest fields and validated child capture are all required", async (context) => {
  type FinalOptionsFixture = {
    outcome: string;
    captureMetadataValid: boolean;
    recordingCapture: ReturnType<typeof recordingCapture>;
  };
  const cases: Array<[string, (manifest: RecordingManifestFixture, finalOptions: FinalOptionsFixture) => unknown]> = [
    ["schema version", (manifest) => delete manifest.schemaVersion],
    ["byte length", (manifest) => delete manifest.bytes],
    ["SHA-256", (manifest) => delete manifest.sha256],
    [
      "unauthenticated chunk count",
      (manifest) => {
        manifest.chunkCount = 99;
      },
    ],
    [
      "archive byte count",
      (_manifest, finalOptions) => {
        finalOptions.recordingCapture.archiveBytes += 1;
      },
    ],
    [
      "child capture",
      (_manifest, finalOptions) => {
        finalOptions.captureMetadataValid = false;
      },
    ],
  ];
  for (const [name, invalidate] of cases) {
    await context.test(name, async () => {
      const root = mkdtempSync(join(tmpdir(), "p-benchmark-terminal-manifest-"));
      try {
        const bytes = toolEvent("write-1", "write", { path: "src/value.ts" });
        const finalRecordingPath = join(root, "recording.jsonl.br");
        const manifestPath = join(root, "recording.jsonl.manifest.json");
        const manifest = recordingManifest(bytes);
        const finalOptions = {
          outcome: "process_completed",
          captureMetadataValid: true,
          recordingCapture: recordingCapture(bytes),
        };
        invalidate(manifest, finalOptions);
        writeFileSync(finalRecordingPath, compress(bytes), { mode: 0o600 });
        writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
        const monitor = createCellLivenessMonitor({
          progressPath: join(root, "progress.jsonl"),
          finalRecordingPath,
          chunkDirectory: join(root, "recording.jsonl.chunks"),
          manifestPath,
          schedule: () => ({ fake: true }),
          cancel: () => {},
        });
        const evidence = await monitor.finalize(finalOptions);
        assert.equal(evidence.semanticEvidenceAvailable, true);
        assert.equal(evidence.semanticEvidenceComplete, false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test("corrupt or gapped live chunks remain incomplete after a valid final replay", async (context) => {
  for (const kind of ["corrupt", "gapped"]) {
    await context.test(kind, async () => {
      const root = mkdtempSync(join(tmpdir(), "p-benchmark-invalid-live-chunk-"));
      const bytes = toolEvent("write-1", "write", { path: "src/value.ts" });
      const finalRecordingPath = join(root, "recording.jsonl.br");
      const chunkDirectory = join(root, "recording.jsonl.chunks");
      const manifestPath = join(root, "recording.jsonl.manifest.json");
      mkdirSync(chunkDirectory, { mode: 0o700 });
      try {
        const name = kind === "corrupt" ? "chunk-000000000000.jsonl.br" : "chunk-000000000001.jsonl.br";
        writeFileSync(join(chunkDirectory, name), kind === "corrupt" ? Buffer.from("invalid") : compress(bytes), {
          mode: 0o600,
        });
        const monitor = createCellLivenessMonitor({
          progressPath: join(root, "progress.jsonl"),
          finalRecordingPath,
          chunkDirectory,
          manifestPath,
          schedule: () => ({ fake: true }),
          cancel: () => {},
        });
        monitor.observe();
        writeFileSync(finalRecordingPath, compress(bytes), { mode: 0o600 });
        writeFileSync(manifestPath, `${JSON.stringify(recordingManifest(bytes))}\n`, { mode: 0o600 });
        rmSync(chunkDirectory, { recursive: true });
        const evidence = await monitor.finalize({
          outcome: "process_completed",
          captureMetadataValid: true,
          recordingCapture: recordingCapture(bytes),
        });
        assert.equal(evidence.semanticEvidenceAvailable, true);
        assert.equal(evidence.semanticEvidenceComplete, false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
