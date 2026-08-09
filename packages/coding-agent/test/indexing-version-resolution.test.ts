import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeIndexingVersion } from "../src/core/indexing-version.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeIndexingVersion project resolution", () => {
  it("resolves the current project when no root is supplied", () => {
    expect(computeIndexingVersion()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to the agent directory when no project root is discoverable", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    expect(computeIndexingVersion()).toMatch(/^[0-9a-f]{64}$/);
  });
});
