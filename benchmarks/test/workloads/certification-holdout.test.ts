import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CertifiedHarnessBinding } from "../../src/workloads/certification.ts";
import { createCertifiedTaskVariants } from "../../src/workloads/certification-holdout.ts";
import type { BenchmarkTask } from "../../src/workloads/task-definition.ts";

const binding: CertifiedHarnessBinding = {
  node: { path: "/node", version: "1", sha256: "1".repeat(64) },
  pSnapshot: { path: "/candidate", version: "1", sha256: "2".repeat(64) },
  pi: { path: "/pi", version: "1", sha256: "3".repeat(64) },
  kilo: { path: "/kilo", version: "1", sha256: "4".repeat(64) },
  projectInstructions: { path: "/AGENTS.md", sha256: "5".repeat(64) },
};

function task(): BenchmarkTask {
  return {
    id: "holdout-task",
    timeoutSeconds: 10,
    maxScore: 1,
    description: "holdout",
    files: { "README.md": "fixture\n" },
    prompt: "complete the fixture",
    verify: () => ({ passed: true, score: 1, maxScore: 1, checks: [] }),
  };
}

test("certified holdouts are randomized after candidate binding and keep their answer sealed", () => {
  const first = createCertifiedTaskVariants([task()], binding)[0]!;
  const second = createCertifiedTaskVariants([task()], binding)[0]!;
  const firstChallenge = first.files["certified-holdout-challenge.json"]!;
  const secondChallenge = second.files["certified-holdout-challenge.json"]!;
  assert.notEqual(firstChallenge, secondChallenge);
  assert.equal(firstChallenge.includes("expected"), false);
  assert.equal(firstChallenge.includes("answer"), false);
  assert.match(first.prompt, /certified-holdout-result\.json/u);
});

test("a canonical-fixture-only answer fails while a computed randomized holdout passes", () => {
  const root = mkdtempSync(join(tmpdir(), "certified-holdout-"));
  try {
    const variant = createCertifiedTaskVariants([task()], binding)[0]!;
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "certified-holdout-challenge.json"), variant.files["certified-holdout-challenge.json"]!);
    writeFileSync(join(root, "certified-holdout-result.json"), JSON.stringify({ digest: "canonical-hardcode" }));
    assert.equal(variant.verify(root, variant.files, "").passed, false);

    const challenge = JSON.parse(variant.files["certified-holdout-challenge.json"]!) as {
      nonce: string;
      taskId: string;
      values: number[];
    };
    const sum = challenge.values.reduce((total, value) => total + value, 0);
    const digest = createHash("sha256").update(`${challenge.taskId}:${challenge.nonce}:${sum}`).digest("hex");
    writeFileSync(join(root, "certified-holdout-result.json"), `${JSON.stringify({ digest })}\n`);
    assert.equal(variant.verify(root, variant.files, "").passed, true);
    assert.equal(readFileSync(join(root, "certified-holdout-result.json"), "utf8").includes(challenge.nonce), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
