import { spawn } from "node:child_process";

import { attachBenchmarkCleanupError, benchmarkInterruptionFromSignal } from "./benchmark-interruption.js";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "./benchmark-process-control.js";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export function runBenchmarkSeedHelper(helper, args, timeoutMs, control = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = (control.spawn ?? spawn)(
      process.execPath,
      [helper, ...args],
      benchmarkProcessGroupOptions({
        env: control.env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const chunks = [];
    const outputLimit = control.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let outputBytes = 0;
    let processError;
    let interruption;
    let timedOut = false;
    let terminationPromise;
    let settled = false;
    const terminateTree = control.terminateProcessTree ?? terminateBenchmarkProcessTree;
    const terminate = (graceMs) => {
      terminationPromise ??= Promise.resolve()
        .then(() => terminateTree(child, graceMs))
        .catch((terminationError) => ({ terminationError }));
    };
    const interrupt = () => {
      interruption ??= benchmarkInterruptionFromSignal(control.signal);
      terminate(control.killGraceMs ?? 5_000);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(control.failureKillGraceMs ?? 250);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        processError ??= new Error(`project instruction seed helper output exceeded ${outputLimit} bytes`);
        terminate(control.failureKillGraceMs ?? 250);
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", (error) => {
      processError ??= error;
    });
    child.once("close", async (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const termination = terminationPromise ? await terminationPromise : true;
      const terminationError = typeof termination === "object" ? termination.terminationError : undefined;
      const treeStopped = typeof termination === "boolean" ? termination : false;
      control.signal?.removeEventListener("abort", interrupt);
      if (terminationError) {
        if (interruption) attachBenchmarkCleanupError(interruption, terminationError);
        else processError ??= terminationError;
      }
      if (interruption) {
        if (!terminationError && !treeStopped) attachBenchmarkCleanupError(interruption, new Error("seed helper process tree did not terminate"));
        rejectResult(interruption);
        return;
      }
      if (processError) {
        rejectResult(processError);
        return;
      }
      if (!treeStopped) {
        rejectResult(new Error("project instruction seed helper process tree did not terminate"));
        return;
      }
      if (timedOut) {
        const error = new Error("project instruction seed helper timed out");
        error.code = "ETIMEDOUT";
        rejectResult(error);
        return;
      }
      resolveResult({ status, stdout: Buffer.concat(chunks).toString("utf8") });
    });
    control.signal?.addEventListener("abort", interrupt, { once: true });
    if (control.signal?.aborted) interrupt();
  });
}
