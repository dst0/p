import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../src/config.ts";
import { CodeIndexer } from "../src/indexer.ts";
import { QdrantClient } from "../src/qdrant.ts";

/** Lets every promise continuation and I/O callback queued by a constructor run before asserting. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

describe("QdrantClient construction side effects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not issue a network request or console write when constructed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network access is not allowed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    new QdrantClient(createConfig());
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not issue a network request or console write when a CodeIndexer is constructed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network access is not allowed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    new CodeIndexer();
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("still sends real requests when a method is called", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network access is not allowed"));
    const client = new QdrantClient(createConfig());

    await expect(client.getStatus()).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalled();
  });
});
