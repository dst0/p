import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { discoverFiles } from "../src/discover.ts";
import { matchesConfiguredEmbeddingBackend } from "../src/embed/backend-health.ts";
import { QdrantServerManager } from "../src/embed/qdrant-server.ts";
import { QdrantClient } from "../src/qdrant.ts";

describe("embed-servers-coverage", () => {
  describe("matchesConfiguredEmbeddingBackend", () => {
    it("handles auto and undefined configured devices", () => {
      expect(matchesConfiguredEmbeddingBackend(undefined, {})).toBe(true);
      expect(matchesConfiguredEmbeddingBackend("auto", {})).toBe(true);
      expect(matchesConfiguredEmbeddingBackend("mps", { fallbackOccurred: true })).toBe(false);
    });

    it("normalizes diverse backend names and npu aliases", () => {
      expect(matchesConfiguredEmbeddingBackend("mps", { requestedBackend: "apple-mps", selectedBackend: "mps" })).toBe(
        true,
      );
      expect(
        matchesConfiguredEmbeddingBackend("cuda", { requestedBackend: "nvidia-cuda", selectedBackend: "cuda" }),
      ).toBe(true);
      expect(matchesConfiguredEmbeddingBackend("rocm", { requestedBackend: "amd-rocm", selectedBackend: "rocm" })).toBe(
        true,
      );
      expect(
        matchesConfiguredEmbeddingBackend("apple-coreml", {
          requestedBackend: "apple-coreai-ane-v1",
          selectedBackend: "apple-coreml",
        }),
      ).toBe(true);
      expect(
        matchesConfiguredEmbeddingBackend("openvino-npu", {
          requestedBackend: "intel-openvino-npu",
          selectedBackend: "openvino-npu",
        }),
      ).toBe(true);
      expect(
        matchesConfiguredEmbeddingBackend("ryzenai", {
          requestedBackend: "amd-ryzenai-npu",
          selectedBackend: "vitisai",
        }),
      ).toBe(true);
      expect(
        matchesConfiguredEmbeddingBackend("npu", {
          requestedBackend: "intel-openvino-npu",
          selectedBackend: "apple-ane",
        }),
      ).toBe(true);
      expect(matchesConfiguredEmbeddingBackend("cpu", { requestedBackend: 123, selectedBackend: null })).toBe(false);
      expect(matchesConfiguredEmbeddingBackend("cpu", { requestedBackend: "   ", selectedBackend: "cpu" })).toBe(false);
    });
  });

  describe("QdrantClient getStatus & upsertBatch edge cases", () => {
    it("handles missing vectorsConfig dense and size properties in getStatus", async () => {
      const client = new QdrantClient({
        qdrantUrl: "http://127.0.0.1:6333",
        collection: "test-coll",
        batchSize: 0,
      } as unknown as ConstructorParameters<typeof QdrantClient>[0]);
      const mockGetCollection = vi.fn().mockResolvedValue({
        points_count: 5,
        indexed_vectors_count: 5,
        segments_count: 1,
        config: {
          params: {
            vectors: {},
            sparse_vectors: { bm25: {} },
          },
        },
      });
      (client as unknown as { client: { getCollection: typeof mockGetCollection } }).client = {
        getCollection: mockGetCollection,
      };

      const status = await client.getStatus();
      expect(status.vectorDim).toBe("?");
      expect(status.sparseVectors).toBe(true);
    });

    it("uses default batch size of 8 when batchSize is 0 in upsertBatch", async () => {
      const client = new QdrantClient({
        qdrantUrl: "http://127.0.0.1:6333",
        collection: "test-coll",
        batchSize: 0,
      } as unknown as ConstructorParameters<typeof QdrantClient>[0]);
      const mockUpsert = vi.fn().mockResolvedValue({ status: "completed" });
      (client as unknown as { client: { upsert: typeof mockUpsert } }).client = { upsert: mockUpsert };

      const points = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        vectors: { dense: [0.1, 0.2], sparse: { indices: [1], values: [1.0] } },
        payload: {
          repo: "repo",
          path: "f.ts",
          startLine: 1,
          endLine: 5,
          symbol: "",
          chunkType: "function" as const,
          hash: "h",
        } as unknown as Parameters<typeof client.upsertBatch>[0][0]["payload"],
      }));

      await client.upsertBatch(points);
      expect(mockUpsert).toHaveBeenCalledTimes(2); // 8 + 2
    });
  });

  describe("QdrantServerManager api key & health check edge cases", () => {
    it("handles empty saved qdrant.key file gracefully", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-empty-key-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "qdrant.key"), "  \n");
        const mgr = new QdrantServerManager(6333, { dataDirectory: tmpDir });
        const key = mgr.getApiKey();
        expect(key).toBeDefined();
        expect(key?.length).toBe(64); // Generated 32-byte hex key
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles checkHealth receiving non-ok HTTP responses", async () => {
      const mgr = new QdrantServerManager(9999, { dataDirectory: "/tmp" });
      // Fetch on unused port throws or fails
      const isHealthy = await (mgr as unknown as { checkHealth(): Promise<boolean> }).checkHealth();
      expect(isHealthy).toBe(false);
    });
  });

  describe("discoverFiles path traversal filtering", () => {
    it("discovers files within canonical root", () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-discover-containment-"));
      try {
        const fileInside = path.join(tmpRoot, "inside.ts");
        fs.writeFileSync(fileInside, "export const x = 1;\n");
        const discovered = discoverFiles(tmpRoot, 10000);
        expect(discovered).toEqual([fileInside]);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it("filters out files whose realpath escapes canonical root", () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-discover-escape-"));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-discover-outside-"));
      try {
        const outsideFile = path.join(outsideDir, "outside.ts");
        fs.writeFileSync(outsideFile, "export const x = 1;\n");
        const symlinkPath = path.join(tmpRoot, "symlink_escape.ts");
        try {
          fs.symlinkSync(outsideFile, symlinkPath);
        } catch {
          // On systems without symlink permissions, ignore
        }

        const discovered = discoverFiles(tmpRoot, 10000);
        expect(discovered).not.toContain(outsideFile);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
