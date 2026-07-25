import { randomBytes } from "node:crypto";
import { OutputAccumulator } from "./output-accumulator.ts";
import type { TruncationResult } from "./truncate.ts";

export type BackgroundProcessStatus = "running" | "completed" | "failed" | "cancelled";

export interface BackgroundProcessSnapshot {
  sessionId: string;
  command: string;
  status: BackgroundProcessStatus;
  output: string;
  newOutput: boolean;
  revision: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  error?: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export interface BackgroundProcessStartOptions {
  command: string;
  execute: (options: { onData: (data: Buffer) => void; signal: AbortSignal }) => Promise<{ exitCode: number | null }>;
  signal?: AbortSignal;
  onSettled?: (snapshot: BackgroundProcessSnapshot) => void;
}

export interface BackgroundProcessWaitOptions {
  signal?: AbortSignal;
  yieldTimeMs?: number;
  onUpdate?: (snapshot: BackgroundProcessSnapshot) => void;
}

type BackgroundProcessListener = (snapshot: BackgroundProcessSnapshot) => void;

interface ManagedBackgroundProcess {
  sessionId: string;
  command: string;
  status: BackgroundProcessStatus;
  output: OutputAccumulator;
  revision: number;
  lastObservedRevision: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  error?: string;
  controller: AbortController;
  completion: Promise<void>;
  listeners: Set<BackgroundProcessListener>;
}

const MAX_RETAINED_COMPLETED_PROCESSES = 32;

function createSessionId(): string {
  return `proc_${randomBytes(8).toString("hex")}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BackgroundProcessManager {
  private readonly processes = new Map<string, ManagedBackgroundProcess>();

  start(options: BackgroundProcessStartOptions): string {
    this.pruneCompleted();
    const sessionId = createSessionId();
    const process: ManagedBackgroundProcess = {
      sessionId,
      command: options.command,
      status: "running",
      output: new OutputAccumulator({ tempFilePrefix: `p-process-${sessionId}` }),
      revision: 0,
      lastObservedRevision: 0,
      startedAt: Date.now(),
      controller: new AbortController(),
      completion: Promise.resolve(),
      listeners: new Set(),
    };
    this.processes.set(sessionId, process);

    const onParentAbort = () => process.controller.abort();
    if (options.signal?.aborted) {
      process.controller.abort();
    } else {
      options.signal?.addEventListener("abort", onParentAbort, { once: true });
    }

    process.completion = this.run(process, options)
      .catch(() => {
        // run() normalizes execution errors into process state.
      })
      .finally(() => {
        options.signal?.removeEventListener("abort", onParentAbort);
      });
    return sessionId;
  }

  observe(sessionId: string): BackgroundProcessSnapshot {
    const process = this.getProcess(sessionId);
    const newOutput = process.revision > process.lastObservedRevision;
    process.lastObservedRevision = process.revision;
    return this.createSnapshot(process, newOutput);
  }

  async waitForCompletion(
    sessionId: string,
    options: BackgroundProcessWaitOptions = {},
  ): Promise<BackgroundProcessSnapshot> {
    const process = this.getProcess(sessionId);
    if (process.status === "running") {
      await this.waitFor(process, () => process.status !== "running", options);
    }
    return this.observe(sessionId);
  }

  async waitForChange(
    sessionId: string,
    options: BackgroundProcessWaitOptions = {},
  ): Promise<BackgroundProcessSnapshot> {
    const process = this.getProcess(sessionId);
    const observedRevision = process.lastObservedRevision;
    if (process.status === "running" && process.revision <= observedRevision) {
      await this.waitFor(process, () => process.status !== "running" || process.revision > observedRevision, options);
    }
    return this.observe(sessionId);
  }

  async kill(sessionId: string): Promise<BackgroundProcessSnapshot> {
    const process = this.getProcess(sessionId);
    if (process.status === "running") {
      process.controller.abort();
      await process.completion;
    }
    return this.observe(sessionId);
  }

  async killAll(): Promise<void> {
    const running = [...this.processes.values()].filter((process) => process.status === "running");
    for (const process of running) {
      process.controller.abort();
    }
    await Promise.all(running.map((process) => process.completion));
  }

  private async run(process: ManagedBackgroundProcess, options: BackgroundProcessStartOptions): Promise<void> {
    try {
      const result = await options.execute({
        signal: process.controller.signal,
        onData: (data) => {
          if (process.status !== "running") return;
          process.output.append(data);
          process.revision++;
          this.notify(process);
        },
      });
      process.exitCode = result.exitCode;
      if (process.controller.signal.aborted) {
        process.status = "cancelled";
        process.error = "Command aborted";
      } else if (result.exitCode === 0 || result.exitCode === null) {
        process.status = "completed";
      } else {
        process.status = "failed";
        process.error = `Command exited with code ${result.exitCode}`;
      }
    } catch (error) {
      process.status = process.controller.signal.aborted ? "cancelled" : "failed";
      process.error = process.controller.signal.aborted ? "Command aborted" : getErrorMessage(error);
    } finally {
      process.output.finish();
      try {
        await process.output.closeTempFile();
      } catch (error) {
        process.status = "failed";
        process.error = `Failed to finalize command output: ${getErrorMessage(error)}`;
      }
      process.endedAt = Date.now();
      process.revision++;
      const snapshot = this.createSnapshot(process, process.revision > process.lastObservedRevision);
      this.notify(process);
      try {
        options.onSettled?.(snapshot);
      } catch {
        // Result observers must not corrupt the process lifecycle.
      }
    }
  }

  private async waitFor(
    process: ManagedBackgroundProcess,
    predicate: () => boolean,
    options: BackgroundProcessWaitOptions,
  ): Promise<void> {
    if (predicate() || options.yieldTimeMs === 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        process.listeners.delete(onProcessUpdate);
        options.signal?.removeEventListener("abort", onAbort);
        if (timeout) clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const onProcessUpdate = (snapshot: BackgroundProcessSnapshot) => {
        try {
          options.onUpdate?.(snapshot);
        } catch {
          // Progress observers must not corrupt or stall the process lifecycle.
        }
        if (predicate()) finish();
      };
      const onAbort = () => finish(new Error("Operation aborted"));

      process.listeners.add(onProcessUpdate);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.yieldTimeMs !== undefined) {
        timeout = setTimeout(() => finish(), Math.max(0, options.yieldTimeMs));
      }
      if (options.signal?.aborted) {
        onAbort();
      } else if (predicate()) {
        finish();
      }
    });
  }

  private notify(process: ManagedBackgroundProcess): void {
    if (process.listeners.size === 0) return;
    const snapshot = this.createSnapshot(process, process.revision > process.lastObservedRevision);
    for (const listener of [...process.listeners]) {
      listener(snapshot);
    }
  }

  private createSnapshot(process: ManagedBackgroundProcess, newOutput: boolean): BackgroundProcessSnapshot {
    const output = process.output.snapshot({ persistIfTruncated: true });
    return {
      sessionId: process.sessionId,
      command: process.command,
      status: process.status,
      output: output.content,
      newOutput,
      revision: process.revision,
      startedAt: process.startedAt,
      endedAt: process.endedAt,
      exitCode: process.exitCode,
      error: process.error,
      truncation: output.truncation.truncated ? output.truncation : undefined,
      fullOutputPath: output.fullOutputPath,
    };
  }

  private getProcess(sessionId: string): ManagedBackgroundProcess {
    const process = this.processes.get(sessionId);
    if (!process) {
      throw new Error(`Unknown process session: ${sessionId}`);
    }
    return process;
  }

  private pruneCompleted(): void {
    const completed = [...this.processes.values()]
      .filter((process) => process.status !== "running")
      .sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0));
    while (completed.length >= MAX_RETAINED_COMPLETED_PROCESSES) {
      const process = completed.shift();
      if (process) this.processes.delete(process.sessionId);
    }
  }
}

export const defaultBackgroundProcessManager = new BackgroundProcessManager();
