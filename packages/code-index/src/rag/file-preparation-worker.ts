import { parentPort, threadId } from "node:worker_threads";
import {
  executeFilePreparationTask,
  type FilePreparationErrorKind,
  type FilePreparationTask,
  FilePreparationTaskError,
} from "./file-preparation-core.ts";

interface WorkerRequest {
  id: number;
  task: FilePreparationTask;
}

interface WorkerResponse {
  id: number;
  result?: ReturnType<typeof executeFilePreparationTask>;
  error?: {
    kind: FilePreparationErrorKind;
    message: string;
  };
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && !!record.task && typeof record.task === "object";
}

const port = parentPort;
if (!port) throw new Error("File preparation worker requires parentPort");

port.on("message", (message: unknown) => {
  if (!isWorkerRequest(message)) return;
  try {
    const response: WorkerResponse = {
      id: message.id,
      result: executeFilePreparationTask(message.task, threadId),
    };
    port.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: message.id,
      error: {
        kind: error instanceof FilePreparationTaskError ? error.kind : "io",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    port.postMessage(response);
  }
});
