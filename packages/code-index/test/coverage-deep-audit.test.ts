import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { chunkFile } from "../src/chunk.ts";
import { discoverFilesWithOptions } from "../src/discover.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";
import { loadManifest } from "../src/rag/manifest.ts";
import { retrievalTextForPayload, waitForSignal } from "../src/rag/service/helpers.ts";
import { loadRebuildCheckpoint, loadRebuildPlan } from "../src/rag/service/rebuild-checkpoint.ts";
import type { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";
import { do_rebuild, do_search } from "../src/rag/service/workspacecoderagservice-methods/lifecycle.ts";
import {
  do_formatHits,
  do_manifestIncompatibility,
  do_normalizeSearchInput,
  do_updateFastFreshness,
} from "../src/rag/service/workspacecoderagservice-methods/state-management.ts";

describe("coverage-deep-audit", () => {
  describe("chunk & discover edge cases", () => {
    it("handles whitespace first line and sensitive paths", () => {
      expect(chunkFile("   \nfunction x() {}", "typescript")).toHaveLength(1);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-disc-sens-"));
      try {
        const sshDir = path.join(tmpDir, ".ssh");
        fs.mkdirSync(sshDir, { recursive: true });
        fs.writeFileSync(path.join(sshDir, "id_rsa"), "secret");
        const normal = path.join(tmpDir, "app.ts");
        fs.writeFileSync(normal, "const a = 1;");

        const found = discoverFilesWithOptions(tmpDir, { maxFileSize: 10000 });
        expect(found).toEqual([normal]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("EmbeddingProviderHttp & ServerManager edge cases", () => {
    it("handles pre-aborted signal in encode and encodeQuery", async () => {
      const provider = new EmbeddingProviderHttp("http://[::1]:8080", 2, false);
      const abortedSignal = AbortSignal.abort(new Error("pre-aborted"));

      await expect(provider.encode(["text"], abortedSignal)).rejects.toThrow("pre-aborted");
      await expect(provider.encodeQuery("text", abortedSignal)).rejects.toThrow("pre-aborted");
    });

    it("QdrantServerManager ensureStarted returns false when already healthy", async () => {
      const mgr = new QdrantServerManager(6333);
      vi.spyOn(mgr as unknown as { checkHealth(): Promise<boolean> }, "checkHealth").mockResolvedValue(true);
      const started = await mgr.ensureStarted();
      expect(started).toBe(false);
    });

    it("EmbeddingServerManager ensureStarted returns false when already healthy", async () => {
      const mgr = new EmbeddingServerManager(8080, "model", { configPath: "/tmp/conf.json" });
      vi.spyOn(mgr as unknown as { checkHealth(): Promise<boolean> }, "checkHealth").mockResolvedValue(true);
      const started = await mgr.ensureStarted();
      expect(started).toBe(false);
    });
  });

  describe("manifest & helpers coverage", () => {
    it("loadManifest throws on invalid schema", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-manif-inv-"));
      try {
        const file = path.join(tmpDir, "manifest.json");
        fs.writeFileSync(file, JSON.stringify({ schemaVersion: 999 }));
        expect(() => loadManifest(file)).toThrow("Code RAG manifest is incompatible or malformed");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("retrievalTextForPayload truncates text correctly", () => {
      const text = retrievalTextForPayload(
        {
          repoId: "r",
          path: "f.ts",
          startLine: 1,
          endLine: 10,
          language: "typescript",
          symbolName: "sym",
          symbolType: "function",
          chunkHash: "h",
          content: "x".repeat(100),
        } as unknown as Parameters<typeof retrievalTextForPayload>[0],
        50,
      );
      expect(text.length).toBeLessThanOrEqual(60);
    });

    it("waitForSignal handles undefined and aborted signals", async () => {
      await expect(waitForSignal(Promise.resolve(42), undefined)).resolves.toBe(42);

      const aborted = AbortSignal.abort(new Error("cancelled"));
      await expect(waitForSignal(Promise.resolve(42), aborted)).rejects.toThrow("Code RAG operation was cancelled");
    });
  });

  describe("state-management method delegates", () => {
    it("handles updateFastFreshness when state is unavailable or disabled", () => {
      const service = { state: "disabled" } as unknown as WorkspaceCodeRagService;
      expect(() => do_updateFastFreshness(service)).not.toThrow();
    });

    it("detects manifest incompatibility for schema and repo identity", () => {
      const service = {
        repoId: "expected-repo",
        workspaceRoot: "/path/to/root",
        settings: { defaultChunkLines: 80, maxChunkLines: 300 },
      } as unknown as WorkspaceCodeRagService;

      const badSchema = { schemaVersion: 999 } as unknown as Parameters<typeof do_manifestIncompatibility>[1];
      expect(do_manifestIncompatibility(service, badSchema)).toBe("Index schema changed");

      const badRepo = {
        schemaVersion: 1,
        repoId: "other-repo",
        root: "/path/to/root",
        chunker: { name: "default", version: 1, defaultChunkLines: 80, maxChunkLines: 300 },
      } as unknown as Parameters<typeof do_manifestIncompatibility>[1];
      expect(do_manifestIncompatibility(service, badRepo)).toBe("Repository identity changed");
    });

    it("normalizes and deduplicates search input filters", () => {
      const service = { settings: { defaultLimit: 10, maxLimit: 50 } } as unknown as WorkspaceCodeRagService;
      const normalized = do_normalizeSearchInput(service, {
        query: "test",
        languages: ["typescript", "typescript", "javascript"],
        symbolTypes: ["function", "function", "class"],
      });
      expect(normalized.languages).toEqual(["typescript", "javascript"]);
      expect(normalized.symbolTypes).toEqual(["function", "class"]);
    });

    it("enforces max 3 chunks per file in formatHits", () => {
      const service = {
        settings: { maxResultCharacters: 1000, maxContextCharacters: 5000 },
      } as unknown as WorkspaceCodeRagService;

      const candidates = Array.from({ length: 6 }, (_, i) => ({
        score: 0.9 - i * 0.05,
        payload: {
          path: "same-file.ts",
          startLine: i * 10 + 1,
          endLine: i * 10 + 5,
          language: "typescript",
          symbolName: `fn${i}`,
          symbolType: "function" as const,
          chunkHash: `h${i}`,
          content: `function fn${i}() {}`,
        } as unknown as Parameters<typeof do_formatHits>[1][0]["payload"],
      }));

      const result = do_formatHits(service, candidates, {
        query: "q",
        limit: 10,
        includeTests: true,
        includeGenerated: true,
        freshness: "prefer_fresh",
      });
      expect(result.hits.length).toBe(3);
    });
  });

  describe("lifecycle and checkpoint validation edge cases", () => {
    it("marks state stale when Qdrant collection is missing during search", async () => {
      const service = {
        manifest: { collection: "missing-coll", generation: "g1" },
        vectorStore: { collectionExists: async () => false },
        emptySearchResponse: () => ({ results: [] }),
        normalizeSearchInput: (i: unknown) => ({
          ...(i as object),
          query: (i as { query: string }).query,
          freshness: "allow_stale",
        }),
        initialize: async () => {},
        settings: { searchTimeoutMs: 5000, allowStaleSearch: true },
        errorInfo: (code: string, message: string) => ({ code, message }),
      } as unknown as WorkspaceCodeRagService;
      const res = await do_search(service, { query: "test" });
      expect(res.results).toEqual([]);
      expect(service.state).toBe("stale");
      expect(service.staleReason).toBe("Qdrant collection is missing");

      // In-flight refresh promise in rebuild
      const rebuildService = {
        refreshPromise: Promise.resolve({ fullRebuild: false }),
      } as unknown as WorkspaceCodeRagService;
      const rebuildRes = await do_rebuild(rebuildService);
      expect(rebuildRes.fullRebuild).toBe(false);
    });

    it("loadRebuildCheckpoint and loadRebuildPlan reject arrays and non-objects", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-chk-arr-"));
      try {
        const arrFile = path.join(tmpDir, "arr.json");
        fs.writeFileSync(arrFile, "[]");
        expect(loadRebuildCheckpoint(arrFile)).toBeUndefined();
        expect(loadRebuildPlan(arrFile, "gen")).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
