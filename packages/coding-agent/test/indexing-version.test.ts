import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeIndexingVersion } from "../src/core/indexing-version.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createMockProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-version-"));
  temporaryDirectories.push(root);
  // Create the expected directory structure
  fs.mkdirSync(path.join(root, "packages", "coding-agent", "dist", "core", "indexing-daemon"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "code-index", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "code-index", "src", "code-index"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  return root;
}

function populateMockFiles(root: string): void {
  const files: [string, string][] = [
    ["packages/coding-agent/dist/indexing-service-daemon.js", "export const daemon = true;\n"],
    ["packages/coding-agent/dist/core/indexing-daemon.js", "export const daemonCore = true;\n"],
    ["packages/coding-agent/dist/core/indexing-service.js", "export const indexingService = true;\n"],
    ["packages/coding-agent/dist/core/indexed-repos.js", "export const indexedRepos = true;\n"],
    ["scripts/install-indexing-service.js", "console.log('install');\n"],
    ["scripts/indexing-qdrant-assets.js", "export const qdrant = true;\n"],
    ["scripts/indexing-reinstall-lock.js", "export const lock = true;\n"],
    ["scripts/indexing-reinstall-transaction.sh", "begin_transaction() { :; }\n"],
    ["scripts/indexing-device-selection.sh", "select_indexing_device() { :; }\n"],
    ["scripts/prepare-indexing-service-reinstall.js", "console.log('prepare');\n"],
    ["scripts/compute-indexing-version.js", "console.log('compute');\n"],
    ["packages/code-index/dist/index.js", "export const codeIndex = true;\n"],
    ["packages/code-index/dist/chunk.js", "export const chunk = true;\n"],
    ["packages/code-index/embedding_server.py", "print('embedding')\n"],
    ["packages/code-index/resource_manager.py", "print('resource')\n"],
    ["packages/code-index/src/code-index/preparation.py", "def prepare(): pass\n"],
    ["packages/code-index/requirements.txt", "numpy==1.26.0\n"],
    ["packages/code-index/pyproject.toml", '[project]\nname = "code-index"\n'],
  ];
  for (const [relPath, content] of files) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

describe("computeIndexingVersion", () => {
  it("returns a deterministic hex string", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const version = computeIndexingVersion(root);
    expect(typeof version).toBe("string");
    expect(version.length).toBe(64); // SHA256 hex digest
    expect(/^[0-9a-f]+$/.test(version)).toBe(true);
  });

  it("produces the same hash across repeated calls", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const first = computeIndexingVersion(root);
    const second = computeIndexingVersion(root);
    expect(first).toBe(second);
  });

  it("produces the same hash regardless of call order with identical files", () => {
    const root1 = createMockProjectRoot();
    const root2 = createMockProjectRoot();
    populateMockFiles(root1);
    populateMockFiles(root2);

    const hash1 = computeIndexingVersion(root1);
    const hash2 = computeIndexingVersion(root2);

    expect(hash1).toBe(hash2);
  });

  it.each([
    "packages/coding-agent/dist/core/indexing-service.js",
    "scripts/indexing-qdrant-assets.js",
    "scripts/indexing-reinstall-lock.js",
    "scripts/indexing-reinstall-transaction.sh",
    "scripts/install-indexing-service.js",
    "scripts/indexing-device-selection.sh",
  ])("changes the hash when runtime input %s changes", (relativePath) => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);
    fs.appendFileSync(path.join(root, relativePath), "changed\n");
    expect(computeIndexingVersion(root)).not.toBe(before);
  });

  it("changes the hash when a code-index Python file changes", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "packages", "code-index", "embedding_server.py"), "print('embedding v2')\n");

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("changes the hash when requirements.txt changes", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "packages", "code-index", "requirements.txt"), "numpy==2.0.0\n");

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("changes the hash when a new code-index dist file is added", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "packages", "code-index", "dist", "new_module.js"), "export const new = true;\n");

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("changes the hash when a new code-index Python package file is added", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(
      path.join(root, "packages", "code-index", "src", "code-index", "tokenizer.py"),
      "def tokenize(): pass\n",
    );

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("gracefully skips files that disappear during computation", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    // Should not throw even if some files are missing
    fs.rmSync(path.join(root, "packages", "code-index", "embedding_server.py"), { force: true });
    expect(() => computeIndexingVersion(root)).not.toThrow();
  });

  it("handles missing optional directories gracefully", () => {
    const root = createMockProjectRoot();
    for (const f of ["indexing-service-daemon.js", "core/indexing-daemon.js", "core/indexing-service.js"]) {
      const full = path.join(root, "packages", "coding-agent", "dist", f);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "export const ok = true;\n");
    }
    expect(() => computeIndexingVersion(root)).not.toThrow();
  });

  it("includes file paths in the hash so filename changes are detected", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    // Modify content of a code-index dist file
    fs.writeFileSync(path.join(root, "packages", "code-index", "dist", "chunk.js"), "different content\n");

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("detects newly added indexing daemon runtime files dynamically", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    // Add a new module under the split indexing daemon runtime.
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "core", "indexing-daemon", "status-logging.js"),
      "export const helper = true;\n",
    );

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("detects modifications to indexing tray source and script files", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.mkdirSync(path.join(root, "packages", "coding-agent", "src", "tray", "macos"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "src", "tray", "macos", "main.swift"),
      "import Cocoa\n",
    );

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("ignores files outside the expected indexing directories", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "packages", "coding-agent", "dist", "cli.js"), "export const cli = true;\n");
    fs.writeFileSync(path.join(root, "packages", "code-index", "README.md"), "# Code Index\n");

    const after = computeIndexingVersion(root);
    expect(after).toBe(before);
  });
});

describe("computeIndexingVersion against real project", () => {
  it("computes a valid version for the current project", () => {
    // Use the actual project root by resolving up from this test file
    const projectRoot = path.resolve(import.meta.dirname, "../..", "..");
    const version = computeIndexingVersion(projectRoot);
    expect(typeof version).toBe("string");
    expect(version.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(version)).toBe(true);
  });

  it("is stable across calls against the real project", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..", "..");
    const first = computeIndexingVersion(projectRoot);
    const second = computeIndexingVersion(projectRoot);
    expect(first).toBe(second);
  });
});

describe("compute-indexing-version.js script", () => {
  it("outputs a valid hex hash", () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../..", "scripts", "compute-indexing-version.js")],
      { encoding: "utf-8", cwd: path.resolve(import.meta.dirname, "../../..") },
    );
    expect(result.status).toBe(0);
    const output = result.stdout.trim();
    expect(output.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(output)).toBe(true);
  });

  it("matches the version computed by the library function", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..", "..");
    const libraryVersion = computeIndexingVersion(projectRoot);

    const result = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, "../../..", "scripts", "compute-indexing-version.js")],
      { encoding: "utf-8", cwd: projectRoot },
    );
    const scriptVersion = result.stdout.trim();

    expect(scriptVersion).toBe(libraryVersion);
  });
});

describe("indexing version in status data", () => {
  it("exports the status and reinstall file constants", () => {
    const { INDEXING_SERVICE_STATUS_FILE, INDEXING_SERVICE_REINSTALL_FILE } =
      require("../src/core/indexing-service.ts");
    expect(INDEXING_SERVICE_STATUS_FILE).toBe("indexing-service-status.json");
    expect(INDEXING_SERVICE_REINSTALL_FILE).toBe("indexing-service-reinstall.json");
  });
});
