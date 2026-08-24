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

function createMockProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-runtime-deps-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, "packages", "coding-agent", "dist", "core"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "code-index", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "packages", "coding-agent", "dist", "core", "indexing-service.js"),
    "export const service = true;\n",
  );
  fs.writeFileSync(path.join(root, "scripts", "bounded-process-command.js"), "export const helperVersion = 1;\n");
  return root;
}

describe("indexing-version runtime dependencies", () => {
  it("changes computeIndexingVersion when bounded-process-command.js changes", () => {
    const root = createMockProjectRoot();
    const versionBefore = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "scripts", "bounded-process-command.js"), "export const helperVersion = 2;\n");

    const versionAfter = computeIndexingVersion(root);
    expect(versionAfter).not.toBe(versionBefore);
    expect(typeof versionAfter).toBe("string");
    expect(versionAfter.length).toBe(64);
  });

  it("changes computeIndexingVersion when indexing-python-environment.js changes", () => {
    const root = createMockProjectRoot();
    fs.writeFileSync(path.join(root, "scripts", "indexing-python-environment.js"), "export const scriptVersion = 1;\n");
    const versionBefore = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "scripts", "indexing-python-environment.js"), "export const scriptVersion = 2;\n");

    const versionAfter = computeIndexingVersion(root);
    expect(versionAfter).not.toBe(versionBefore);
    expect(typeof versionAfter).toBe("string");
    expect(versionAfter.length).toBe(64);
  });

  it("changes computeIndexingVersion when apple-coreai-generation-path.js changes", () => {
    const root = createMockProjectRoot();
    fs.writeFileSync(path.join(root, "scripts", "apple-coreai-generation-path.js"), "export const scriptVersion = 1;\n");
    const versionBefore = computeIndexingVersion(root);

    fs.writeFileSync(path.join(root, "scripts", "apple-coreai-generation-path.js"), "export const scriptVersion = 2;\n");

    const versionAfter = computeIndexingVersion(root);
    expect(versionAfter).not.toBe(versionBefore);
    expect(typeof versionAfter).toBe("string");
    expect(versionAfter.length).toBe(64);
  });

  it("includes scripts/bounded-process-command.js in real project version computation", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..", "..");
    const boundedPath = path.join(projectRoot, "scripts", "bounded-process-command.js");
    expect(fs.existsSync(boundedPath)).toBe(true);

    const realVersion = computeIndexingVersion(projectRoot);
    expect(typeof realVersion).toBe("string");
    expect(realVersion.length).toBe(64);
  });

  it("includes scripts/apple-coreai-generation-path.js in real project version computation", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..", "..");
    const helperPath = path.join(projectRoot, "scripts", "apple-coreai-generation-path.js");
    expect(fs.existsSync(helperPath)).toBe(true);

    const realVersion = computeIndexingVersion(projectRoot);
    expect(typeof realVersion).toBe("string");
    expect(realVersion.length).toBe(64);
  });

  it("includes scripts/indexing-python-environment.js in real project version computation", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..", "..");
    const envPath = path.join(projectRoot, "scripts", "indexing-python-environment.js");
    expect(fs.existsSync(envPath)).toBe(true);

    const realVersion = computeIndexingVersion(projectRoot);
    expect(typeof realVersion).toBe("string");
    expect(realVersion.length).toBe(64);
  });
});
