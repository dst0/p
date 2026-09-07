import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { attachBenchmarkCleanupError, benchmarkInterruptionFromSignal } from "../harness/interruption.ts";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "../harness/process-control.ts";

type ChildIpcCapture = { accept(message: unknown): void; finish(): unknown };
type ChildControl = {
  terminateProcessTree?: (child: ChildProcess, graceMs: number) => Promise<boolean>;
  signal?: AbortSignal;
  killGraceMs?: number;
  spawn?: typeof spawn;
};
export type BenchmarkChildOutcome = {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: unknown;
  interruption?: Error;
  projectInstructionAuthority?: unknown;
};

export function runBenchmarkChild(
  executable: string,
  args: string[],
  options: SpawnOptions,
  ipcCapture?: ChildIpcCapture,
  control: ChildControl = {},
): Promise<BenchmarkChildOutcome> {
  return new Promise<BenchmarkChildOutcome>((resolveResult) => {
    let settled = false;
    let spawnError: Error | undefined;
    let interruption: Error | undefined;
    let terminationPromise: Promise<boolean | { error: unknown }> | undefined;
    const terminateTree = control.terminateProcessTree ?? terminateBenchmarkProcessTree;
    const settle = (result: BenchmarkChildOutcome) => {
      if (settled) return;
      settled = true;
      control.signal?.removeEventListener("abort", interrupt);
      resolveResult(result);
    };
    const child = (control.spawn ?? spawn)(executable, args, benchmarkProcessGroupOptions(options));
    const interrupt = () => {
      interruption ??= benchmarkInterruptionFromSignal(control.signal);
      terminationPromise ??= Promise.resolve()
        .then(() => terminateTree(child, control.killGraceMs ?? 5_000))
        .catch((error) => ({ error }));
    };
    if (ipcCapture) child.on("message", (message) => ipcCapture.accept(message));
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", async (status, signal) => {
      const termination = terminationPromise ? await terminationPromise : true;
      const terminationError = typeof termination === "object" ? termination.error : undefined;
      const treeStopped = typeof termination === "boolean" ? termination : false;
      if (interruption && terminationError) attachBenchmarkCleanupError(interruption, terminationError);
      else if (interruption && !treeStopped) {
        attachBenchmarkCleanupError(interruption, new Error("benchmark process tree did not terminate"));
      }
      settle({
        status,
        signal,
        error:
          spawnError ??
          terminationError ??
          (treeStopped || interruption ? undefined : new Error("benchmark process tree did not terminate")),
        interruption,
        projectInstructionAuthority: ipcCapture?.finish(),
      });
    });
    control.signal?.addEventListener("abort", interrupt, { once: true });
    if (control.signal?.aborted) interrupt();
  });
}
