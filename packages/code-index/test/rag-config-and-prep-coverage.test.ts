import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { processFilePreparationTasks } from "../src/rag/file-preparation.ts";
import {
  executeFilePreparationTask,
  type FilePreparationTask,
  FilePreparationTaskError,
} from "../src/rag/file-preparation-core.ts";
import {
  handleFilePreparationWorkerMessage,
  isWorkerRequest,
  registerFilePreparationWorker,
} from "../src/rag/file-preparation-worker.ts";

describe("rag-config-and-prep-coverage", () => {
  describe("rag config validation & resolution", () => {
    it("throws on invalid protocol or remote URL without remoteBackendsAllowed", () => {
      expect(() => {
        loadWorkspaceCodeRagSettings({
          workspaceRoot: "/tmp",
          dataDirectory: "/tmp/data",
          settings: { embeddingServerUrl: "ftp://localhost:8080" },
        });
      }).toThrow("Code RAG embeddingServerUrl must be a valid absolute URL");

      expect(() => {
        loadWorkspaceCodeRagSettings({
          workspaceRoot: "/tmp",
          dataDirectory: "/tmp/data",
          settings: { embeddingServerUrl: "http://example.com:8080", remoteBackendsAllowed: false },
        });
      }).toThrow("must be local unless remoteBackendsAllowed is explicitly enabled");
    });

    it("parses config file error handling non-Error exceptions", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-rag-conf-err-"));
      try {
        const confFile = path.join(tmpDir, "bad.json");
        fs.writeFileSync(confFile, "{ broken json");
        expect(() => {
          loadWorkspaceCodeRagSettings({
            workspaceRoot: "/tmp",
            dataDirectory: "/tmp/data",
            userConfigPath: confFile,
          });
        }).toThrow("Invalid code RAG config");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("file preparation worker handling", () => {
    it("validates worker requests and handles non-request messages", () => {
      expect(isWorkerRequest(null)).toBe(false);
      expect(isWorkerRequest("string")).toBe(false);
      expect(isWorkerRequest({ id: 1 })).toBe(false);
      expect(isWorkerRequest({ id: 1, task: null })).toBe(false);
      expect(handleFilePreparationWorkerMessage({ invalid: true })).toBeUndefined();
    });

    it("maps unexpected worker task exceptions to io error kind", () => {
      const task: FilePreparationTask = {
        operation: "prepare",
        absPath: "/nonexistent/file.ts",
        path: "file.ts",
        language: "typescript",
        isTest: false,
        isGenerated: false,
        maxFileBytes: 1000,
        defaultChunkLines: 80,
        maxChunkLines: 300,
        maxChunksPerFile: 100,
      };
      const response = handleFilePreparationWorkerMessage({ id: 42, task });
      expect(response?.id).toBe(42);
      expect(response?.error?.kind).toBe("io");
    });

    it("registers worker port and filters out undefined responses", () => {
      const posted: unknown[] = [];
      let listener: ((msg: unknown) => void) | undefined;
      const fakePort = {
        on: (_event: string, fn: (msg: unknown) => void) => {
          listener = fn;
        },
        postMessage: (msg: unknown) => {
          posted.push(msg);
        },
      };

      registerFilePreparationWorker(fakePort, 1);
      expect(listener).toBeDefined();

      listener?.("not a worker request");
      expect(posted.length).toBe(0);
    });
  });

  describe("file preparation core & task execution", () => {
    it("handles unstable changing file throwing unstable error", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-prep-unstable-"));
      try {
        const filePath = path.join(tmpDir, "unstable.ts");
        fs.writeFileSync(filePath, "const x = 1;\n");
        let statCall = 0;
        const realFstatSync = fs.fstatSync;
        vi.spyOn(fs, "fstatSync").mockImplementation((fd) => {
          statCall += 1;
          const stat = realFstatSync(fd);
          return {
            ...stat,
            mtimeMs: stat.mtimeMs + statCall, // always changing
          } as unknown as fs.Stats;
        });

        const task: FilePreparationTask = {
          operation: "prepare",
          absPath: filePath,
          path: "unstable.ts",
          language: "typescript",
          isTest: false,
          isGenerated: false,
          maxFileBytes: 1000,
          defaultChunkLines: 80,
          maxChunkLines: 300,
          maxChunksPerFile: 100,
        };

        expect(() => executeFilePreparationTask(task)).toThrowError(FilePreparationTaskError);
      } finally {
        vi.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("returns immediate plan when task list is empty in processFilePreparationTasks", async () => {
      const limits = { maxWorkers: 2, workerMemoryBytes: 64 * 1024 * 1024, memoryReserveBytes: 32 * 1024 * 1024 };
      const controller = new AbortController();
      const plan = await processFilePreparationTasks([], limits, controller.signal, () => {});
      expect(plan.workers).toBe(0);
    });

    it("throws when signal is pre-aborted in processFilePreparationTasks", async () => {
      const limits = { maxWorkers: 2, workerMemoryBytes: 64 * 1024 * 1024, memoryReserveBytes: 32 * 1024 * 1024 };
      const abortedSignal = AbortSignal.abort(new Error("pre-cancelled"));
      const task: FilePreparationTask = {
        operation: "scan",
        absPath: "/tmp/f.ts",
        path: "f.ts",
        language: "typescript",
        isTest: false,
        isGenerated: false,
        maxFileBytes: 1000,
        defaultChunkLines: 80,
        maxChunkLines: 300,
        maxChunksPerFile: 100,
      };
      await expect(processFilePreparationTasks([task], limits, abortedSignal, () => {})).rejects.toThrow(
        "pre-cancelled",
      );
    });
  });
});
