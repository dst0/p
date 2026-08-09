import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeIndexingVersion } from "../src/core/indexing-version.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Apple Core AI indexing version inputs", () => {
  it("tracks the installer, Python discovery, and pinned runtime requirements", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-coreai-version-"));
    temporaryDirectories.push(root);
    const scripts = path.join(root, "scripts");
    const codeIndex = path.join(root, "packages", "code-index");
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(codeIndex, { recursive: true });
    const files = [
      path.join(scripts, "install-apple-coreai.js"),
      path.join(scripts, "indexing-python-discovery.js"),
      path.join(codeIndex, "requirements-coreai.txt"),
    ];
    for (const file of files) fs.writeFileSync(file, "version-one\n");
    const baseline = computeIndexingVersion(root);

    for (const file of files) {
      fs.writeFileSync(file, "version-two\n");
      expect(computeIndexingVersion(root), file).not.toBe(baseline);
      fs.writeFileSync(file, "version-one\n");
    }
  });
});
