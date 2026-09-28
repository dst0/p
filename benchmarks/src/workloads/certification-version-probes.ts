import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxedBenchmarkCommand } from "../harness/benchmark-isolation.ts";
import { certifiedCandidateEnvironment } from "../harness/certified-candidate-environment.ts";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "../harness/process-control.ts";
import { assertCandidateExecutableSafety } from "./candidate-executable-safety.ts";
import { type CertifiedHarnessBinding, hashFile } from "./certification-binding.ts";
import type { RunnerOptions } from "./runner-options.ts";

async function runBoundedVersionCommand(
  command: { executable: string; args: string[] },
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const child = spawn(
    command.executable,
    command.args,
    benchmarkProcessGroupOptions({
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"],
    }),
  );
  const chunks: Buffer[] = [];
  let bytes = 0;
  let error: Error | undefined;
  let timedOut = false;
  let termination: Promise<boolean> | undefined;
  const terminate = () => {
    termination ??= terminateBenchmarkProcessTree(child, 250).catch(() => false);
    return termination;
  };
  const closed = new Promise<number | null>((resolve) => {
    child.once("error", (spawnError) => {
      error = spawnError;
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) {
        error ??= new Error("Certified version output exceeded 64 KiB");
        void terminate();
      } else {
        chunks.push(chunk);
      }
    });
    child.once("close", (status) => resolve(status));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void terminate();
  }, 10_000);
  const status = await closed;
  clearTimeout(timer);
  if (!(await terminate())) throw new Error("Certified version probe process tree did not terminate");
  if (error || timedOut || status !== 0) {
    throw new Error(`Certified version probe failed or timed out (exit=${status ?? "none"}, timeout=${timedOut})`);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function verifyCertifiedCandidateVersions(
  options: RunnerOptions,
  binding: CertifiedHarnessBinding,
): Promise<void> {
  if (!options.certified || !options.candidateRuntimePath) {
    throw new Error("Certified candidate version probes require a frozen runtime and sandbox");
  }
  for (const agent of ["pi", "kilo"] as const) {
    const executable = binding[agent];
    assertCandidateExecutableSafety(executable.path);
    if (hashFile(executable.path) !== executable.sha256) {
      throw new Error(`Frozen ${agent} executable changed before certified version probe`);
    }
    const scratch = mkdtempSync(join(tmpdir(), `p-certified-${agent}-version-`));
    try {
      const probeWorkspace = join(scratch, "workspace");
      const configDir = join(scratch, "home");
      mkdirSync(probeWorkspace, { mode: 0o700 });
      mkdirSync(configDir, { mode: 0o700 });
      const probeEnv: NodeJS.ProcessEnv = {
        ...certifiedCandidateEnvironment(configDir, options.candidateRuntimePath),
        P_SKIP_VERSION_CHECK: "1",
        PI_SKIP_VERSION_CHECK: "1",
        NO_COLOR: "1",
      };

      const command = createSandboxedBenchmarkCommand(
        {
          workspace: probeWorkspace,
          runtime: options.candidateRuntimePath,
          configDir,
          networkHosts: [],
          allowProcessFork: false,
        },
        executable.path,
        ["--version"],
      );
      const version = await runBoundedVersionCommand(command, probeWorkspace, probeEnv);
      if (version !== executable.version) {
        throw new Error(`Frozen ${agent} executable failed sandboxed version verification`);
      }
      if (hashFile(executable.path) !== executable.sha256) {
        throw new Error(`Frozen ${agent} executable changed during certified version probe`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
