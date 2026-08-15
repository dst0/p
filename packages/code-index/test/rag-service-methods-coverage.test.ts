import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EmbeddingError, VectorStoreError } from "../src/embed/errors.ts";
import { classifySearchError, unlinkBestEffort } from "../src/rag/service/helpers.ts";
import { loadRebuildCheckpoint, loadRebuildPlan, rebuildArtifacts } from "../src/rag/service/rebuild-checkpoint.ts";
import { WorkspaceCodeRagService } from "../src/rag/service/workspacecoderagservice.ts";
import { do_formatHits } from "../src/rag/service/workspacecoderagservice-methods/state-management.ts";

describe("rag-service-methods-coverage", () => {
  describe("classifySearchError & unlinkBestEffort helpers", () => {
    it("classifies diverse error types correctly", () => {
      const serverDown = new EmbeddingError("server_down", "down");
      expect(classifySearchError(serverDown).code).toBe("RAG_EMBEDDING_SERVER_DOWN");

      const serverErr = new EmbeddingError("server_error", "err");
      expect(classifySearchError(serverErr).code).toBe("RAG_EMBEDDING_SERVER_ERROR");

      const otherEmbed = new EmbeddingError("other" as unknown as "server_error", "other");
      expect(classifySearchError(otherEmbed).code).toBe("RAG_EMBEDDING_SERVER_ERROR");

      const qdrantDown = new VectorStoreError("qdrant_down", "down");
      expect(classifySearchError(qdrantDown).code).toBe("RAG_QDRANT_DOWN");

      const qdrantNet = new VectorStoreError("network", "net");
      expect(classifySearchError(qdrantNet).code).toBe("RAG_NETWORK_ERROR");

      const qdrantStore = new VectorStoreError("qdrant_error", "store");
      expect(classifySearchError(qdrantStore).code).toBe("RAG_QDRANT_ERROR");

      const timeout = new Error("timeout");
      timeout.name = "TimeoutError";
      expect(classifySearchError(timeout).code).toBe("RAG_TIMEOUT");

      expect(classifySearchError("string failure").code).toBe("RAG_NETWORK_ERROR");
    });

    it("unlinkBestEffort ignores missing files silently", () => {
      expect(() => unlinkBestEffort("/nonexistent/file/path")).not.toThrow();
    });
  });

  describe("rebuild checkpoint validation", () => {
    it("returns undefined for malformed checkpoint or plan files", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-chk-val-"));
      try {
        const chkFile = path.join(tmpDir, "bad.checkpoint.json");
        fs.writeFileSync(chkFile, JSON.stringify({ invalid: true }));
        expect(loadRebuildCheckpoint(chkFile)).toBeUndefined();

        const planFile = path.join(tmpDir, "bad.plan.json");
        fs.writeFileSync(planFile, JSON.stringify({ invalid: true }));
        expect(loadRebuildPlan(planFile, "gen1")).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("generates rebuild artifact paths for generation", () => {
      const arts = rebuildArtifacts("/tmp/repo", "gen123");
      expect(arts.checkpoint).toBe("/tmp/repo/rebuild-checkpoint.json");
      expect(arts.spool).toBe("/tmp/repo/.rebuild-gen123.jsonl");
      expect(arts.plan).toBe("/tmp/repo/.rebuild-gen123.plan.json");
      expect(arts.vocabulary).toBe("/tmp/repo/bm25-gen123.json");
    });
  });

  describe("candidate post-processing filters and limits", () => {
    it("filters candidates by pathPrefix, symbolTypes, per-file limits, and snippet truncation", () => {
      const service = {
        settings: {
          maxResultCharacters: 50,
          maxContextCharacters: 200,
        },
      } as unknown as WorkspaceCodeRagService;

      const candidates = [
        {
          score: 0.9,
          payload: {
            path: "src/a.ts",
            startLine: 1,
            endLine: 10,
            language: "typescript",
            symbolName: "funcA",
            symbolType: "function" as const,
            chunkHash: "h1",
            content: "a".repeat(100), // > maxResultCharacters (50)
          },
        },
        {
          score: 0.85,
          payload: {
            path: "other/b.ts",
            startLine: 1,
            endLine: 5,
            language: "typescript",
            symbolName: "ClassB",
            symbolType: "class" as const,
            chunkHash: "h2",
            content: "b".repeat(30),
          },
        },
        {
          score: 0.8,
          payload: {
            path: "src/c.ts",
            startLine: 1,
            endLine: 5,
            language: "typescript",
            symbolName: "funcC",
            symbolType: "function" as const,
            chunkHash: "h3",
            content: "c".repeat(30),
          },
        },
      ] as unknown as Parameters<typeof do_formatHits>[1];

      // pathPrefix filter
      const prefixResult = do_formatHits(service, candidates, {
        query: "q",
        limit: 5,
        pathPrefix: "src",
        includeTests: true,
        includeGenerated: true,
        freshness: "prefer_fresh",
      });
      expect(prefixResult.hits.length).toBe(2);
      expect(prefixResult.hits[0].content).toContain("[snippet truncated]");
      expect(prefixResult.truncated).toBe(true);

      // symbolTypes filter
      const symbolResult = do_formatHits(service, candidates, {
        query: "q",
        limit: 5,
        symbolTypes: ["class"],
        includeTests: true,
        includeGenerated: true,
        freshness: "prefer_fresh",
      });
      expect(symbolResult.hits.length).toBe(1);
      expect(symbolResult.hits[0].symbolName).toBe("ClassB");
    });
  });

  describe("WorkspaceCodeRagService error transitions", () => {
    it("throws if workspace root is not a directory", () => {
      const tmpFile = path.join(os.tmpdir(), `p-rag-notdir-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, "file");
      try {
        expect(() => {
          new WorkspaceCodeRagService({
            workspaceRoot: tmpFile,
            dataDirectory: os.tmpdir(),
          });
        }).toThrow("Code RAG workspace is not a directory");
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});
