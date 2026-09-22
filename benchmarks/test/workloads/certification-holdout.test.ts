import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hashRuntimeSnapshot, hashSnapshotDirectory } from "../../src/harness/runtime-snapshot.ts";
import {
  bindCertifiedHarness,
  bindCertifiedHarnessCore,
  type CertifiedHarnessCoreBinding,
  type CertifiedHarnessInputs,
  recheckCertifiedHarness,
} from "../../src/workloads/certification-binding.ts";
import { createCertifiedTaskVariants } from "../../src/workloads/certification-holdout.ts";
import { createSealedHoldoutPlan, recheckSealedHoldoutPlan } from "../../src/workloads/certification-holdout-plan.ts";
import { bindCertifiedModelConfiguration } from "../../src/workloads/certification-model-config.ts";
import { certifiedTaskIds, certifiedTaskMaxScore } from "../../src/workloads/certified-task-score-policy.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";
import { writeCertifiedModelConfigurationFixture } from "./certification-model-config-fixture.ts";

const seed = Buffer.alloc(32, 17);

test("sealed plans are deterministic for injected seeds and bind core and evaluator identity", () => {
  const root = mkdtempSync(join(tmpdir(), "sealed-holdout-plan-"));
  try {
    const first = createPlan(join(root, "first"), "a".repeat(64), seed);
    const second = createPlan(join(root, "second"), "a".repeat(64), seed);
    const changedSeed = createPlan(join(root, "third"), "a".repeat(64), Buffer.alloc(32, 18));
    const changedCore = createPlan(join(root, "fourth"), "b".repeat(64), seed);
    assert.deepEqual(first.holdout.plan, second.holdout.plan);
    assert.equal(first.holdout.holdoutSha256, second.holdout.holdoutSha256);
    assert.notEqual(first.holdout.holdoutSha256, changedSeed.holdout.holdoutSha256);
    assert.notEqual(first.holdout.holdoutSha256, changedCore.holdout.holdoutSha256);
    assert.deepEqual(
      first.holdout.plan.taskPlans.map((plan) => plan.taskId),
      certifiedTaskIds,
    );
    const monolith = first.holdout.plan.taskPlans.find((plan) => plan.taskId === "monolith-split");
    assert.ok(monolith && monolith.domain === "monolith");
    assert.equal(new Set(monolith.input.source.match(/^\d+/gmu)).size, 5);
    const inventory = first.holdout.plan.taskPlans.find((plan) => plan.taskId === "event-sourced-inventory");
    assert.ok(inventory && inventory.domain === "inventory");
    assert.notEqual(inventory.input.batch.skuA, inventory.input.batch.skuB);
    assert.ok(inventory.input.batch.invalidReserveB > inventory.input.batch.receivedB);
    const workflow = first.holdout.plan.taskPlans.find((plan) => plan.taskId === "durable-workflow-saga");
    assert.ok(workflow && workflow.domain === "workflow");
    assert.notEqual(workflow.input.first, workflow.input.second);
    assert.notEqual(workflow.input.workflowId, workflow.input.retry.workflowId);
    assert.ok(workflow.input.retry.retryDelayMs > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sealed variants preserve candidate prompts and files while applying certified maxima", () => {
  const root = mkdtempSync(join(tmpdir(), "sealed-holdout-variants-"));
  try {
    const { holdout } = createPlan(join(root, "evaluator"), "a".repeat(64), seed);
    const variants = createCertifiedTaskVariants(benchmarkTasks, holdout);
    for (const original of benchmarkTasks) {
      const variant = variants.find((task) => task.id === original.id);
      assert.ok(variant);
      assert.equal(variant.prompt, original.prompt);
      assert.equal(variant.files, original.files);
      assert.equal(variant.maxScore, certifiedTaskMaxScore[original.id as keyof typeof certifiedTaskMaxScore]);
    }
    const calculator = holdout.plan.taskPlans.find((plan) => plan.taskId === "typescript-calculator");
    assert.ok(calculator && calculator.domain === "calculator");
    const candidateVisible = JSON.stringify(variants.map(({ prompt, files }) => ({ prompt, files })));
    assert.equal(candidateVisible.includes(calculator.input.expression), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sealed plan uses private permissions and fails tampering without leaking its contents", () => {
  const root = mkdtempSync(join(tmpdir(), "sealed-holdout-private-"));
  try {
    const { holdout, evaluator } = createPlan(join(root, "evaluator"), "a".repeat(64), seed);
    const planPath = join(evaluator.path, ".certified-holdout", "plan.json");
    const adapterPath = join(evaluator.path, ".certified-holdout", "adapter.js");
    assert.equal(lstatSync(evaluator.path).mode & 0o077, 0);
    assert.equal(lstatSync(join(evaluator.path, ".certified-holdout")).mode & 0o077, 0);
    assert.equal(lstatSync(planPath).mode & 0o077, 0);
    assert.equal(lstatSync(adapterPath).mode & 0o077, 0);
    recheckSealedHoldoutPlan(evaluator, holdout.plan.coreCandidateSha256, holdout.holdoutSha256);
    const secret = readFileSync(planPath, "utf8");
    writeFileSync(planPath, `${secret}\n`);
    assert.throws(
      () => recheckSealedHoldoutPlan(evaluator, holdout.plan.coreCandidateSha256, holdout.holdoutSha256),
      (error: unknown) => error instanceof Error && !error.message.includes(secret),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("final harness binding requires and rechecks the sealed evaluator plan", () => {
  const root = mkdtempSync(join(tmpdir(), "sealed-holdout-binding-"));
  try {
    const fixture = createFinalBindingFixture(root);
    const binding = bindCertifiedHarness(fixture.inputs);
    assert.doesNotThrow(() => recheckCertifiedHarness(binding, fixture.candidatePath, fixture.candidateSha256));
    const { holdoutSha256: _holdoutSha256, ...missing } = fixture.inputs;
    assert.throws(() => bindCertifiedHarness(missing as CertifiedHarnessInputs), /Missing sealed holdout hash/u);
    assert.throws(
      () => bindCertifiedHarness({ ...fixture.inputs, holdoutSha256: "0".repeat(64) }),
      /Missing sealed holdout hash/u,
    );
    assert.throws(
      () => bindCertifiedHarness({ ...fixture.inputs, holdoutSha256: "f".repeat(64) }),
      /Sealed holdout plan does not match the certified harness/u,
    );
    writeFileSync(join(fixture.evaluator.path, ".certified-holdout", "adapter.js"), "tampered\n");
    assert.throws(
      () => recheckCertifiedHarness(binding, fixture.candidatePath, fixture.candidateSha256),
      /Evaluator freeze fixtures changed/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createPlan(path: string, candidateSha256: string, injectedSeed: Buffer) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  const evaluator = {
    path,
    sha256: hashSnapshotDirectory(path),
    dispose: () => rmSync(path, { recursive: true, force: true }),
  };
  const holdout = createSealedHoldoutPlan(core(candidateSha256), evaluator, injectedSeed);
  return { holdout, evaluator };
}

function core(candidateSha256: string): CertifiedHarnessCoreBinding {
  return {
    node: { path: "/node", version: "1", sha256: "1".repeat(64) },
    pSnapshot: { path: "/candidate", version: "1", sha256: candidateSha256 },
    pi: { path: "/pi", version: "1", sha256: "2".repeat(64) },
    kilo: { path: "/kilo", version: "1", sha256: "3".repeat(64) },
    modelConfiguration: { sha256: "4".repeat(64) },
    projectInstructions: { path: "/AGENTS.md", sha256: "5".repeat(64) },
  };
}

function createFinalBindingFixture(root: string): {
  inputs: CertifiedHarnessInputs;
  candidatePath: string;
  candidateSha256: string;
  evaluator: { path: string; sha256: string };
} {
  const candidatePath = join(root, "candidate");
  const evaluatorPath = join(root, "evaluator");
  const instructionsPath = join(root, "AGENTS.md");
  const pi = writeVersionExecutable(root, "pi", "1.0.0");
  const kilo = writeVersionExecutable(root, "kilo", "2.0.0");
  mkdirSync(join(candidatePath, "packages", "coding-agent"), { recursive: true });
  mkdirSync(evaluatorPath, { mode: 0o700 });
  writeFileSync(join(candidatePath, "packages", "coding-agent", "package.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(instructionsPath, "# Rules\n");
  const candidateSha256 = hashRuntimeSnapshot(candidatePath, process.execPath);
  const modelInputs = writeCertifiedModelConfigurationFixture(root);
  const coreInputs = {
    nodeExecutable: process.execPath,
    pSnapshotPath: candidatePath,
    pSnapshotSha256: candidateSha256,
    pVersion: "1.0.0",
    piExecutable: pi,
    piVersion: "1.0.0",
    kiloExecutable: kilo,
    kiloVersion: "2.0.0",
    modelConfiguration: bindCertifiedModelConfiguration({
      ...modelInputs,
      model: "backend/model",
      kiloModel: "backend/model",
      expectedResolvedModel: "backend/model",
    }),
    projectInstructionsFile: instructionsPath,
  };
  const evaluator = { path: evaluatorPath, sha256: hashSnapshotDirectory(evaluatorPath), dispose: () => {} };
  const holdout = createSealedHoldoutPlan(bindCertifiedHarnessCore(coreInputs), evaluator, seed);
  return {
    inputs: { ...coreInputs, evaluatorPath, evaluatorSha256: evaluator.sha256, holdoutSha256: holdout.holdoutSha256 },
    candidatePath,
    candidateSha256,
    evaluator,
  };
}

function writeVersionExecutable(root: string, name: string, version: string): string {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\necho '${version}'\n`);
  chmodSync(path, 0o755);
  return path;
}
