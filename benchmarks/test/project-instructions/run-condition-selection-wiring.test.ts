import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ProjectInstructionCondition } from "../../src/project-instructions/run-core.ts";
import { renderPairedReport } from "../../src/project-instructions/run-report.ts";
import { runProjectInstructionsBenchmark } from "../../src/run-project-instructions.ts";

type BenchmarkInvocation = NonNullable<Parameters<typeof runProjectInstructionsBenchmark>[0]>;
type BenchmarkDocument = Parameters<typeof renderPairedReport>[0] & { schemaVersion?: number };

const releaseConditions = ["legacy", "compiled-evidence"] as const;
const auditConditions = ["legacy", "compiled-evidence", "compiled-audit"] as const;

async function captureConsoleLogs(action: () => Promise<void>): Promise<string[]> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  try {
    await action();
  } finally {
    console.log = originalLog;
  }
  return logs;
}

async function runWiringScenario(
  expectedConditions: readonly ProjectInstructionCondition[],
  extraArgs: string[] = [],
): Promise<{ document: BenchmarkDocument; logs: string[]; reports: string[] }> {
  const root = mkdtempSync(join(tmpdir(), "p-condition-wiring-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, `run-v5.0.1-rc.64-${expectedConditions.length === 2 ? "paired" : "audit"}`);
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  mkdirSync(join(root, "packages", "coding-agent", "dist"), { recursive: true });
  mkdirSync(runtimeSnapshot);
  mkdirSync(scratchRoot);
  mkdirSync(privateRoot);
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  let scheduledDocument: BenchmarkDocument | undefined;
  const reports: string[] = [];
  try {
    const logs = await captureConsoleLogs(() =>
      runProjectInstructionsBenchmark({
        argv: [
          "--model",
          "provider/model",
          "--runs",
          "3",
          "--task",
          "typescript-calculator",
          "--seed",
          "condition-wiring-seed",
          "--output",
          output,
          ...extraArgs,
        ],
        environment: { P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.64" },
        root,
        dependencies: {
          createResources: () => ({
            runtimeSnapshot,
            scratchRoot,
            privateSnapshots: { auth: { path: authPath }, models: { path: modelsPath } },
          }),
          createAuthOutputGuard: () => undefined,
          privateInputEvidence: () => ({}),
          hashRuntime: () => "a".repeat(64),
          registerCandidate: () => {},
          writeEvidence: (_target: string, document: BenchmarkDocument) => {
            reports.push(renderPairedReport(document));
          },
          certify: () => ({ certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } }),
          runSchedule: async ({ document }: { document: BenchmarkDocument }) => {
            scheduledDocument = structuredClone(document);
            document.completed = true;
            document.runStatus = "completed";
            document.gate = { passed: true };
            return document;
          },
          finalizeResources: () => {},
        } as unknown as NonNullable<BenchmarkInvocation["dependencies"]>,
      }),
    );
    assert.ok(scheduledDocument);
    assert.deepEqual(scheduledDocument.conditions, expectedConditions);
    assert.equal(scheduledDocument.schemaVersion, 3);
    assert.equal(scheduledDocument.schedule.length, 3);
    for (const block of scheduledDocument.schedule) {
      assert.deepEqual([...block.conditions].sort(), [...expectedConditions].sort());
    }
    assert.ok(reports.length > 0, "runner must publish report evidence");
    return { document: scheduledDocument, logs, reports };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("benchmark CLI defaults every block and report to the release pair", async () => {
  const { logs, reports } = await runWiringScenario(releaseConditions);
  assert.ok(logs.some((line) => line.startsWith("Paired benchmark output:")));
  assert.ok(reports.every((report) => report.startsWith("# Project-instruction paired benchmark")));
  assert.ok(reports.every((report) => !report.includes("compiled-audit")));
});

test("--include-audit wires the canary into every block and report", async () => {
  const { logs, reports } = await runWiringScenario(auditConditions, ["--include-audit"]);
  assert.ok(logs.some((line) => line.startsWith("Audit-canary benchmark output:")));
  assert.ok(reports.every((report) => report.startsWith("# Project-instruction audit-canary benchmark")));
  assert.ok(reports.every((report) => report.includes("compiled-audit")));
});

test("benchmark CLI help advertises the explicit audit opt-in", async () => {
  const logs = await captureConsoleLogs(() =>
    runProjectInstructionsBenchmark({
      argv: ["--help"],
      dependencies: {
        pathExists: () => assert.fail("help must return before filesystem setup"),
      } as unknown as NonNullable<BenchmarkInvocation["dependencies"]>,
    }),
  );
  assert.match(logs.join("\n"), /--include-audit\s+Add the experimental compiled\/audit canary/u);
});
