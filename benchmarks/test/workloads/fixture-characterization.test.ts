import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { durableWorkflowTask, workflowHiddenRubric } from "../../src/workloads/durable-workflow.ts";
import { fixtureDirectory, listFixtureFiles } from "../../src/workloads/fixture-files.ts";
import { inventoryHiddenRubric, inventoryTask } from "../../src/workloads/inventory.ts";
import { createTaskResult } from "../../src/workloads/task-definition.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";

const legacyFixtureHashes: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "typescript-calculator": {
    "package.json": "eaaf8571956682e9b260dc707bb9a3180e5a99bc74cc22980e4561be4d537234",
    "requirements.md": "512587335c6275517fafa59bc7b7087ffdae3f7b0186c48f5957b84f9734338f",
    "test/calculator.contract.test.ts": "b23f4e751b7764cf55eb5071703b36e58a2a0c174731a9ddb4e1a628e3410cb3",
    "tsconfig.json": "de4ed5b48b49759f3847353933898346fe1d3452bb2b9b8d20dc83bf51052918",
  },
  "monolith-split": {
    "README.md": "ef4db446f316340ca9ab03adc1d47521cdbfd1daa51a21bf16ea6a961b8e004b",
    "package.json": "eaaf8571956682e9b260dc707bb9a3180e5a99bc74cc22980e4561be4d537234",
    "src/monolith.ts": "0ad7be9fe7930b5c0e9e5c1e35c1a3acf97e16ee112b6ba450d67700ccc1d153",
    "test/monolith.contract.test.ts": "f77dc706bfd5f5cbcbc96492ad853209c69e29ca88f597dae18d3ebccdf34737",
    "tsconfig.json": "de4ed5b48b49759f3847353933898346fe1d3452bb2b9b8d20dc83bf51052918",
  },
  "event-sourced-inventory": {
    "README.md": "5203747d6a3911150f50214b9f46bacde073dedc58c9a9f0a08147418e0759ab",
    "hidden.test.ts": "51230b25174b1ea65aeb4a2a1ea1caa54b13b9a166b76d0735e2547373b316b0",
    "package.json": "eaaf8571956682e9b260dc707bb9a3180e5a99bc74cc22980e4561be4d537234",
    "test/inventory.contract.test.ts": "a3d005ff24e66014bb25cd7187884b42a71e33be695d8246976af6c1d04332b5",
    "tsconfig.json": "de4ed5b48b49759f3847353933898346fe1d3452bb2b9b8d20dc83bf51052918",
  },
};

const taskMetadata = [
  ["typescript-calculator", 900, 6, "92332651bfe453cf89865312ac6d1d399f794dc50e4047cb6d111b3cd0aef774"],
  ["monolith-split", 1200, 6, "316d6696ebb63464322753fb59679e6954af2c867344899d54fcfb62c8348836"],
  ["event-sourced-inventory", 2400, 100, "0c1ea5bad2a44c7192b143db90dd8d63f341b120b254a69fa671e3d3f2322a2b"],
  ["durable-workflow-saga", 3600, 158, "67ef6e4a70cee55fad198c9a28436fe8c025651d9a7e224fa3b7557adf4d4306"],
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

test("extracted fixture bytes match the legacy embedded payloads", () => {
  for (const [taskId, expectedHashes] of Object.entries(legacyFixtureHashes)) {
    const actualFiles = listFixtureFiles(fixtureDirectory(taskId)).filter((path) => path !== "rubric.json");
    assert.deepEqual(actualFiles, Object.keys(expectedHashes).sort(), taskId);
    for (const [path, expectedHash] of Object.entries(expectedHashes)) {
      assert.equal(sha256(readFileSync(join(fixtureDirectory(taskId), path))), expectedHash, `${taskId}/${path}`);
    }
  }
});

test("task order, IDs, timeouts, and prompts remain stable", () => {
  assert.deepEqual(
    benchmarkTasks.map((task) => [task.id, task.timeoutSeconds, task.maxScore, sha256(task.prompt)]),
    taskMetadata,
  );
});

test("hidden verification assets are never materialized in agent-visible files", () => {
  assert.equal("hidden.test.ts" in inventoryTask.files, false);
  assert.equal("rubric.json" in inventoryTask.files, false);
  assert.equal("hidden.test.ts" in durableWorkflowTask.files, false);
  assert.equal("rubric.json" in durableWorkflowTask.files, false);
  assert.deepEqual(Object.keys(inventoryTask.files).sort(), [
    "README.md",
    "package.json",
    "test/inventory.contract.test.ts",
    "tsconfig.json",
  ]);
  assert.deepEqual(Object.keys(durableWorkflowTask.files).sort(), [
    "README.md",
    "package.json",
    "test/workflow.contract.test.ts",
    "tsconfig.json",
  ]);
  assert.equal(
    sha256(durableWorkflowTask.files["package.json"] ?? ""),
    "eaaf8571956682e9b260dc707bb9a3180e5a99bc74cc22980e4561be4d537234",
  );
  assert.equal(
    sha256(durableWorkflowTask.files["tsconfig.json"] ?? ""),
    "de4ed5b48b49759f3847353933898346fe1d3452bb2b9b8d20dc83bf51052918",
  );
});

test("weighted scoring and exact hidden rubrics remain stable", () => {
  const result = createTaskResult(false, [
    { name: "default", passed: true },
    { name: "weighted", passed: false, weight: 4 },
  ]);
  assert.deepEqual({ score: result.score, maxScore: result.maxScore }, { score: 1, maxScore: 5 });
  assert.throws(
    () => createTaskResult(true, [{ name: "changed", passed: true, weight: 2 }], 3),
    /Benchmark scoring changed/u,
  );
  assert.equal(
    inventoryHiddenRubric.reduce((total, criterion) => total + criterion.weight, 23),
    100,
  );
  assert.equal(
    sha256(JSON.stringify(inventoryHiddenRubric)),
    "7c880c0977c76b7c839992bde007ddafcc189595415f9bf70bad2af11c6e25ce",
  );
  assert.equal(
    workflowHiddenRubric.reduce((total, criterion) => total + criterion.weight, 32),
    158,
  );
  assert.equal(
    sha256(JSON.stringify(workflowHiddenRubric)),
    "2a15b8a16fe4640b33b2d6bbcfbe9e85ed47e2b9c3f3530c1199402f5da646d8",
  );
});
