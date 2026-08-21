import type * as NodeFs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProjectInstructions } from "../src/core/project-instructions/index.ts";
import { getProjectInstructionFallbackPath } from "../src/core/project-instructions/paths.ts";

type RenameSync = typeof NodeFs.renameSync;

const renameHarness = vi.hoisted(() => ({
  actual: undefined as RenameSync | undefined,
  renameSync: vi.fn<RenameSync>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  renameHarness.actual = actual.renameSync;
  renameHarness.renameSync.mockImplementation(actual.renameSync);
  return { ...actual, renameSync: renameHarness.renameSync };
});

const temporaryDirectories: string[] = [];

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "p-project-cache-rename-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  const agentsPath = join(root, "AGENTS.md");
  const content = "# Rules\n\nAlways validate an atomic-install winner.\n";
  writeFileSync(agentsPath, content);
  return {
    cwd: root,
    cacheDir: join(root, ".pdev", "instructions"),
    contextFiles: [{ path: agentsPath, content }],
    skills: [],
  };
}

function injectInstallFailure(code: "EACCES" | "EPERM"): () => boolean {
  const actual = renameHarness.actual;
  if (!actual) throw new Error("Missing real renameSync implementation");
  let injected = false;
  renameHarness.renameSync.mockImplementation((source, target) => {
    if (!injected && basename(String(source)).startsWith(".tmp-") && basename(dirname(String(target))) === "versions") {
      injected = true;
      const error = new Error(`Install failed with ${code}`) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    }
    return actual(source, target);
  });
  return () => injected;
}

function injectQuarantineFailure(code: "EACCES" | "ENOENT"): () => boolean {
  const actual = renameHarness.actual;
  if (!actual) throw new Error("Missing real renameSync implementation");
  let injected = false;
  renameHarness.renameSync.mockImplementation((source, target) => {
    if (!injected && basename(String(target)).startsWith(".invalid-")) {
      injected = true;
      if (code === "ENOENT") rmSync(String(source), { recursive: true, force: true });
      const error = new Error(`Quarantine failed with ${code}`) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    }
    return actual(source, target);
  });
  return () => injected;
}

beforeEach(() => {
  const actual = renameHarness.actual;
  if (!actual) throw new Error("Missing real renameSync implementation");
  renameHarness.renameSync.mockReset();
  renameHarness.renameSync.mockImplementation(actual);
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project instruction atomic cache installation", () => {
  it("accepts a valid deterministic winner after a Windows-style destination collision", async () => {
    const options = createWorkspace();
    const first = await prepareProjectInstructions(options);
    rmSync(getProjectInstructionFallbackPath(first.cacheDir, first.manifest.inputHash));
    const wasInjected = injectInstallFailure("EPERM");

    const recovered = await prepareProjectInstructions(options);

    expect(wasInjected()).toBe(true);
    expect(recovered.prompt).toBe(first.prompt);
    expect(recovered.versionDir).toBe(first.versionDir);
  });

  it("publishes no version or pointer when installation fails without a valid winner", async () => {
    const options = createWorkspace();
    const wasInjected = injectInstallFailure("EACCES");

    await expect(prepareProjectInstructions(options)).rejects.toThrow(/Install failed with EACCES/u);

    expect(wasInjected()).toBe(true);
    expect(readdirSync(join(options.cacheDir, "versions"))).toEqual([]);
    expect(existsSync(join(options.cacheDir, "current.json"))).toBe(false);
  });

  it("recovers when another writer removes an invalid version before quarantine", async () => {
    const options = createWorkspace();
    const first = await prepareProjectInstructions(options);
    writeFileSync(join(first.versionDir, "manifest.json"), "{}\n");
    const wasInjected = injectQuarantineFailure("ENOENT");

    const recovered = await prepareProjectInstructions(options);

    expect(wasInjected()).toBe(true);
    expect(recovered.prompt).toBe(first.prompt);
    expect(recovered.versionDir).toBe(first.versionDir);
  });

  it("fails closed when an invalid version cannot be quarantined", async () => {
    const options = createWorkspace();
    const first = await prepareProjectInstructions(options);
    writeFileSync(join(first.versionDir, "manifest.json"), "{}\n");
    const wasInjected = injectQuarantineFailure("EACCES");

    await expect(prepareProjectInstructions(options)).rejects.toThrow(/Quarantine failed with EACCES/u);
    expect(wasInjected()).toBe(true);
  });
});
