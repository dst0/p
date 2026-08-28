import { describe, expect, it } from "vitest";
import {
  createQdrantCollectionName,
  getQdrantCollectionCreatedAt,
  normalizeQdrantCollectionPrefix,
} from "../src/rag/collection-names.ts";

describe("Qdrant managed collection names", () => {
  it("normalizes ownership fields and recovers the generation creation time", () => {
    const createdAt = Date.UTC(2026, 7, 28, 12, 0, 0);
    const prefix = `p code/chunks-${"x".repeat(40)}`;
    const generation = `${createdAt.toString(36)}-abcdef12`;
    const collection = createQdrantCollectionName(prefix, "a".repeat(64), generation);

    expect(normalizeQdrantCollectionPrefix(prefix)).toHaveLength(32);
    expect(collection).toBe(`${normalizeQdrantCollectionPrefix(prefix)}_${"a".repeat(16)}_${generation}`);
    expect(getQdrantCollectionCreatedAt(collection, prefix)).toBe(createdAt);
    expect(createQdrantCollectionName("prefix", "b".repeat(64), "generation with spaces!")).toBe(
      `prefix_${"b".repeat(16)}_generation_with_spaces_`,
    );
  });

  it.each([
    ["foreign namespace", `other_${"a".repeat(16)}_abc-abcdef12`],
    ["invalid repository identity", `managed_${"A".repeat(16)}_abc-abcdef12`],
    ["invalid random suffix", `managed_${"a".repeat(16)}_abc-short`],
    ["zero timestamp", `managed_${"a".repeat(16)}_0-abcdef12`],
    ["unsafe timestamp", `managed_${"a".repeat(16)}_${"z".repeat(30)}-abcdef12`],
  ])("rejects a non-owned or malformed collection: %s", (_case, collection) => {
    expect(getQdrantCollectionCreatedAt(collection, "managed")).toBeUndefined();
  });
});
