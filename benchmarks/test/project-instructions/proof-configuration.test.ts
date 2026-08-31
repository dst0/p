import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configureProjectInstructionProbe } from "../../src/project-instructions/evidence.ts";
import { buildBenchmarkArgs } from "../../src/project-instructions/run-core.ts";

test("paired child arguments and probe environment carry only the receipt SHA", () => {
  const root = mkdtempSync(join(tmpdir(), "p-proof-ipc-config-"));
  try {
    const sourceFile = join(root, "source.md");
    writeFileSync(sourceFile, "# Rules\n");
    const receipt = { sha256: "7".repeat(64) };
    const args = buildBenchmarkArgs(
      {
        model: "provider/model",
        modelsFile: "/runtime/models.json",
        tasks: ["inventory"],
        runs: 1,
        maxRuntimeSeconds: 456,
        help: false,
        compilerModel: "compiler-provider/compiler-model",
        pCli: "/runtime/p.js",
        projectInstructionProbe: "/runtime/probe.js",
        projectInstructionsFile: sourceFile,
        timeoutSeconds: 123,
        thinking: "off",
      },
      { task: "inventory" },
      "compiled-evidence",
      "/output",
      456,
      receipt,
    );
    assert.deepEqual(args.slice(10, 12), ["--project-instruction-proof-receipt", receipt.sha256]);
    assert.deepEqual(args.slice(-2), ["--thinking", "off"]);
    const env: NodeJS.ProcessEnv = {};
    configureProjectInstructionProbe(
      args,
      env,
      {
        projectInstructions: "compiled",
        taskVerificationMode: "evidence",
        projectInstructionProbe: "/runtime/probe.js",
        projectInstructionsFile: sourceFile,
      },
      root,
      receipt.sha256,
    );
    assert.equal(env.P_BENCHMARK_PROJECT_INSTRUCTION_RECEIPT, receipt.sha256);
    assert.equal(env.P_BENCHMARK_PROJECT_INSTRUCTION_TASK_VERIFICATION_MODE, "evidence");
    assert.equal(Object.hasOwn(env, "P_BENCHMARK_PROJECT_INSTRUCTION_PROOF"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
