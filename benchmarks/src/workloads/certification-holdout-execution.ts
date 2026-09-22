import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { join } from "node:path";
import { createSandboxedBenchmarkCommand } from "../harness/benchmark-isolation.ts";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "../harness/process-control.ts";
import {
  BenchmarkProcessTerminationUnconfirmedError,
  isBenchmarkProcessTerminationUnconfirmedError,
} from "../harness/process-termination-error.ts";
import { readSealedHoldoutAdapter, type SealedHoldoutTaskPlan } from "./certification-holdout-plan.ts";

const timeoutMs = 5_000;
const maxOutputBytes = 16_384;
const maxErrorBytes = 4_096;

export interface SealedHoldoutExecutionControl {
  terminateProcessTree?: typeof terminateBenchmarkProcessTree;
  timeoutMs?: number;
}

export async function evaluateSealedHoldoutTask(
  evaluatorPath: string,
  workspace: string,
  taskPlan: SealedHoldoutTaskPlan,
  control: SealedHoldoutExecutionControl = {},
): Promise<boolean> {
  try {
    const value = await invokeSealedHoldoutAdapter(evaluatorPath, workspace, taskPlan, control);
    return canonicalSerialize(value) === canonicalSerialize(taskPlan.expected);
  } catch (error) {
    if (isBenchmarkProcessTerminationUnconfirmedError(error)) throw error;
    return false;
  }
}

export async function invokeSealedHoldoutAdapter(
  evaluatorPath: string,
  workspace: string,
  taskPlan: SealedHoldoutTaskPlan,
  control: SealedHoldoutExecutionControl = {},
): Promise<unknown> {
  const source = readSealedHoldoutAdapter(evaluatorPath);
  const target = join(workspace, targetModule(taskPlan));
  const sandboxed = createSandboxedBenchmarkCommand(
    { workspace, runtime: workspace, workspaceWritable: false, processFork: false },
    process.execPath,
    ["--input-type=module", "--eval", source, target, taskPlan.domain],
  );
  const child = spawn(sandboxed.executable, sandboxed.args, {
    cwd: workspace,
    detached: benchmarkProcessGroupOptions({}).detached,
    env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(`${JSON.stringify(taskPlan.input)}\n`);
  const output = await collectAdapterOutput(child, control);
  return parseAdapterOutput(output);
}

function targetModule(taskPlan: SealedHoldoutTaskPlan): string {
  if (taskPlan.domain === "calculator") return "src/calculator.ts";
  if (taskPlan.domain === "monolith") return "src/monolith.ts";
  return "src/index.ts";
}

async function collectAdapterOutput(
  child: ChildProcessWithoutNullStreams,
  control: SealedHoldoutExecutionControl,
): Promise<string> {
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let termination: Promise<boolean> | undefined;
  let failure: Error | undefined;
  let signalFailure: (() => void) | undefined;
  const failureSignaled = new Promise<void>((resolve) => {
    signalFailure = resolve;
  });
  const stop = (message: string): void => {
    if (termination) return;
    failure = new Error(message);
    termination = (control.terminateProcessTree ?? terminateBenchmarkProcessTree)(child, 200);
    signalFailure?.();
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > maxOutputBytes) {
      stop("Sealed holdout adapter output exceeded its bound");
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > maxErrorBytes) {
      stop("Sealed holdout adapter output exceeded its bound");
    }
  });
  const timer = setTimeout(() => {
    stop("Sealed holdout adapter timed out");
  }, control.timeoutMs ?? timeoutMs);
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  try {
    const stopped = await Promise.race([closed.then(() => false), failureSignaled.then(() => true)]);
    if (stopped) {
      if (!(await termination!)) throw unconfirmedTerminationError();
      throw failure!;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (termination) {
      if (!(await termination)) throw unconfirmedTerminationError();
      throw failure!;
    }
    if (!(await (control.terminateProcessTree ?? terminateBenchmarkProcessTree)(child, 200))) {
      throw unconfirmedTerminationError();
    }
  } finally {
    clearTimeout(timer);
  }
  if (child.exitCode !== 0 || child.signalCode !== null) throw new Error("Sealed holdout adapter failed");
  return Buffer.concat(stdout).toString("utf8");
}

function unconfirmedTerminationError(): BenchmarkProcessTerminationUnconfirmedError {
  return new BenchmarkProcessTerminationUnconfirmedError("sealed holdout adapter process tree did not terminate");
}

function parseAdapterOutput(source: string): unknown {
  if (Buffer.byteLength(source) > maxOutputBytes) throw new Error("Sealed holdout adapter output exceeded its bound");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Sealed holdout adapter returned malformed JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "value") {
    throw new Error("Sealed holdout adapter returned an invalid protocol response");
  }
  return (value as { value: unknown }).value;
}

function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Sealed holdout adapter returned an unsupported value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSerialize((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
