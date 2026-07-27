import fs from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";
import {
  executeFilePreparationTask,
  type FilePreparationErrorKind,
  type FilePreparationResult,
  type FilePreparationTask,
  FilePreparationTaskError,
} from "./file-preparation-core.ts";

const MEBIBYTE = 1024 * 1024;

export interface FilePreparationResourceSnapshot {
  logicalCpus: number;
  availableMemoryBytes: number;
}

export interface FilePreparationLimits {
  maxWorkers: number;
  workerMemoryBytes: number;
  memoryReserveBytes: number;
}

export interface FilePreparationPlan {
  mode: "worker_threads" | "in_process";
  workers: number;
  logicalCpus: number;
  availableMemoryBytes: number;
  memoryReserveBytes: number;
  workerMemoryBytes: number;
  maxInFlightBytes: number;
  fallbackReason?: string;
}

interface WorkerRequest {
  id: number;
  task: FilePreparationTask;
}

interface WorkerResponse {
  id: number;
  result?: FilePreparationResult;
  error?: {
    kind: FilePreparationErrorKind;
    message: string;
  };
}

class WorkerInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerInfrastructureError";
  }
}

let reservedWorkers = 0;
let reservedMemoryBytes = 0;
const reservationWaiters = new Set<() => void>();

function notifyReservationWaiters(): void {
  for (const notify of reservationWaiters) notify();
  reservationWaiters.clear();
}

