import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commandForKiloModelResolution } from "../../src/workloads/agent-command.ts";
import {
  bindCertifiedHarness,
  counterbalanceAgentOrder,
  planRunCells,
  recheckCertifiedHarness,
} from "../../src/workloads/certification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";

test("option gating requires exactly p, pi, kilo, 4 tasks, >=3 runs, compiled instructions, and model evidence", () => {
  const valid = parseRunnerArgs([
    "--certified",
    "--model",
    "provider/test-model",
    "--expected-resolved-model",
    "resolved/test-model",
    "--runs",
    "3",
    "--max-duration-ratio",
    "1.2",
    "--max-token-ratio",
    "1.1",
    "--max-cost-ratio",
    "1.05",
  ]);
  assert.equal(valid.certified, true);
  assert.deepEqual(valid.agents, ["p", "pi", "kilo"]);
  assert.equal(valid.runs, 3);
  assert.equal(valid.model, "provider/test-model");
  assert.equal(valid.expectedResolvedModel, "resolved/test-model");
  assert.equal(valid.kiloModel, "provider/test-model");
  assert.equal(valid.projectInstructions, "compiled");
  assert.equal(valid.maxDurationRatio, 1.2);
  assert.equal(valid.maxTokenRatio, 1.1);
  assert.equal(valid.maxCostRatio, 1.05);

  const checkThrows = (args: string[], re: RegExp) => assert.throws(() => parseRunnerArgs(args), re);
  checkThrows(
    ["--certified", "--agents", "p,pi", "--model", "m", "--expected-resolved-model", "m", "--runs", "3"],
    /Certified mode requires exactly agents p, pi, and kilo/u,
  );
  checkThrows(
    ["--certified", "--agents", "p,pi,kilo,codex", "--model", "m", "--expected-resolved-model", "m", "--runs", "3"],
    /Certified mode requires exactly agents p, pi, and kilo/u,
  );
  checkThrows(
    ["--certified", "--model", "m", "--expected-resolved-model", "m", "--runs", "2"],
    /Certified mode requires at least 3 runs/u,
  );
  checkThrows(
    ["--certified", "--model", "m", "--expected-resolved-model", "m", "--runs", "3", "--task", "typescript-calculator"],
    /Certified mode requires all 4 canonical benchmark tasks/u,
  );
  checkThrows(
    ["--certified", "--model", "m", "--runs", "3"],
    /--expected-resolved-model is required in certified mode/u,
  );
  checkThrows(
    ["--certified", "--model", "m", "--expected-resolved-model", "res", "--runs", "3", "--thinking", "high"],
    /thinking.*certified|certified.*thinking/iu,
  );
  checkThrows(
    [
      "--certified",
      "--model",
      "m",
      "--expected-resolved-model",
      "res",
      "--runs",
      "3",
      "--project-instructions",
      "legacy",
    ],
    /Certified mode requires compiled project instructions/u,
  );
  checkThrows(
    ["--certified", "--agents", "p,p,pi,kilo", "--model", "m", "--expected-resolved-model", "res", "--runs", "3"],
    /Certified mode requires exactly agents p, pi, and kilo/u,
  );
  checkThrows(
    ["--certified", "--agents", "p,pi,pi,kilo", "--model", "m", "--expected-resolved-model", "res", "--runs", "3"],
    /Certified mode requires exactly agents p, pi, and kilo/u,
  );
  checkThrows(["--runs", "3junk", "--model", "m"], /--runs must be a positive integer/u);
  checkThrows(["--max-cost-ratio", "1junk", "--model", "m"], /--max-cost-ratio must be a positive number/u);
  checkThrows(["--timeout-seconds", "300junk", "--model", "m"], /--timeout-seconds must be a positive integer/u);
  checkThrows(["--max-duration-ratio", "1.5junk", "--model", "m"], /--max-duration-ratio must be a positive number/u);
});

test("schedule balance deterministically counterbalances agent execution order across cells", () => {
  const agents = ["p", "pi", "kilo"] as const;
  const tasks = benchmarkTasks;
  const positions: Record<string, { first: number; second: number; third: number }> = {
    p: { first: 0, second: 0, third: 0 },
    pi: { first: 0, second: 0, third: 0 },
    kilo: { first: 0, second: 0, third: 0 },
  };

  for (let run = 1; run <= 3; run += 1) {
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
      const order = counterbalanceAgentOrder(agents, run, taskIndex);
      assert.equal(order.length, 3);
      assert.equal(new Set(order).size, 3);
      positions[order[0]].first += 1;
      positions[order[1]].second += 1;
      positions[order[2]].third += 1;
    }
  }

  for (const agent of agents) {
    assert.equal(positions[agent].first, 4, `${agent} first position count`);
    assert.equal(positions[agent].second, 4, `${agent} second position count`);
    assert.equal(positions[agent].third, 4, `${agent} third position count`);
  }

  const planned = planRunCells(agents, tasks, 1, true);
  assert.equal(planned.length, 12);
});

