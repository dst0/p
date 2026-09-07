import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

import {
  attachBenchmarkCleanupError,
  type BenchmarkInterruptedError,
  benchmarkInterruptionFromSignal,
} from "./interruption.ts";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "./process-control.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export type SeedHelperChild = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "kill" | "once"> & {
  stdout: Readable;
  stderr: Readable;
};
type SeedHelperSpawner = (executable: string, args: string[], options: SpawnOptions) => SeedHelperChild;

export interface BenchmarkSeedHelperControl {
  spawn?: SeedHelperSpawner;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  killGraceMs?: number;
  failureKillGraceMs?: number;
  terminateProcessTree?: (child: SeedHelperChild, graceMs: number) => Promise<boolean>;
}

export interface BenchmarkSeedHelperResult {
  status: number | null;
  stdout: string;
}

export function runBenchmarkSeedHelper(
  helper: string,
  args: readonly string[],
  timeoutMs: number,
  control: BenchmarkSeedHelperControl = {},
): Promise<BenchmarkSeedHelperResult> {
  return new Promise((resolveResult, rejectResult) => {
    const spawnChild: SeedHelperSpawner =
      control.spawn ??
      ((executable, spawnArgs, options) => {
        const spawned = spawn(executable, spawnArgs, options);
        if (!spawned.stdout || !spawned.stderr) {
          throw new Error("project instruction seed helper requires piped output");
        }
        return spawned as SeedHelperChild;
      });
    const child = spawnChild(
      process.execPath,
      [helper, ...args],
      benchmarkProcessGroupOptions({
        env: control.env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const chunks: Buffer[] = [];
    const outputLimit = control.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let outputBytes = 0;
    let processError: unknown;
    let interruption: BenchmarkInterruptedError | undefined;
    let timedOut = false;
    let terminationPromise: Promise<boolean | { terminationError: unknown }> | undefined;
    let settled = false;
    const terminateTree = control.terminateProcessTree ?? terminateBenchmarkProcessTree;
    const terminate = (graceMs: number): void => {
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
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        processError ??= new Error(`project instruction seed helper output exceeded ${outputLimit} bytes`);
        terminate(control.failureKillGraceMs ?? 250);
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", (error: Error) => {
      processError ??= error;
    });
    child.once("close", async (status: number | null) => {
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
        if (!terminationError && !treeStopped)
          attachBenchmarkCleanupError(interruption, new Error("seed helper process tree did not terminate"));
        rejectResult(interruption);
        return;
      }
      if (processError !== undefined) {
        rejectResult(processError);
        return;
      }
      if (!treeStopped) {
        rejectResult(new Error("project instruction seed helper process tree did not terminate"));
        return;
      }
      if (timedOut) {
        const error: NodeJS.ErrnoException = new Error("project instruction seed helper timed out");
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
