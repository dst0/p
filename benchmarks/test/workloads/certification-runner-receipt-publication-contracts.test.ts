import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import { evaluateInstructionParityReceipts } from "../../src/workloads/certification-preflight.ts";
import { publishBenchmarkResults } from "../../src/workloads/result-publication.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const hash = (character: string): string => character.repeat(64);

function bindingWithReceipts(receipts: unknown[]) {
  return {
    node: { path: "/node", version: "v22", sha256: hash("a") },
    pSnapshot: { path: "/runtime", version: "1", sha256: hash("b") },
    pi: { path: "/pi", version: "1", sha256: hash("c") },
    kilo: { path: "/kilo", version: "1", sha256: hash("d") },
    projectInstructions: { path: "/AGENTS.md", sha256: hash("e") },
    receipts,
  };
}

function validReceipt(agent: "p" | "pi" | "kilo", character: string) {
  return {
    agent,
    status: "passed" as const,
    receiptSha256: hash(character),
    responseMatched: true,
    responseModel: "resolved/model",
    responseModels: ["resolved/model"],
    proxyEvidence: {
      requestCount: 1,
      requestModels: ["resolved/model"],
      responseModels: ["resolved/model"],
      requestHashes: ["a".repeat(64)],
    },
    elapsedMs: 10,
  };
}

test("instruction parity receipt requires independent matching proxy evidence", () => {
  const valid = [validReceipt("p", "1"), validReceipt("pi", "2"), validReceipt("kilo", "3")];
  assert.deepEqual(
    evaluateInstructionParityReceipts(
      bindingWithReceipts(valid) as Parameters<typeof evaluateInstructionParityReceipts>[0],
      ["p", "pi", "kilo"],
      "resolved/model",
    ),
    [],
  );
  const withoutWire = valid.map((receipt) => ({ ...receipt, proxyEvidence: undefined }));
  const failures = evaluateInstructionParityReceipts(
    bindingWithReceipts(withoutWire) as Parameters<typeof evaluateInstructionParityReceipts>[0],
    ["p", "pi", "kilo"],
    "resolved/model",
  );
  assert.match(failures.join("\n"), /missing certified proxy evidence for instruction parity p/u);
});

test("certified advertised arguments auto-create proof authority and reject P-only thinking", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "provider/model",
    "--expected-resolved-model",
    "resolved/model",
    "--runs",
    "3",
  ]);
  assert.match(options.projectInstructionProofReceipt ?? "", /^[a-f0-9]{64}$/u);
  assert.throws(
    () =>
      parseRunnerArgs([
        "--certified",
        "--model",
        "provider/model",
        "--expected-resolved-model",
        "resolved/model",
        "--runs",
        "3",
        "--thinking",
        "high",
      ]),
    /thinking.*certified|certified.*thinking/iu,
  );
});

test("certified mode permits distinct aliases because resolved backend identity is runtime-verified", () => {
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "pi-provider/model-alias",
    "--kilo-model",
    "kilo-provider/model-alias",
    "--expected-resolved-model",
    "shared/backend-model",
    "--runs",
    "3",
  ]);
  assert.equal(options.model, "pi-provider/model-alias");
  assert.equal(options.kiloModel, "kilo-provider/model-alias");
});

test("receipt evaluation rejects duplicate, unexpected, malformed, model-less, and nonfinite evidence", () => {
  const valid = [validReceipt("p", "1"), validReceipt("pi", "2"), validReceipt("kilo", "3")];
  const cases = [
    [...valid, validReceipt("p", "4")],
    [...valid, { ...validReceipt("p", "4"), agent: "codex" }],
    [{ ...valid[0], receiptSha256: "not-a-hash" }, valid[1], valid[2]],
    [{ ...valid[0], responseModel: undefined }, valid[1], valid[2]],
    [{ ...valid[0], responseModels: ["wrong/model", "resolved/model"] }, valid[1], valid[2]],
    [{ ...valid[0], elapsedMs: Number.NaN }, valid[1], valid[2]],
  ];
  for (const receipts of cases) {
    const failures = evaluateInstructionParityReceipts(
      bindingWithReceipts(receipts) as Parameters<typeof evaluateInstructionParityReceipts>[0],
      ["p", "pi", "kilo"],
      "resolved/model",
    );
    assert.ok(failures.length > 0, JSON.stringify(receipts));
  }
});

test("certified multi-cell publication writes results without single-cell outer authority", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-publication-"));
  try {
    const path = join(root, "results.json");
    bindCertifiedOutputRoot(root);
    const authority = publishBenchmarkResults(path, { results: [{ run: 1 }, { run: 2 }] }, true, "compiled");
    assert.equal(authority, undefined);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).results.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