test("executable and harness bindings fail closed on missing executables or placeholders", () => {
  const root = mkdtempSync(join(tmpdir(), "binding-gating-"));
  try {
    const agentsFile = join(root, "AGENTS.md");
    writeFileSync(agentsFile, "# Neutral Project Instructions\n");
    const pSnapshot = join(root, "p-snapshot");
    mkdirSync(pSnapshot);
    writeFileSync(join(pSnapshot, "package.json"), JSON.stringify({ version: "0.1.0" }));

    assert.throws(
      () =>
        bindCertifiedHarness({
          nodeExecutable: join(root, "nonexistent-node"),
          pSnapshotPath: pSnapshot,
          pSnapshotSha256: "a".repeat(64),
          pVersion: "0.1.0",
          piExecutable: join(root, "faux-pi"),
          kiloExecutable: join(root, "faux-kilo"),
          projectInstructionsFile: agentsFile,
        }),
      /Missing Node executable/u,
    );

    assert.throws(
      () =>
        bindCertifiedHarness({
          nodeExecutable: process.execPath,
          pSnapshotPath: pSnapshot,
          pSnapshotSha256: "0".repeat(64),
          pVersion: "0.1.0",
          piExecutable: join(root, "faux-pi"),
          kiloExecutable: join(root, "faux-kilo"),
          projectInstructionsFile: agentsFile,
        }),
      /Candidate P snapshot identity must not be zero or placeholder/u,
    );

    assert.throws(
      () =>
        bindCertifiedHarness({
          nodeExecutable: process.execPath,
          pSnapshotPath: pSnapshot,
          pSnapshotSha256: "a".repeat(64),
          pVersion: "0.1.0",
          piExecutable: join(root, "nonexistent-pi"),
          kiloExecutable: join(root, "faux-kilo"),
          projectInstructionsFile: agentsFile,
        }),
      /Missing pi executable/u,
    );

    const fauxPi = join(root, "faux-pi");
    writeFileSync(fauxPi, "#!/bin/sh\necho '1.0.0'\n");
    chmodSync(fauxPi, 0o755);
    const fauxKilo = join(root, "faux-kilo");
    writeFileSync(fauxKilo, "#!/bin/sh\necho '2.0.0'\n");
    chmodSync(fauxKilo, 0o755);

    assert.throws(
      () =>
        bindCertifiedHarness({
          nodeExecutable: process.execPath,
          pSnapshotPath: pSnapshot,
          pSnapshotSha256: "a".repeat(64),
          pVersion: "0.1.0",
          piExecutable: fauxPi,
          piVersion: "0.82.1",
          kiloExecutable: fauxKilo,
          kiloVersion: "2.0.0",
          projectInstructionsFile: agentsFile,
        }),
      /pi/iu,
    );

    assert.throws(
      () =>
        bindCertifiedHarness({
          nodeExecutable: process.execPath,
          pSnapshotPath: pSnapshot,
          pSnapshotSha256: "a".repeat(64),
          pVersion: "0.1.0",
          piExecutable: fauxPi,
          piVersion: "1.0.0",
          kiloExecutable: fauxKilo,
          kiloVersion: "7.4.17",
          projectInstructionsFile: agentsFile,
        }),
      /kilo/iu,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commandForKiloModelResolution honors options.kiloExecutable", () => {
  const options = parseRunnerArgs([
    "--model",
    "provider/model",
    "--kilo-model",
    "test-provider/test-model",
    "--kilo-executable",
    "/custom/bin/kilo",
  ]);
  const cmd = commandForKiloModelResolution(options, "/tmp/config", "/tmp/workspace");
  assert.equal(cmd.executable, "/custom/bin/kilo");
});

test("instruction and executable recheck verifies exact artifacts and detects tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "instruction-parity-"));
  try {
    const agentsFile = join(root, "AGENTS.md");
    writeFileSync(agentsFile, "# Neutral Project Instructions\n");
    const pSnapshot = join(root, "p-snapshot");
    mkdirSync(pSnapshot);
    writeFileSync(join(pSnapshot, "dummy.txt"), "dummy\n");
    writeFileSync(join(pSnapshot, "package.json"), JSON.stringify({ version: "0.82.1" }));
    const fauxPi = join(root, "pi");
    writeFileSync(fauxPi, "#!/bin/sh\necho '0.82.1'\n");
    chmodSync(fauxPi, 0o755);
    const fauxKilo = join(root, "kilo");
    writeFileSync(fauxKilo, "#!/bin/sh\necho '7.4.17'\n");
    chmodSync(fauxKilo, 0o755);

    const snapshotSha = createHash("sha256")
      .update("dummy.txt\0")
      .update(readFileSync(join(pSnapshot, "dummy.txt")))
      .update("\0")
      .update("package.json\0")
      .update(readFileSync(join(pSnapshot, "package.json")))
      .update("\0")
      .update("node\0")
      .update(readFileSync(process.execPath))
      .digest("hex");

    const binding = bindCertifiedHarness({
      nodeExecutable: process.execPath,
      pSnapshotPath: pSnapshot,
      pSnapshotSha256: snapshotSha,
      pVersion: "0.82.1",
      piExecutable: fauxPi,
      piVersion: "0.82.1",
      kiloExecutable: fauxKilo,
      kiloVersion: "7.4.17",
      projectInstructionsFile: agentsFile,
    });

    assert.doesNotThrow(() => recheckCertifiedHarness(binding, pSnapshot, snapshotSha));

    const foreignSnapshot = join(root, "foreign-p-snapshot");
    mkdirSync(foreignSnapshot);
    assert.throws(
      () => recheckCertifiedHarness(binding, foreignSnapshot, snapshotSha),
      /P snapshot identity does not match executed P runtime path/u,
    );

    writeFileSync(agentsFile, "# Tampered Instructions\n");
    assert.throws(
      () => recheckCertifiedHarness(binding, pSnapshot, snapshotSha),
      /Project instructions content changed before certification publishing/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