function waitForReservation(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      reservationWaiters.delete(finish);
      resolve();
    };
    const abort = () => {
      reservationWaiters.delete(finish);
      reject(signal.reason ?? new Error("Code RAG refresh cancelled"));
    };
    reservationWaiters.add(finish);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function readMemoryValue(filePath: string, allowZero = false): number | undefined {
  try {
    const value = fs.readFileSync(filePath, "utf-8").trim();
    if (value === "max") return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0) || parsed >= 2 ** 60) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function cgroupAvailableMemoryBytes(): number | undefined {
  const v2Limit = readMemoryValue("/sys/fs/cgroup/memory.max");
  const v2Usage = readMemoryValue("/sys/fs/cgroup/memory.current", true);
  if (v2Limit !== undefined && v2Usage !== undefined) return Math.max(0, v2Limit - v2Usage);

  const v1Limit = readMemoryValue("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  const v1Usage = readMemoryValue("/sys/fs/cgroup/memory/memory.usage_in_bytes", true);
  if (v1Limit !== undefined && v1Usage !== undefined) return Math.max(0, v1Limit - v1Usage);
  return undefined;
}

export function detectFilePreparationResources(): FilePreparationResourceSnapshot {
  const hostAvailable = os.freemem();
  const cgroupAvailable = cgroupAvailableMemoryBytes();
  const hostAvailableEstimated =
    process.platform === "darwin" && hostAvailable < 256 * MEBIBYTE
      ? Math.max(hostAvailable, Math.floor(os.totalmem() * 0.125))
      : hostAvailable;
  return {
    logicalCpus: Math.max(1, os.availableParallelism()),
    availableMemoryBytes: Math.max(
      0,
      cgroupAvailable === undefined ? hostAvailableEstimated : Math.min(hostAvailableEstimated, cgroupAvailable),
    ),
  };
}

export function createFilePreparationPlan(
  fileCount: number,
  limits: FilePreparationLimits,
  resources: FilePreparationResourceSnapshot = detectFilePreparationResources(),
): FilePreparationPlan {
  if (
    !Number.isInteger(limits.maxWorkers) ||
    limits.maxWorkers < 1 ||
    !Number.isFinite(limits.workerMemoryBytes) ||
    limits.workerMemoryBytes < MEBIBYTE ||
    !Number.isFinite(limits.memoryReserveBytes) ||
    limits.memoryReserveBytes < 0
  ) {
    throw new Error("Invalid file preparation resource limits");
  }
  if (fileCount === 0) {
    return {
      mode: "worker_threads",
      workers: 0,
      logicalCpus: resources.logicalCpus,
      availableMemoryBytes: resources.availableMemoryBytes,
      memoryReserveBytes: limits.memoryReserveBytes,
      workerMemoryBytes: limits.workerMemoryBytes,
      maxInFlightBytes: 0,
    };
  }

  const cpuWorkers = Math.max(1, resources.logicalCpus - 1);
  const memoryBudget = Math.max(0, resources.availableMemoryBytes - limits.memoryReserveBytes);
  const memoryWorkers = Math.floor(memoryBudget / limits.workerMemoryBytes);
  const maxPossibleWorkers = Math.min(fileCount, limits.maxWorkers, cpuWorkers);
  const workers = Math.max(0, Math.min(maxPossibleWorkers, memoryWorkers));
  return {
    mode: "worker_threads",
    workers,
    logicalCpus: resources.logicalCpus,
    availableMemoryBytes: resources.availableMemoryBytes,
    memoryReserveBytes: limits.memoryReserveBytes,
    workerMemoryBytes: limits.workerMemoryBytes,
    maxInFlightBytes: workers * limits.workerMemoryBytes,
  };
}

async function acquireFilePreparationPlan(
  fileCount: number,
  limits: FilePreparationLimits,
  signal: AbortSignal,
  resourcesOverride?: FilePreparationResourceSnapshot,
): Promise<{ plan: FilePreparationPlan; release: () => void }> {
  while (true) {
    throwIfAborted(signal);
    const resources = resourcesOverride ?? detectFilePreparationResources();
    const cpuCapacity = Math.max(1, resources.logicalCpus - 1);
    const availableCpuWorkers = Math.max(0, cpuCapacity - reservedWorkers);
    const unreservedMemoryBytes = Math.max(0, resources.availableMemoryBytes - reservedMemoryBytes);
    const plan =
      availableCpuWorkers === 0
        ? createFilePreparationPlan(0, limits, resources)
        : createFilePreparationPlan(
            fileCount,
            { ...limits, maxWorkers: Math.min(limits.maxWorkers, availableCpuWorkers) },
            {
              logicalCpus: availableCpuWorkers + 1,
              availableMemoryBytes: unreservedMemoryBytes,
            },
          );
    if (plan.workers > 0) {
      reservedWorkers += plan.workers;
      reservedMemoryBytes += plan.maxInFlightBytes;
      let released = false;
      return {
        plan: {
          ...plan,
          logicalCpus: resources.logicalCpus,
          availableMemoryBytes: resources.availableMemoryBytes,
        },
        release: () => {
          if (released) return;
          released = true;
          reservedWorkers -= plan.workers;
          reservedMemoryBytes -= plan.maxInFlightBytes;
          notifyReservationWaiters();
        },
      };
    }
    if (reservedWorkers === 0) {
      return {
        plan: {
          ...plan,
          logicalCpus: resources.logicalCpus,
          availableMemoryBytes: resources.availableMemoryBytes,
        },
        release: () => undefined,
      };
    }
    await waitForReservation(signal);
  }
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number";
}

class WorkerSlot {
  private worker: Worker;
  private pending:
    | {
        id: number;
        resolve: (result: FilePreparationResult) => void;
        reject: (error: Error) => void;
      }
    | undefined;

  constructor(workerUrl: URL, maxOldGenerationSizeMb: number) {
    this.worker = new Worker(workerUrl, {
      resourceLimits: {
        maxOldGenerationSizeMb,
      },
    });
    this.worker.on("message", (message: unknown) => this.onMessage(message));
    this.worker.on("error", (error) => this.fail(new WorkerInfrastructureError(error.message)));
    this.worker.on("exit", (code) => {
      if (this.pending) this.fail(new WorkerInfrastructureError(`File preparation worker exited with code ${code}`));
    });
  }

  run(id: number, task: FilePreparationTask): Promise<FilePreparationResult> {
    if (this.pending) throw new Error("File preparation worker received overlapping tasks");
    return new Promise<FilePreparationResult>((resolve, reject) => {
      this.pending = { id, resolve, reject };
      const request: WorkerRequest = { id, task };
      this.worker.postMessage(request);
    });
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }

  private onMessage(message: unknown): void {
    if (!isWorkerResponse(message) || !this.pending || message.id !== this.pending.id) {
      this.fail(new WorkerInfrastructureError("Invalid file preparation worker response"));
      return;
    }
    const pending = this.pending;
    this.pending = undefined;
    if (message.error) {
      pending.reject(new FilePreparationTaskError(message.error.kind, message.error.message));
      return;
    }
    if (!message.result) {
      pending.reject(new WorkerInfrastructureError("File preparation worker returned no result"));
      return;
    }
    pending.resolve(message.result);
  }

  private fail(error: Error): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }
}

