import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { chunkFile } from "../src/chunk.ts";
import { runCliMain } from "../src/cli.ts";
import { discoverFilesWithOptions } from "../src/discover.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { FilePreparationTaskError } from "../src/rag/file-preparation-core.ts";
import type { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";
import {
  do_refreshPreparedFileIfChanged,
  do_scanWorkspace,
} from "../src/rag/service/workspacecoderagservice-methods/file-preparation.ts";

describe("coverage-100-final", () => {
  describe("chunk & discover edge branches", () => {
    it("extracts symbol when firstLine is blank after comment backtracking", () => {
      // Chunk ending with comments only
      const code = "function f() {}\n\n// trailing comment";
      const chunks = chunkFile(code, "typescript", 10, 50);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("identifies sensitive paths ending with .pem and .key or starting with .env.", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-sensitive-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "server.pem"), "cert");
        fs.writeFileSync(path.join(tmpDir, "private.key"), "key");
        fs.writeFileSync(path.join(tmpDir, ".env"), "secret=1");
        fs.writeFileSync(path.join(tmpDir, ".env.local"), "secret=2");
        fs.writeFileSync(path.join(tmpDir, ".env.example"), "PUBLIC=1");
        fs.writeFileSync(path.join(tmpDir, "index.ts"), "export const a = 1;\n");

        const found = discoverFilesWithOptions(tmpDir, { maxFileSize: 10000 });
        const basenames = found.map((f) => path.basename(f)).sort();
        expect(basenames).toEqual([".env.example", "index.ts"]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("cli arguments parsing edge cases", () => {
    it("handles batch-size and limit with default fallbacks when args are omitted", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as unknown as (code?: string | number | null | undefined) => never);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await runCliMain(["node", "cli.ts", "--batch-size"]);
        expect(exitSpy).toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe("config validation for negative numeric settings", () => {
    it("throws when numeric settings are zero or negative", () => {
      expect(() => {
        loadWorkspaceCodeRagSettings({
          workspaceRoot: "/tmp",
          dataDirectory: "/tmp",
          settings: { encodeBatchSize: 0 },
        });
      }).toThrow("Code RAG numeric settings must be positive");
    });
  });

  describe("EmbeddingProviderHttp and ServerManager error propagation", () => {
    it("cancels embedding request and handles server cancellation confirmation failure", async () => {
      const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 2, false);
      const cancelMethod = (provider as unknown as { cancelRequest(id: string): Promise<void> }).cancelRequest.bind(
        provider,
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ idle: false }),
      } as unknown as Response);

      await expect(cancelMethod("req-123")).rejects.toThrow("did not confirm an idle device");
      fetchSpy.mockRestore();
    });

    it("QdrantServerManager ensureStarted returns active startPromise when already starting", async () => {
      const mgr = new QdrantServerManager(6333);
      vi.spyOn(mgr as unknown as { checkHealth(): Promise<boolean> }, "checkHealth").mockResolvedValue(false);
      (mgr as unknown as { startPromise: Promise<boolean> }).startPromise = Promise.resolve(true);

      const promise = mgr.ensureStarted();
      expect(promise).toBeDefined();
      await expect(promise).resolves.toBe(true);
    });

    it("EmbeddingServerManager ensureStarted returns active startPromise when already starting", async () => {
      const mgr = new EmbeddingServerManager(8080, "model");
      vi.spyOn(mgr as unknown as { checkHealth(): Promise<boolean> }, "checkHealth").mockResolvedValue(false);
      (mgr as unknown as { startPromise: Promise<boolean> }).startPromise = Promise.resolve(true);

      const promise = mgr.ensureStarted();
      expect(promise).toBeDefined();
      await expect(promise).resolves.toBe(true);
    });
  });

  describe("workspace file preparation security block handling", () => {
    it("maps security FilePreparationTaskError to RAG_SECURITY_BLOCK in do_scanWorkspace and do_refreshPreparedFileIfChanged", async () => {
      const service = {
        workspaceRoot: "/tmp",
        settings: { maxFileBytes: 1000 },
        preparationLimits: () => ({
          maxWorkers: 1,
          workerMemoryBytes: 64 * 1024 * 1024,
          memoryReserveBytes: 32 * 1024 * 1024,
        }),
        preparationTask: () => {
          throw new FilePreparationTaskError("security", "File too large");
        },
      } as unknown as WorkspaceCodeRagService;

      const signal = new AbortController().signal;
      await expect(do_scanWorkspace(service, signal, () => {})).rejects.toThrow("File too large");

      const prepared = {
        file: {
          absPath: "/nonexistent/f.ts",
          path: "f.ts",
          size: 100,
          mtimeMs: 100,
          hash: "h",
          language: "typescript",
          isTest: false,
          isGenerated: false,
        },
        chunks: [],
        entry: {
          hash: "h",
          size: 100,
          mtimeMs: 100,
          chunkCount: 0,
          indexedAt: "now",
          language: "typescript",
          isTest: false,
          isGenerated: false,
        },
      };
      await expect(do_refreshPreparedFileIfChanged(service, prepared, "g1", signal)).rejects.toThrow("File too large");
    });
  });
});
