import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeIndexingVersion } from "../src/core/indexing-version.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("indexing runtime version inputs", () => {
  it("tracks daemon health verification changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-runtime-version-"));
    temporaryDirectories.push(root);
    const scriptsDirectory = path.join(root, "scripts");
    fs.mkdirSync(scriptsDirectory, { recursive: true });
    const healthScript = path.join(scriptsDirectory, "indexing-service-health.js");
    fs.writeFileSync(healthScript, "export const healthy = true;\n");
    const before = computeIndexingVersion(root);

    fs.writeFileSync(healthScript, "export const healthy = false;\n");

    expect(computeIndexingVersion(root)).not.toBe(before);
  });
});
