import { describe, expect, it } from "vitest";
import { isIgnoredWatchPath } from "../src/core/indexing-daemon/helpers.ts";

describe("indexing daemon path filtering", () => {
  it.each([
    ".git",
    "src/node_modules/package/index.ts",
    "src\\node_modules\\package\\index.ts",
    "/workspace/coverage/report.json",
    "build/output.js",
    "nested/.venv/bin/python",
  ])("ignores a configured path segment in %s", (filename) => {
    expect(isIgnoredWatchPath(filename)).toBe(true);
  });

  it.each([
    ".github/workflows/ci.yml",
    "src/node_modules-cache/index.ts",
    "src/distilled/index.ts",
    "targeted/file.ts",
    "storage-adapter/index.ts",
  ])("does not ignore a partial segment match in %s", (filename) => {
    expect(isIgnoredWatchPath(filename)).toBe(false);
  });
});
