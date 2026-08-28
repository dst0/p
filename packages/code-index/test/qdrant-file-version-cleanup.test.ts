import { describe, expect, it, vi } from "vitest";
import { QdrantVectorStore } from "../src/rag/vector-store.ts";

function createStoreClient() {
  return {
    scroll: vi.fn(),
    delete: vi.fn(async () => {}),
    deletePoints: vi.fn(async () => {}),
  };
}

function storeWithClient(client: ReturnType<typeof createStoreClient>): QdrantVectorStore {
  const store = new QdrantVectorStore({ url: "http://127.0.0.1:6333", timeoutMs: 10_000 });
  (store as unknown as { client: typeof client }).client = client;
  return store;
}

describe("Qdrant file-version cleanup", () => {
  it("scrolls by indexed file identity and deletes only obsolete point IDs", async () => {
    const client = createStoreClient();
    client.scroll
      .mockResolvedValueOnce({
        points: [
          { id: "current", payload: { fileHash: "keep-hash" } },
          { id: "old-1", payload: { fileHash: "old-hash" } },
        ],
        next_page_offset: "old-1",
      })
      .mockResolvedValueOnce({
        points: [{ id: "old-2", payload: { fileHash: "older-hash" } }],
        next_page_offset: null,
      });
    const store = storeWithClient(client);

    await store.deleteFileVersions("coll", "repo", "file1", "keep-hash");

    expect(client.scroll).toHaveBeenNthCalledWith(
      1,
      "coll",
      {
        limit: 256,
        filter: {
          must: [
            { key: "repoId", match: { value: "repo" } },
            { key: "fileId", match: { value: "file1" } },
          ],
        },
        with_payload: true,
        with_vector: false,
      },
      undefined,
    );
    expect(client.deletePoints).toHaveBeenCalledWith("coll", { wait: true, points: ["old-1", "old-2"] });
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("does not issue a delete when every point has the retained hash", async () => {
    const client = createStoreClient();
    client.scroll.mockResolvedValue({
      points: [{ id: "current", payload: { fileHash: "keep-hash" } }],
      next_page_offset: null,
    });

    await storeWithClient(client).deleteFileVersions("coll", "repo", "file1", "keep-hash");

    expect(client.deletePoints).not.toHaveBeenCalled();
  });

  it("fails closed before deletion when a stored hash is invalid", async () => {
    const client = createStoreClient();
    client.scroll.mockResolvedValue({ points: [{ id: "unknown", payload: {} }], next_page_offset: null });

    await expect(storeWithClient(client).deleteFileVersions("coll", "repo", "file1", "keep-hash")).rejects.toThrow(
      "invalid fileHash",
    );
    expect(client.deletePoints).not.toHaveBeenCalled();
  });

  it("fails closed before deletion when a point identity is invalid", async () => {
    const client = createStoreClient();
    client.scroll.mockResolvedValue({
      points: [{ id: true, payload: { fileHash: "old-hash" } }],
      next_page_offset: null,
    });

    await expect(storeWithClient(client).deleteFileVersions("coll", "repo", "file1", "keep-hash")).rejects.toThrow(
      "invalid point ID",
    );
    expect(client.deletePoints).not.toHaveBeenCalled();
  });

  it("fails closed before deletion when pagination returns an invalid offset", async () => {
    const client = createStoreClient();
    client.scroll.mockResolvedValue({
      points: [{ id: "old", payload: { fileHash: "old-hash" } }],
      next_page_offset: { invalid: true },
    });

    await expect(storeWithClient(client).deleteFileVersions("coll", "repo", "file1", "keep-hash")).rejects.toThrow(
      "invalid offset",
    );
    expect(client.deletePoints).not.toHaveBeenCalled();
  });
});