class FilePreparationWorkerPool {
  private slots: WorkerSlot[];

  constructor(workers: number, workerMemoryBytes: number, workerUrlOverride?: URL) {
    const isTypeScriptRuntime = import.meta.url.endsWith(".ts");
    const workerUrl =
      workerUrlOverride ??
      new URL(isTypeScriptRuntime ? "./file-preparation-worker.ts" : "./file-preparation-worker.js", import.meta.url);
    const maxOldGenerationSizeMb = Math.max(16, Math.floor(workerMemoryBytes / MEBIBYTE));
    this.slots = Array.from({ length: workers }, () => new WorkerSlot(workerUrl, maxOldGenerationSizeMb));
  }

  runWindow(tasks: FilePreparationTask[], firstId: number): Promise<FilePreparationResult[]> {
    return Promise.all(tasks.map((task, index) => this.slots[index].run(firstId + index, task)));
  }

  async terminate(): Promise<void> {
    await Promise.allSettled(this.slots.map((slot) => slot.terminate()));
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
}

export async function processFilePreparationTasks(
  tasks: FilePreparationTask[],
  limits: FilePreparationLimits,
  signal: AbortSignal,
  onResult: (result: FilePreparationResult, index: number) => Promise<void> | void,
  resources?: FilePreparationResourceSnapshot,
  workerUrlOverride?: URL,
): Promise<FilePreparationPlan> {
  if (tasks.length === 0) return createFilePreparationPlan(0, limits, resources);
  const reservation = await acquireFilePreparationPlan(tasks.length, limits, signal, resources);
  let plan = reservation.plan;
  if (plan.workers === 0) {
    reservation.release();
    throw new FilePreparationTaskError(
      "resource",
      `Insufficient free memory for file preparation: ${plan.availableMemoryBytes} bytes available, ` +
        `${plan.memoryReserveBytes} bytes reserved, ${plan.workerMemoryBytes} bytes required`,
    );
  }

  let pool: FilePreparationWorkerPool | undefined;
  let offset = 0;
  try {
    pool = new FilePreparationWorkerPool(plan.workers, plan.workerMemoryBytes, workerUrlOverride);
    while (offset < tasks.length) {
      throwIfAborted(signal);
      const window = tasks.slice(offset, offset + plan.workers);
      const onAbort = () => {
        void pool?.terminate();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      let results: FilePreparationResult[];
      try {
        results = await pool.runWindow(window, offset);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      for (const [index, result] of results.entries()) {
        throwIfAborted(signal);
        await onResult(result, offset + index);
      }
      offset += window.length;
    }
    return plan;
  } catch (error) {
    if (signal.aborted) throwIfAborted(signal);
    if (!(error instanceof WorkerInfrastructureError)) throw error;
    await pool?.terminate();
    pool = undefined;
    plan = {
      ...plan,
      mode: "in_process",
      workers: 1,
      maxInFlightBytes: plan.workerMemoryBytes,
      fallbackReason: error.message,
    };
    for (; offset < tasks.length; offset += 1) {
      throwIfAborted(signal);
      await onResult(executeFilePreparationTask(tasks[offset]), offset);
    }
    return plan;
  } finally {
    await pool?.terminate();
    reservation.release();
  }
}
