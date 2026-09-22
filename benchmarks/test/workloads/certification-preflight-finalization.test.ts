import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import { BenchmarkMutableArtifactsUnsafeError } from "../../src/workloads/benchmark-run-finalization.ts";
import type { CertifiedHarnessCoreBinding } from "../../src/workloads/certification-binding.ts";
import { hashFile, runCertifiedPreflights } from "../../src/workloads/certification-preflight.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

test("unconfirmed preflight termination still redacts its parent-owned recording", async () => {
  const root = mkdtempSync(join(tmpdir(), "certified-preflight-finalization-"));
  const output = join(root, "output");
  const instructions = join(root, "AGENTS.md");
  const receipt = "sensitive-preflight-receipt";
  try {
    mkdirSync(output, { mode: 0o700 });
    writeFileSync(instructions, "project instructions\n");
    bindCertifiedOutputRoot(output);
    const executable = { path: process.execPath, version: process.version, sha256: "a".repeat(64) };
    const binding: CertifiedHarnessCoreBinding = {
      node: executable,
      pSnapshot: executable,
      pi: executable,
      kilo: executable,
      modelConfiguration: { sha256: "b".repeat(64) },
      projectInstructions: { path: instructions, sha256: hashFile(instructions) },
    };
    const options = parseRunnerArgs(["--model", "expected/model", "--kilo-model", "expected/model"]);

    await assert.rejects(
      runCertifiedPreflights(
        options,
        {},
        output,
        performance.now() + 10_000,
        receipt,
        binding,
        async (_command, _timeout, recordingPath) => {
          writeFileSync(
            recordingPath,
            brotliCompressSync(Buffer.from(`${receipt}\n`), {
              params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
            }),
          );
          throw new BenchmarkMutableArtifactsUnsafeError("benchmark process tree did not terminate");
        },
      ),
      BenchmarkMutableArtifactsUnsafeError,
    );

    const recording = brotliDecompressSync(readFileSync(join(output, "recordings", "p-preflight.log.br"))).toString(
      "utf8",
    );
    assert.equal(recording.includes(receipt), false);
    assert.match(recording, /REDACTED_PARITY_RECEIPT/u);
    assert.equal(readFileSync(join(output, "preflight", "p", "AGENTS.md"), "utf8"), "project instructions\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
