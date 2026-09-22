import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicCertificationEvidence } from "../../src/workloads/benchmark-evidence-publication.ts";
import type { CertificationOutcome, CertifiedHarnessBinding } from "../../src/workloads/certification.ts";

test("public certification evidence excludes private runtime paths", () => {
  const privateRoot = "/private/evaluator-runtime";
  const binding = {
    node: { path: `${privateRoot}/node`, version: "v22.0.0", sha256: "1".repeat(64) },
    pSnapshot: { path: `${privateRoot}/candidate`, version: "5.0.1", sha256: "2".repeat(64) },
    pi: { path: `${privateRoot}/pi`, version: "0.82.1", sha256: "3".repeat(64) },
    kilo: { path: `${privateRoot}/kilo`, version: "7.4.17", sha256: "4".repeat(64) },
    modelConfiguration: { sha256: "5".repeat(64) },
    projectInstructions: {
      path: `${privateRoot}/AGENTS.md`,
      sha256: "6".repeat(64),
      receiptSha256: "7".repeat(64),
    },
    evaluator: { path: `${privateRoot}/evaluator`, sha256: "8".repeat(64) },
    holdoutSha256: "9".repeat(64),
    receipts: [
      {
        agent: "p",
        status: "passed",
        receiptSha256: "7".repeat(64),
        responseMatched: true,
        responseModel: "resolved/model",
        responseModels: ["resolved/model"],
        elapsedMs: 10,
      },
    ],
  } satisfies CertifiedHarnessBinding;
  const certification: CertificationOutcome = {
    passed: true,
    failures: [],
    thresholds: { maxDurationRatio: 1, maxTokenRatio: 1 },
    binding,
  };

  const evidence = createPublicCertificationEvidence(certification);
  const serialized = JSON.stringify(evidence);

  assert.equal(serialized.includes(privateRoot), false);
  assert.deepEqual(evidence, {
    passed: true,
    failures: [],
    thresholds: { maxDurationRatio: 1, maxTokenRatio: 1 },
    binding: {
      node: { version: "v22.0.0", sha256: "1".repeat(64) },
      pSnapshot: { version: "5.0.1", sha256: "2".repeat(64) },
      pi: { version: "0.82.1", sha256: "3".repeat(64) },
      kilo: { version: "7.4.17", sha256: "4".repeat(64) },
      modelConfiguration: { sha256: "5".repeat(64) },
      projectInstructions: { sha256: "6".repeat(64), receiptSha256: "7".repeat(64) },
      receipts: binding.receipts,
      evaluator: { sha256: "8".repeat(64) },
      holdoutSha256: "9".repeat(64),
    },
  });
});
