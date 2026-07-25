import { parentPort, threadId } from "node:worker_threads";
import {
  executeFilePreparationTask,
  type FilePreparationErrorKind,
  type FilePreparationTask,
  FilePreparationTaskError,
} from "./file-preparation-core.ts";

export interface WorkerRequest {
  id: number;
  task: FilePreparationTask;
}

export interface WorkerResponse {
  id: number;
  result?: ReturnType<typeof executeFilePreparationTask>;
  error?: {
    kind: FilePreparationErrorKind;
    message: string;
  };
}

export interface FilePreparationWorkerPort {
  on(event: "message", listener: (message: unknown) => void): unknown;
  postMessage(message: WorkerResponse): void;
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && !!record.task && typeof record.task === "object";
}

export function handleFilePreparationWorkerMessage(
  message: unknown,
  workerThreadId = threadId,
): WorkerResponse | undefined {
  if (!isWorkerRequest(message)) return undefined;
  try {
    return {
      id: message.id,
      result: executeFilePreparationTask(message.task, workerThreadId),
    };
  } catch (error) {
    return {
      id: message.id,
      error: {
        kind: error instanceof FilePreparationTaskError ? error.kind : "io",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function registerFilePreparationWorker(port: FilePreparationWorkerPort, workerThreadId = threadId): void {
  port.on("message", (message: unknown) => {
    const response = handleFilePreparationWorkerMessage(message, workerThreadId);
    if (response) port.postMessage(response);
  });
}

if (parentPort) registerFilePreparationWorker(parentPort);
