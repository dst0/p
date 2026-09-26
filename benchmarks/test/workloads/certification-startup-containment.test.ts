import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { benchmarkSandboxExecutable } from "../../src/harness/benchmark-isolation.ts";
import { BenchmarkProcessTerminationUnconfirmedError } from "../../src/harness/process-termination-error.ts";
import { isBenchmarkMutableArtifactsUnsafeError } from "../../src/workloads/benchmark-run-finalization.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { runKiloStartupProbe } from "../../src/workloads/startup-probes.ts";

test(
  "certified Kilo startup probes execute inside candidate containment",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "certified-startup-containment-"));
    try {
      const runtime = join(root, "candidate-runtime");
      const config = join(root, "config");
      const output = join(root, "output");
      const outside = join(root, "outside-secret.txt");
      mkdirSync(runtime);
      mkdirSync(config);
      mkdirSync(output);
      writeFileSync(outside, "SECRET");
      const kilo = join(runtime, "kilo.js");
      writeFileSync(kilo, mockKiloSource(outside));
      chmodSync(kilo, 0o755);
      const options = parseRunnerArgs([
        "--certified",
        "--model",
        "surface/model",
        "--kilo-model",
        "surface/model",
        "--expected-resolved-model",
        "backend/model",
        "--runs",
        "3",
        "--kilo-executable",
        kilo,
        "--kilo-version",
        "1.0.0",
      ]);
      options.candidateRuntimePath = runtime;

      const evidence = await runKiloStartupProbe(options, config, output, performance.now() + 30_000);

      assert.equal(evidence.status, "passed");
      assert.equal(
        readFileSync(join(config, "startup-probe-workspace", "containment.txt"), "utf8"),
        "DENIED\nDENIED\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "a rejected Kilo startup command propagates unsafe state before runtime evidence traversal",
  { skip: !benchmarkSandboxExecutable() },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "unsafe-certified-startup-"));
    try {
      const runtime = join(root, "candidate-runtime");
      const config = join(root, "config");
      const output = join(root, "output");
      const outside = join(root, "outside");
      mkdirSync(runtime);
      mkdirSync(config);
      mkdirSync(output);
      mkdirSync(join(outside, "kilo", "log"), { recursive: true });
      writeFileSync(join(outside, "kilo", "log", "secret.log"), "outside");
      const kilo = join(runtime, "kilo.js");
      writeFileSync(kilo, "#!/usr/bin/env node\n");
      chmodSync(kilo, 0o755);
      const options = parseRunnerArgs([
        "--certified",
        "--model",
        "surface/model",
        "--expected-resolved-model",
        "backend/model",
        "--runs",
        "3",
        "--kilo-executable",
        kilo,
      ]);
      options.candidateRuntimePath = runtime;

      await assert.rejects(
        runKiloStartupProbe(options, config, output, performance.now() + 30_000, async () => {
          symlinkSync(outside, join(config, "data"), "dir");
          throw new BenchmarkProcessTerminationUnconfirmedError("benchmark process tree did not terminate");
        }),
        isBenchmarkMutableArtifactsUnsafeError,
      );
      assert.equal(existsSync(join(output, "diagnostics", "kilo-startup", "runtime-logs", "secret.log")), false);
      assert.equal(readFileSync(join(outside, "kilo", "log", "secret.log"), "utf8"), "outside");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

function mockKiloSource(outside: string): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
let workspace = process.cwd();
const dirIndex = args.indexOf("--dir");
if (dirIndex !== -1) workspace = args[dirIndex + 1];
let containment = "LEAKED";
try { fs.readFileSync(${JSON.stringify(outside)}, "utf8"); } catch { containment = "DENIED"; }
fs.appendFileSync(path.join(workspace, "containment.txt"), containment + "\\n");
if (args[0] === "models") {
  process.stdout.write("surface/model\\n{\\n  \\"api\\": { \\"id\\": \\"backend/model\\" }\\n}\\n");
} else {
  process.stdout.write(JSON.stringify({ type: "step_finish", part: { type: "step-finish", model: "backend/model", tokens: { input: 1, output: 1, total: 2 } } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: "benchmark-startup-ok" } }) + "\\n");
}
`;
}
