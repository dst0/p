import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFilePreparationPlan,
  detectFilePreparationResources,
  processFilePreparationTasks,
} from "../src/rag/file-preparation.ts";
import { executeFilePreparationTask, type FilePreparationTask } from "../src/rag/file-preparation-core.ts";
import {
  handleFilePreparationWorkerMessage,
  registerFilePreparationWorker,
  type WorkerRequest,
  type WorkerResponse,
} from "../src/rag/file-preparation-worker.ts";

const temporaryDirectories: string[] = [];
const MEBIBYTE = 1024 * 1024;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function createTasks(count: number, maxFileBytes = MEBIBYTE): FilePreparationTask[] {
  const directory = mkdtempSync(join(tmpdir(), "p-file-preparation-"));
  temporaryDirectories.push(directory);
  return Array.from({ length: count }, (_, index) => {
    const absPath = join(directory, `file-${index}.ts`);
    writeFileSync(absPath, `export const value${index} = ${index};\n`);
    return {
      operation: "prepare",
      absPath,
      path: `file-${index}.ts`,
      language: "typescript",
      isTest: false,
      isGenerated: false,
      maxFileBytes,
      defaultChunkLines: 80,
      maxChunkLines: 300,
      maxChunksPerFile: 2_000,
    };
  });
}

describe("file preparation resource planning", () => {
  it("detects a usable host or cgroup resource snapshot", () => {
    const resources = detectFilePreparationResources();

    expect(resources.logicalCpus).toBeGreaterThanOrEqual(1);
    expect(resources.availableMemoryBytes).toBeGreaterThanOrEqual(0);
  });

  it("falls back from unavailable cgroup files to host memory", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("cgroup unavailable");
    });
    vi.spyOn(os, "freemem").mockReturnValue(768 * MEBIBYTE);
    vi.spyOn(os, "availableParallelism").mockReturnValue(6);

    expect(detectFilePreparationResources()).toEqual({
      logicalCpus: 6,
      availableMemoryBytes: 768 * MEBIBYTE,
    });
  });

  it("uses cgroup v1 headroom when v2 has no finite limit", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((filePath) => {
      const values = new Map([
        ["/sys/fs/cgroup/memory.max", "max"],
        ["/sys/fs/cgroup/memory.current", "0"],
        ["/sys/fs/cgroup/memory/memory.limit_in_bytes", String(1024 * MEBIBYTE)],
        ["/sys/fs/cgroup/memory/memory.usage_in_bytes", String(256 * MEBIBYTE)],
      ]);
      const value = values.get(String(filePath));
      if (value === undefined) throw new Error(`Unexpected cgroup path: ${String(filePath)}`);
      return value;
    });
    vi.spyOn(os, "freemem").mockReturnValue(2048 * MEBIBYTE);
    vi.spyOn(os, "availableParallelism").mockReturnValue(8);

    expect(detectFilePreparationResources()).toEqual({
      logicalCpus: 8,
      availableMemoryBytes: 768 * MEBIBYTE,
    });
  });

  it("returns an empty plan without reserving resources", () => {
    const plan = createFilePreparationPlan(
      0,
      {
        maxWorkers: 4,
        workerMemoryBytes: 64 * MEBIBYTE,
        memoryReserveBytes: 0,
      },
      {
        logicalCpus: 8,
        availableMemoryBytes: 1024 * MEBIBYTE,
      },
    );

    expect(plan).toMatchObject({ workers: 0, maxInFlightBytes: 0 });
  });

  it("rejects invalid resource limits before planning", () => {
    expect(() =>
      createFilePreparationPlan(
        1,
        {
          maxWorkers: 0,
          workerMemoryBytes: 64 * MEBIBYTE,
          memoryReserveBytes: 0,
        },
        {
          logicalCpus: 8,
          availableMemoryBytes: 1024 * MEBIBYTE,
        },
      ),
    ).toThrow("Invalid file preparation resource limits");
  });

  it("uses CPU capacity when both cores and memory are available", () => {
    const plan = createFilePreparationPlan(
      100,
      {
        maxWorkers: 16,
        workerMemoryBytes: 128 * MEBIBYTE,
        memoryReserveBytes: 512 * MEBIBYTE,
      },
      {
        logicalCpus: 32,
        availableMemoryBytes: 16 * 1024 * MEBIBYTE,
      },
    );

    expect(plan.workers).toBe(16);
    expect(plan.maxInFlightBytes).toBe(2 * 1024 * MEBIBYTE);
  });

  it("reduces concurrency when the effective memory budget is constrained", () => {
    const plan = createFilePreparationPlan(
      100,
      {
        maxWorkers: 16,
        workerMemoryBytes: 128 * MEBIBYTE,
        memoryReserveBytes: 512 * MEBIBYTE,
      },
      {
        logicalCpus: 32,
        availableMemoryBytes: 1024 * MEBIBYTE,
      },
    );

    expect(plan.workers).toBe(4);
    expect(plan.maxInFlightBytes).toBe(512 * MEBIBYTE);
  });

  it("returns no workers when the safety reserve leaves no worker budget", () => {
    const plan = createFilePreparationPlan(
      4,
      {
        maxWorkers: 4,
        workerMemoryBytes: 128 * MEBIBYTE,
        memoryReserveBytes: 512 * MEBIBYTE,
      },
      {
        logicalCpus: 8,
        availableMemoryBytes: 600 * MEBIBYTE,
      },
    );

    expect(plan.workers).toBe(0);
    expect(plan.maxInFlightBytes).toBe(0);
  });
});

