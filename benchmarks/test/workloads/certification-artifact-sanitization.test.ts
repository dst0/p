import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import {
  redactReceiptFromBrotliFile,
  sanitizeCertifiedReceiptArtifacts,
} from "../../src/workloads/certification-preflight.ts";

test("certified receipt cleanup removes every harness-owned persisted copy", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-receipt-cleanup-"));
  const receipt = "parity-receipt-sensitive-value";
  try {
    const instructions = join(root, "instructions", "AGENTS.md");
    const workspace = join(root, "workspaces", "p", "run-1", "task");
    const recording = join(root, "recordings", "p-run-1-task.jsonl.br");
    mkdirSync(join(workspace, ".git", "objects"), { recursive: true });
    mkdirSync(join(root, "instructions"), { recursive: true });
    mkdirSync(join(root, "recordings"), { recursive: true });
    writeFileSync(instructions, `rules\n${receipt}\n`);
    writeFileSync(join(workspace, "AGENTS.md"), `rules\n${receipt}\n`);
    writeFileSync(join(workspace, ".git", "objects", "receipt-copy"), receipt);
    writeFileSync(join(root, "outside"), "outside\n");
    symlinkSync(join(root, "outside"), join(workspace, "outside-link"));
    writeFileSync(join(root, "results.json"), JSON.stringify({ finalText: receipt }));
    writeFileSync(
      recording,
      brotliCompressSync(Buffer.from(`{"text":${JSON.stringify(receipt)}}\n`), {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
      }),
    );
    bindCertifiedOutputRoot(root);

    sanitizeCertifiedReceiptArtifacts(root, receipt);

    assert.equal(existsSync(join(root, "instructions")), false);
    assert.equal(existsSync(join(workspace, "AGENTS.md")), false);
    assert.equal(existsSync(join(workspace, ".git")), false);
    assert.equal(existsSync(join(workspace, "outside-link")), false);
    assert.equal(readFileSync(join(root, "results.json"), "utf8").includes(receipt), false);
    const recordingText = brotliDecompressSync(readFileSync(recording)).toString("utf8");
    assert.equal(recordingText.includes(receipt), false);
    assert.match(recordingText, /REDACTED_PARITY_RECEIPT/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated Brotli recording redaction fails closed on corrupt data", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-receipt-corrupt-"));
  try {
    const recording = join(root, "recording.log.br");
    writeFileSync(recording, "not Brotli data");
    bindCertifiedOutputRoot(root);
    assert.throws(
      () => redactReceiptFromBrotliFile(recording, "parity-receipt-value"),
      /Unable to redact certified receipt/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tree cleanup continues redacting safe artifacts before reporting a corrupt generated recording", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-receipt-partial-failure-"));
  const receipt = "parity-receipt-partial-failure";
  try {
    mkdirSync(join(root, "recordings"));
    writeFileSync(join(root, "recordings", "corrupt.log.br"), "not Brotli data");
    writeFileSync(join(root, "results.json"), receipt);
    bindCertifiedOutputRoot(root);

    assert.throws(() => sanitizeCertifiedReceiptArtifacts(root, receipt), /Unable to sanitize certified receipt/u);
    assert.equal(readFileSync(join(root, "results.json"), "utf8").includes(receipt), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unsafe cleanup redacts owned receipt artifacts without traversing a mutable workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-receipt-unsafe-workspace-"));
  const external = mkdtempSync(join(tmpdir(), "certified-receipt-unsafe-external-"));
  const receipt = "parity-receipt-unsafe-cleanup";
  try {
    mkdirSync(join(root, "instructions"));
    mkdirSync(join(root, "workspaces"));
    writeFileSync(join(root, "instructions", "AGENTS.md"), receipt);
    writeFileSync(join(root, "results.json"), receipt);
    writeFileSync(join(external, "protected.txt"), receipt);
    symlinkSync(external, join(root, "workspaces", "p"), "dir");
    bindCertifiedOutputRoot(root);

    sanitizeCertifiedReceiptArtifacts(root, receipt, { mutableArtifactsSafe: false });

    assert.equal(existsSync(join(root, "instructions")), false);
    assert.equal(readFileSync(join(root, "results.json"), "utf8").includes(receipt), false);
    assert.equal(readFileSync(join(external, "protected.txt"), "utf8"), receipt);
    assert.equal(existsSync(join(root, "workspaces", "p")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
