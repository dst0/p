import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBenchmarkEvaluationSnapshot } from "../../src/harness/evaluation-freeze.ts";
import { hashRuntimeSnapshot } from "../../src/harness/runtime-snapshot.ts";
import {
  bindCertifiedModelConfiguration,
  hashFile,
  recheckCertifiedHarness,
} from "../../src/workloads/certification.ts";
import { inventoryTask } from "../../src/workloads/inventory.ts";
import { writeCertifiedModelConfigurationFixture } from "./certification-model-config-fixture.ts";

test("certified evaluation consumes frozen fixtures and fails closed on tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "evaluator-freeze-test-"));
  try {
    const liveFixtures = join(root, "benchmarks", "fixtures", "inventory");
    mkdirSync(liveFixtures, { recursive: true });
    writeFileSync(join(liveFixtures, "rubric.json"), JSON.stringify([{ id: "c1", name: "Check 1", weight: 5 }]));
    writeFileSync(join(liveFixtures, "hidden.test.ts"), "// live hidden test\n");

    const snapshot = createBenchmarkEvaluationSnapshot(root, root);
    const frozenFixturesRoot = join(snapshot.path, "benchmarks", "fixtures");

    // Live fixture mutation must not affect evaluation using frozen context
    writeFileSync(join(liveFixtures, "rubric.json"), JSON.stringify([{ id: "c1", name: "Check 1", weight: 999 }]));

    const workspace = join(root, "workspace");
    mkdirSync(join(workspace, "test"), { recursive: true });
    const baseline = { ...inventoryTask.files };

    const context = {
      evaluatorFixturesRoot: frozenFixturesRoot,
      evaluator: { path: snapshot.path, sha256: snapshot.sha256 },
    };

    // Tampering with frozen directory causes failure
    writeFileSync(join(frozenFixturesRoot, "inventory", "rubric.json"), "tampered");
    assert.throws(
      () => inventoryTask.verify(workspace, baseline, "", context),
      /Evaluator freeze fixtures tampered|changed/u,
    );

    // Harness recheck also fails closed on tampered evaluator
    const fauxNode = process.execPath;
    const fauxP = join(root, "p-runtime");
    mkdirSync(join(fauxP, "packages", "coding-agent"), { recursive: true });
    writeFileSync(join(fauxP, "packages", "coding-agent", "package.json"), JSON.stringify({ version: "0.4.2" }));
    const pSha = hashRuntimeSnapshot(fauxP, fauxNode);

    const fauxPi = join(root, "pi");
    writeFileSync(fauxPi, "#!/bin/sh\necho '0.82.1'\n");
    const fauxKilo = join(root, "kilo");
    writeFileSync(fauxKilo, "#!/bin/sh\necho '7.4.17'\n");
    const agentsFile = join(root, "AGENTS.md");
    writeFileSync(agentsFile, "# Rules\n");
    const modelInputs = writeCertifiedModelConfigurationFixture(root);
    const modelConfiguration = bindCertifiedModelConfiguration({
      ...modelInputs,
      model: "backend/model",
      kiloModel: "backend/model",
      expectedResolvedModel: "backend/model",
    });

    assert.throws(
      () =>
        recheckCertifiedHarness(
          {
            node: { path: fauxNode, version: process.version, sha256: hashFile(fauxNode) },
            pSnapshot: { path: fauxP, version: "0.4.2", sha256: pSha },
            pi: { path: fauxPi, version: "0.82.1", sha256: hashFile(fauxPi) },
            kilo: { path: fauxKilo, version: "7.4.17", sha256: hashFile(fauxKilo) },
            modelConfiguration,
            projectInstructions: { path: agentsFile, sha256: hashFile(agentsFile) },
            evaluator: { path: snapshot.path, sha256: snapshot.sha256 },
            holdoutSha256: "b".repeat(64),
          },
          fauxP,
          pSha,
        ),
      /Evaluator freeze fixtures changed/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