describe("bounded file reads and chunking", () => {
  it("returns scan metadata without materializing chunks", () => {
    const [task] = createTasks(1);
    const result = executeFilePreparationTask({ ...task, operation: "scan" });

    expect(result).toMatchObject({
      file: {
        path: task.path,
        size: fs.statSync(task.absPath).size,
      },
      chunks: [],
      workerThreadId: 0,
    });
    expect(result.file.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects directories and missing files with actionable error kinds", () => {
    const [task] = createTasks(1);
    expect(() => executeFilePreparationTask({ ...task, absPath: fs.realpathSync(join(task.absPath, "..")) })).toThrow(
      "not a regular file",
    );

    try {
      executeFilePreparationTask({ ...task, absPath: join(task.absPath, "missing") });
      throw new Error("Expected missing file preparation to fail");
    } catch (error) {
      expect(error).toMatchObject({ kind: "io" });
      expect(error).toHaveProperty("message", expect.stringContaining("Failed to read"));
    }
  });

  it("rejects a file that grows beyond its limit during a bounded read", () => {
    const [task] = createTasks(1);
    const actual = fs.statSync(task.absPath);
    vi.spyOn(fs, "fstatSync")
      .mockReturnValueOnce(actual)
      .mockReturnValueOnce({
        ...actual,
        size: task.maxFileBytes + 1,
        isFile: () => true,
      } as fs.Stats);

    expect(() => executeFilePreparationTask(task)).toThrow("exceeds the indexing size limit");
  });

  it("rejects a file that already exceeds its configured limit", () => {
    const [task] = createTasks(1, 8);

    expect(() => executeFilePreparationTask(task)).toThrow("exceeds the indexing size limit");
  });

  it("enforces the chunk-count ceiling before returning source text", () => {
    const [task] = createTasks(1);
    expect(() => executeFilePreparationTask({ ...task, maxChunksPerFile: 0 })).toThrow("File produced too many chunks");
  });
});

describe("bounded file preparation workers", () => {
  it("validates worker messages and serializes success and bounded-read errors", () => {
    const [task] = createTasks(1);
    const request: WorkerRequest = { id: 7, task };

    expect(handleFilePreparationWorkerMessage(null, 11)).toBeUndefined();
    expect(handleFilePreparationWorkerMessage(request, 11)).toMatchObject({
      id: 7,
      result: {
        file: { path: task.path },
        workerThreadId: 11,
      },
    });
    expect(handleFilePreparationWorkerMessage({ id: 8, task: { ...task, maxFileBytes: 8 } }, 11)).toMatchObject({
      id: 8,
      error: {
        kind: "security",
        message: expect.stringContaining("exceeds the indexing size limit"),
      },
    });

    let listener: ((message: unknown) => void) | undefined;
    const responses: WorkerResponse[] = [];
    registerFilePreparationWorker(
      {
        on: (_event, callback) => {
          listener = callback;
        },
        postMessage: (response) => responses.push(response),
      },
      13,
    );
    listener?.(null);
    listener?.(request);
    expect(responses).toMatchObject([{ id: 7, result: { workerThreadId: 13 } }]);
  });

  it("uses the planned worker threads and emits results in source order", async () => {
    const tasks = createTasks(4);
    const results: Array<{ path: string; workerThreadId: number }> = [];
    const plan = await processFilePreparationTasks(
      tasks,
      {
        maxWorkers: 4,
        workerMemoryBytes: 64 * MEBIBYTE,
        memoryReserveBytes: 0,
      },
      new AbortController().signal,
      (result) => {
        results.push({ path: result.file.path, workerThreadId: result.workerThreadId });
      },
      {
        logicalCpus: 4,
        availableMemoryBytes: 8 * 1024 * MEBIBYTE,
      },
    );

    expect(plan).toMatchObject({ mode: "worker_threads", workers: 3 });
    expect(results.map((result) => result.path)).toEqual(tasks.map((task) => task.path));
    expect(new Set(results.slice(0, 3).map((result) => result.workerThreadId)).size).toBe(3);
    expect(results.every((result) => result.workerThreadId > 0)).toBe(true);
  });

  it("refuses preparation before launching workers when memory is unsafe", async () => {
    const tasks = createTasks(1);
    const operation = processFilePreparationTasks(
      tasks,
      {
        maxWorkers: 4,
        workerMemoryBytes: 128 * MEBIBYTE,
        memoryReserveBytes: 512 * MEBIBYTE,
      },
      new AbortController().signal,
      () => undefined,
      {
        logicalCpus: 8,
        availableMemoryBytes: 600 * MEBIBYTE,
      },
    );

    await expect(operation).rejects.toMatchObject({
      kind: "resource",
    });
  });

  it("never reads beyond the configured per-file byte limit", async () => {
    const tasks = createTasks(1, 8);
    const operation = processFilePreparationTasks(
      tasks,
      {
        maxWorkers: 1,
        workerMemoryBytes: 64 * MEBIBYTE,
        memoryReserveBytes: 0,
      },
      new AbortController().signal,
      () => undefined,
      {
        logicalCpus: 2,
        availableMemoryBytes: 1024 * MEBIBYTE,
      },
    );

    await expect(operation).rejects.toMatchObject({
      kind: "security",
    });
  });

  it("falls back to bounded in-process work when worker startup is unavailable", async () => {
    const tasks = createTasks(2);
    const results: number[] = [];
    const missingWorker = pathToFileURL(join(tasks[0].absPath, "..", "missing-worker.mjs"));
    const plan = await processFilePreparationTasks(
      tasks,
      {
        maxWorkers: 2,
        workerMemoryBytes: 64 * MEBIBYTE,
        memoryReserveBytes: 0,
      },
      new AbortController().signal,
      (result) => {
        results.push(result.workerThreadId);
      },
      {
        logicalCpus: 3,
        availableMemoryBytes: 1024 * MEBIBYTE,
      },
      missingWorker,
    );

    expect(plan).toMatchObject({
      mode: "in_process",
      workers: 1,
      fallbackReason: expect.stringContaining("Cannot find module"),
    });
    expect(results).toEqual([0, 0]);
  });

  it.each([
    ["an invalid response", "parentPort.postMessage(null);"],
    ["a response without a result", "parentPort.postMessage({ id: message.id });"],
  ])("falls back after %s from a worker", async (_description, responseStatement) => {
    const tasks = createTasks(1);
    const workerPath = join(tasks[0].absPath, "..", "invalid-response-worker.mjs");
    writeFileSync(
      workerPath,
      `import { parentPort } from "node:worker_threads";
parentPort.on("message", (message) => {
  ${responseStatement}
});
`,
    );
    const results: number[] = [];

    const plan = await processFilePreparationTasks(
      tasks,
      {
        maxWorkers: 1,
        workerMemoryBytes: 64 * MEBIBYTE,
        memoryReserveBytes: 0,
      },
      new AbortController().signal,
      (result) => {
        results.push(result.workerThreadId);
      },
      {
        logicalCpus: 2,
        availableMemoryBytes: 1024 * MEBIBYTE,
      },
      pathToFileURL(workerPath),
    );

    expect(plan).toMatchObject({
      mode: "in_process",
      fallbackReason: expect.stringMatching(/file preparation worker/i),
    });
    expect(results).toEqual([0]);
  });

  it("terminates active workers and preserves the abort reason", async () => {
    const tasks = createTasks(1);
    const hangingWorkerPath = join(tasks[0].absPath, "..", "hanging-worker.mjs");
    writeFileSync(hangingWorkerPath, "setInterval(() => undefined, 1000);\n");
    const controller = new AbortController();
    const operation = processFilePreparationTasks(
      tasks,
      {
        maxWorkers: 1,
        workerMemoryBytes: 64 * MEBIBYTE,
        memoryReserveBytes: 0,
      },
      controller.signal,
      () => undefined,
      {
        logicalCpus: 2,
        availableMemoryBytes: 1024 * MEBIBYTE,
      },
      pathToFileURL(hangingWorkerPath),
    );
    setTimeout(() => controller.abort(new Error("cancel active preparation")), 25);

    await expect(operation).rejects.toThrow("cancel active preparation");
  });

  it("coordinates worker and memory reservations across concurrent repositories", async () => {
    const firstTasks = createTasks(2);
    const secondTasks = createTasks(1);
    let releaseFirst: (() => void) | undefined;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstResultObserved: (() => void) | undefined;
    const firstResult = new Promise<void>((resolve) => {
      firstResultObserved = resolve;
    });
    let secondProcessed = false;
    const limits = {
      maxWorkers: 2,
      workerMemoryBytes: 64 * MEBIBYTE,
      memoryReserveBytes: 0,
    };
    const resources = {
      logicalCpus: 3,
      availableMemoryBytes: 1024 * MEBIBYTE,
    };

    const firstOperation = processFilePreparationTasks(
      firstTasks,
      limits,
      new AbortController().signal,
      async (_result, index) => {
        if (index !== 0) return;
        firstResultObserved?.();
        await holdFirst;
      },
      resources,
    );
    await firstResult;
    const secondOperation = processFilePreparationTasks(
      secondTasks,
      limits,
      new AbortController().signal,
      () => {
        secondProcessed = true;
      },
      resources,
    );
    await Promise.resolve();
    expect(secondProcessed).toBe(false);

    releaseFirst?.();
    await Promise.all([firstOperation, secondOperation]);
    expect(secondProcessed).toBe(true);
  });

  it("cancels a repository waiting for the process-wide worker reservation", async () => {
    const firstTasks = createTasks(2);
    const secondTasks = createTasks(1);
    let releaseFirst: (() => void) | undefined;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstResultObserved: (() => void) | undefined;
    const firstResult = new Promise<void>((resolve) => {
      firstResultObserved = resolve;
    });
    const limits = {
      maxWorkers: 2,
      workerMemoryBytes: 64 * MEBIBYTE,
      memoryReserveBytes: 0,
    };
    const resources = {
      logicalCpus: 3,
      availableMemoryBytes: 1024 * MEBIBYTE,
    };
    const firstOperation = processFilePreparationTasks(
      firstTasks,
      limits,
      new AbortController().signal,
      async (_result, index) => {
        if (index !== 0) return;
        firstResultObserved?.();
        await holdFirst;
      },
      resources,
    );
    await firstResult;
    const waitingController = new AbortController();
    const waitingOperation = processFilePreparationTasks(
      secondTasks,
      limits,
      waitingController.signal,
      () => undefined,
      resources,
    );
    waitingController.abort(new Error("cancel waiting repository"));

    await expect(waitingOperation).rejects.toThrow("cancel waiting repository");
    releaseFirst?.();
    await firstOperation;
  });
});
