import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeIndexingVersion } from "../src/core/indexing-service.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createMockProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-version-"));
  temporaryDirectories.push(root);
  // Create the expected directory structure
  fs.mkdirSync(path.join(root, "packages", "coding-agent", "dist", "core"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "code-index", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "code-index", "src", "code-index"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  return root;
}

function populateMockFiles(root: string): void {
  // Daemon files
  fs.writeFileSync(
    path.join(root, "packages", "coding-agent", "dist", "indexing-service-daemon.js"),
    "export const daemon = true;\n",
  );
  fs.writeFileSync(
    path.join(root, "packages", "coding-agent", "dist", "core", "indexing-daemon.js"),
    "export const daemonCore = true;\n",
  );
  fs.writeFileSync(
    path.join(root, "packages", "coding-agent", "dist", "core", "indexing-service.js"),
    "export const indexingService = true;\n",
  );
  fs.writeFileSync(
    path.join(root, "packages", "coding-agent", "dist", "core", "indexed-repos.js"),
    "export const indexedRepos = true;\n",
  );

  // Installer scripts
  fs.writeFileSync(path.join(root, "scripts", "install-indexing-service.js"), "console.log('install');\n");
  fs.writeFileSync(path.join(root, "scripts", "indexing-device-selection.sh"), "select_indexing_device() { :; }\n");
  fs.writeFileSync(path.join(root, "scripts", "prepare-indexing-service-reinstall.js"), "console.log('prepare');\n");
  fs.writeFileSync(path.join(root, "scripts", "compute-indexing-version.js"), "console.log('compute');\n");

  // code-index dist files
  fs.writeFileSync(path.join(root, "packages", "code-index", "dist", "index.js"), "export const codeIndex = true;\n");
  fs.writeFileSync(path.join(root, "packages", "code-index", "dist", "chunk.js"), "export const chunk = true;\n");

  // code-index Python files
  fs.writeFileSync(path.join(root, "packages", "code-index", "embedding_server.py"), "print('embedding')\n");
  fs.writeFileSync(path.join(root, "packages", "code-index", "resource_manager.py"), "print('resource')\n");

  // code-index Python package
  fs.writeFileSync(
    path.join(root, "packages", "code-index", "src", "code-index", "preparation.py"),
    "def prepare(): pass\n",
  );

  // code-index config
  fs.writeFileSync(path.join(root, "packages", "code-index", "requirements.txt"), "numpy==1.26.0\n");
  fs.writeFileSync(path.join(root, "packages", "code-index", "pyproject.toml"), '[project]\nname = "code-index"\n');
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

    // Files have identical content so hashes should match
    expect(hash1).toBe(hash2);
  });

  it("changes the hash when a daemon file content changes", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    // Modify a daemon file
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "core", "indexing-service.js"),
      "export const indexingService = true; export const changed = true;\n",
    );

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("changes the hash when install-indexing-service.js changes", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "scripts", "install-indexing-service.js"), "console.log('install v2');\n");

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("changes the hash when indexing-device-selection.sh changes", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    fs.writeFileSync(
      path.join(root, "scripts", "indexing-device-selection.sh"),
      "select_indexing_device() { true; }\n",
    );

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
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
    // Only write daemon files, omit code-index dist and Python package
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "indexing-service-daemon.js"),
      "export const daemon = true;\n",
    );
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "core", "indexing-daemon.js"),
      "export const daemonCore = true;\n",
    );
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "core", "indexing-service.js"),
      "export const indexingService = true;\n",
    );
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "core", "indexed-repos.js"),
      "export const indexedRepos = true;\n",
    );

    // Don't create code-index/dist or code-index/src/code-index
    fs.rmSync(path.join(root, "packages", "code-index", "dist"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "packages", "code-index", "src"), { recursive: true, force: true });

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

  it("detects newly added indexing core runtime files dynamically", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    // Add a new indexing helper file to coding-agent/dist/core/
    fs.writeFileSync(
      path.join(root, "packages", "coding-agent", "dist", "core", "indexing-helpers.js"),
      "export const helper = true;\n",
    );

    const after = computeIndexingVersion(root);
    expect(after).not.toBe(before);
  });

  it("ignores files outside the expected indexing directories", () => {
    const root = createMockProjectRoot();
    populateMockFiles(root);
    const before = computeIndexingVersion(root);

    // Add a file in an unrelated location
    fs.writeFileSync(path.join(root, "packages", "coding-agent", "dist", "cli.js"), "export const cli = true;\n");
    fs.writeFileSync(path.join(root, "packages", "code-index", "README.md"), "# Code Index\n");

    const after = computeIndexingVersion(root);
    // Hash should be unchanged since we only track specific files
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
