import { spawn } from "node:child_process";
import { attachBenchmarkCleanupError, benchmarkInterruptionFromSignal } from "./benchmark-interruption.js";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "./benchmark-process-control.js";

export function runBenchmarkChild(executable, args, options, ipcCapture, control = {}) {
  return new Promise((resolveResult) => {
    let settled = false;
    let spawnError;
    let interruption;
    let terminationPromise;
    const terminateTree = control.terminateProcessTree ?? terminateBenchmarkProcessTree;
    const settle = (result) => {
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
