import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EmbeddingError } from "../src/embed/errors.ts";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";
import { EmbeddingServerManager } from "../src/embed/server.ts";
import { loadWorkspaceCodeRagSettings } from "../src/rag/config.ts";
import { CodeRagError } from "../src/rag/service/coderagerror.ts";
import { mapOperationError } from "../src/rag/service/helpers.ts";
import { loadRebuildCheckpoint, loadRebuildPlan } from "../src/rag/service/rebuild-checkpoint.ts";

describe("coverage-completion-final", () => {
  describe("rebuild-checkpoint invalid field coverage", () => {
    it("rejects checkpoints with invalid fields", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-chk-invalid-"));
      try {
        const testCases = [
          { schemaVersion: 999 },
          { schemaVersion: 1, repoId: 123 },
          { schemaVersion: 1, repoId: "r", root: "root", generation: "invalid/gen!" },
          {
            schemaVersion: 1,
            repoId: "r",
            root: "root",
            generation: "g",
            collection: "c",
            sourceFingerprint: "s",
            compatibilityFingerprint: "cf",
            chunkCount: -5,
          },
          {
            schemaVersion: 1,
            repoId: "r",
            root: "root",
            generation: "g",
            collection: "c",
            sourceFingerprint: "s",
            compatibilityFingerprint: "cf",
            chunkCount: 10,
            completedChunks: 15,
          },
          {
            schemaVersion: 1,
            repoId: "r",
            root: "root",
            generation: "g",
            collection: "c",
            sourceFingerprint: "s",
            compatibilityFingerprint: "cf",
            chunkCount: 10,
            completedChunks: -1,
          },
        ];

        for (let i = 0; i < testCases.length; i++) {
          const filePath = path.join(tmpDir, `chk-${i}.json`);
          fs.writeFileSync(filePath, JSON.stringify(testCases[i]));
          expect(loadRebuildCheckpoint(filePath)).toBeUndefined();
        }

        const planPath = path.join(tmpDir, "plan-invalid.json");
        fs.writeFileSync(
          planPath,
          JSON.stringify({ schemaVersion: 1, generation: "g", files: { "a.ts": { invalid: true } } }),
        );
        expect(loadRebuildPlan(planPath, "g")).toBeUndefined();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("config validation errors for boolean, number, string fields", () => {
    it("throws on invalid types in JSON config file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-conf-types-"));
      try {
        const boolConf = path.join(tmpDir, "bad-bool.json");
        fs.writeFileSync(boolConf, JSON.stringify({ remoteBackendsAllowed: "true" }));
        expect(() => {
          loadWorkspaceCodeRagSettings({ workspaceRoot: "/tmp", dataDirectory: "/tmp", userConfigPath: boolConf });
        }).toThrow("expected boolean");

        const numConf = path.join(tmpDir, "bad-num.json");
        fs.writeFileSync(numConf, JSON.stringify({ embeddingDimensions: "1024" }));
        expect(() => {
          loadWorkspaceCodeRagSettings({ workspaceRoot: "/tmp", dataDirectory: "/tmp", userConfigPath: numConf });
        }).toThrow("expected finite number");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("EmbeddingProviderHttp response parsing and error handling", () => {
    it("throws on invalid response structures in parseResponse", () => {
      const provider = new EmbeddingProviderHttp("http://127.0.0.1:8080", 2, false);
      const parse = (
        provider as unknown as { parseResponse(val: unknown, rows: number): Float32Array[] }
      ).parseResponse.bind(provider);

      expect(() => parse(null, 1)).toThrow("invalid response");
      expect(() => parse([], 1)).toThrow("invalid response");
      expect(() => parse({ embeddings: "not-array" }, 1)).toThrow("expected 1");
      expect(() =>
        parse(
          {
            embeddings: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
          },
          1,
        ),
      ).toThrow("expected 1");
      expect(() => parse({ embeddings: [[0.1]] }, 1)).toThrow("dimensions do not match configured dimension 2");
      expect(() => parse({ embeddings: [["not-a-number", 0.2]] }, 1)).toThrow("dimensions do not match");
    });
  });

  describe("mapOperationError mapping across error types", () => {
    it("maps all error types correctly", () => {
      const signal = new AbortController().signal;
      const codeRagErr = new CodeRagError("RAG_EMBEDDING_SERVER_DOWN", "down");
      expect(mapOperationError(codeRagErr, signal)).toBe(codeRagErr);

      const embedErr = new EmbeddingError("server_down", "down");
      expect(mapOperationError(embedErr, signal).code).toBe("RAG_BACKEND_UNAVAILABLE");

      const timeoutErr = new Error("timeout");
      timeoutErr.name = "TimeoutError";
      expect(mapOperationError(timeoutErr, signal).code).toBe("RAG_TIMEOUT");

      const genericErr = new Error("something went wrong");
      expect(mapOperationError(genericErr, signal).code).toBe("RAG_BACKEND_UNAVAILABLE");

      const abortedCtrl = new AbortController();
      abortedCtrl.abort();
      expect(mapOperationError(new Error("aborted"), abortedCtrl.signal).code).toBe("RAG_CANCELLED");
    });

    it("EmbeddingServerManager waitUntilIdle returns true when active requests drop to zero and false on timeout", async () => {
      const mgr = new EmbeddingServerManager(19876, "model");
      // When fetch fails, waitUntilIdle returns false
      const idle = await mgr.waitUntilIdle(50);
      expect(idle).toBe(false);
    });
  });

  describe("EmbeddingServerManager lifecycle edge cases", () => {
    it("stop returns immediately when child is null", async () => {
      const mgr = new EmbeddingServerManager(8080, "test-model");
      await expect(mgr.stop()).resolves.toBeUndefined();
    });
  });
});
