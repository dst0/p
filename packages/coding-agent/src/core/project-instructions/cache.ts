import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertCacheDirectorySafe,
  assertNotSymlink,
  assertPathComponentsNotSymlinks,
  ensurePrivateDirectory,
  hasFileSystemCode,
  readRegularFile,
  writePrivateFile,
} from "./cache-safety.ts";
import { hashText } from "./content.ts";
import { computeProjectInstructionResultHash, parseProjectInstructionManifest } from "./manifest.ts";
import { getProjectInstructionFallbackPath } from "./paths.ts";
import type {
  PreparedProjectInstructions,
  ProjectInstructionCatalogOutput,
  ProjectInstructionManifest,
  ProjectInstructionModuleInput,
  ProjectInstructionSkillRecord,
  ProjectInstructionSourceRecord,
} from "./types.ts";

interface ProjectInstructionCacheExpectation {
  sources: ProjectInstructionSourceRecord[];
  modules: ProjectInstructionModuleInput[];
  skills: ProjectInstructionSkillRecord[];
}

interface LoadProjectInstructionsOptions {
  cacheDir: string;
  workspaceRoot: string;
  agentsHash: string;
  inputHash: string;
  compilerVersion: string;
  expected: ProjectInstructionCacheExpectation;
}

interface PersistProjectInstructionsOptions extends LoadProjectInstructionsOptions {
  prompt: string;
  manifest: ProjectInstructionManifest;
  rulesCatalog: ProjectInstructionCatalogOutput;
  skillsCatalog: ProjectInstructionCatalogOutput;
}

interface CurrentPointer {
  schemaVersion: 1;
  agentsHash: string;
  inputHash: string;
  version: string;
}

export function loadCachedProjectInstructions(
  options: LoadProjectInstructionsOptions,
): PreparedProjectInstructions | undefined {
  try {
    assertCacheDirectorySafe(options.cacheDir, options.workspaceRoot, false);
    const current = parseCurrentPointer(JSON.parse(readRegularFile(join(options.cacheDir, "current.json"))) as unknown);
    if (!current || current.agentsHash !== options.agentsHash || current.inputHash !== options.inputHash) {
      return undefined;
    }
    const prepared = loadVersion(options, current.version);
    if (!prepared || !hasValidFallbackGuide(prepared)) return undefined;
    return prepared;
  } catch {
    return undefined;
  }
}

export function persistProjectInstructions(options: PersistProjectInstructionsOptions): PreparedProjectInstructions {
  const { cacheDir, manifest } = options;
  assertCacheDirectorySafe(cacheDir, options.workspaceRoot, true);
  const versionsDir = join(cacheDir, "versions");
  ensurePrivateDirectory(versionsDir);
  const version = `${manifest.inputHash}-${manifest.resultHash}`;
  const versionDir = join(versionsDir, version);
  const temporaryDir = join(versionsDir, `.tmp-${version}-${process.pid}-${randomUUID()}`);
  ensurePrivateDirectory(temporaryDir);
  let quarantineDir: string | undefined;
  try {
    writeVersionFiles(temporaryDir, options);
    if (existsSync(versionDir) && !loadVersion(options, version)) {
      quarantineDir = join(versionsDir, `.invalid-${version}-${process.pid}-${randomUUID()}`);
      try {
        renameSync(versionDir, quarantineDir);
      } catch (error) {
        if (!hasFileSystemCode(error, "ENOENT")) throw error;
        quarantineDir = undefined;
      }
    }
    installVersion(options, version, temporaryDir);
    const prepared = loadVersion(options, version);
    if (!prepared) throw new Error("Persisted project instruction cache failed validation");
    writeFallbackGuide(prepared);
    writeCurrentPointer(cacheDir, manifest, version);
    return prepared;
  } finally {
    if (existsSync(temporaryDir)) rmSync(temporaryDir, { recursive: true, force: true });
    if (quarantineDir && existsSync(quarantineDir)) rmSync(quarantineDir, { recursive: true, force: true });
  }
}

function writeVersionFiles(versionDir: string, options: PersistProjectInstructionsOptions): void {
  ensurePrivateDirectory(join(versionDir, "rules"));
  ensurePrivateDirectory(join(versionDir, "skills"));
  writePrivateFile(join(versionDir, options.manifest.promptFile), options.prompt);
  writePrivateFile(join(versionDir, options.manifest.rulesCatalogFile), options.rulesCatalog.root);
  writePrivateFile(join(versionDir, options.manifest.skillsCatalogFile), options.skillsCatalog.root);
  writeCatalogPages(versionDir, options.rulesCatalog);
  writeCatalogPages(versionDir, options.skillsCatalog);
  const contentById = new Map(options.expected.modules.map((module) => [module.id, module.content]));
  for (const rule of options.manifest.rules) {
    const content = contentById.get(rule.id);
    if (content === undefined || hashText(content) !== rule.contentHash) {
      throw new Error(`Instruction module ${rule.id} does not match its manifest`);
    }
    writePrivateFile(join(versionDir, rule.file), content);
  }
  writePrivateFile(join(versionDir, "manifest.json"), `${JSON.stringify(options.manifest, null, 2)}\n`);
}

function writeCatalogPages(versionDir: string, catalog: ProjectInstructionCatalogOutput): void {
  for (const page of catalog.pages) {
    ensurePrivateDirectory(resolve(versionDir, page.link, ".."));
    writePrivateFile(join(versionDir, page.link), page.content);
  }
}

function installVersion(options: LoadProjectInstructionsOptions, version: string, temporaryDir: string): void {
  const versionDir = join(options.cacheDir, "versions", version);
  if (existsSync(versionDir)) {
    const winner = loadVersion(options, version);
    if (winner) return;
  }
  try {
    renameSync(temporaryDir, versionDir);
  } catch (error) {
    if (!hasFileSystemCode(error, "EEXIST") && !hasFileSystemCode(error, "ENOTEMPTY")) throw error;
    const winner = loadVersion(options, version);
    if (!winner) throw error;
  }
}

function loadVersion(
  options: LoadProjectInstructionsOptions,
  version: string,
): PreparedProjectInstructions | undefined {
  if (!/^[a-f0-9]{64}-[a-f0-9]{64}$/u.test(version)) return undefined;
  try {
    const versionDir = join(options.cacheDir, "versions", version);
    assertNotSymlink(versionDir);
    const manifest = parseProjectInstructionManifest(
      JSON.parse(readSafeVersionFile(versionDir, "manifest.json")) as unknown,
    );
    if (
      !manifest ||
      manifest.agentsHash !== options.agentsHash ||
      manifest.inputHash !== options.inputHash ||
      manifest.compilerVersion !== options.compilerVersion ||
      version !== `${manifest.inputHash}-${manifest.resultHash}` ||
      !matchesExpectedInputs(manifest, options.expected)
    ) {
      return undefined;
    }
    const prompt = readSafeVersionFile(versionDir, manifest.promptFile);
    const rulesCatalog = readSafeVersionFile(versionDir, manifest.rulesCatalogFile);
    const skillsCatalog = readSafeVersionFile(versionDir, manifest.skillsCatalogFile);
    if (
      hashText(prompt) !== manifest.promptHash ||
      hashText(rulesCatalog) !== manifest.rulesCatalogHash ||
      hashText(skillsCatalog) !== manifest.skillsCatalogHash
    ) {
      return undefined;
    }
    for (const page of [...manifest.rulesCatalogPages, ...manifest.skillsCatalogPages]) {
      if (hashText(readSafeVersionFile(versionDir, page.file)) !== page.contentHash) return undefined;
    }
    for (const rule of manifest.rules) {
      if (hashText(readSafeVersionFile(versionDir, rule.file)) !== rule.contentHash) return undefined;
    }
    if (computeProjectInstructionResultHash(manifest) !== manifest.resultHash) return undefined;
    return { prompt, manifest, cacheDir: options.cacheDir, versionDir };
  } catch {
    return undefined;
  }
}

function matchesExpectedInputs(
  manifest: ProjectInstructionManifest,
  expected: ProjectInstructionCacheExpectation,
): boolean {
  if (JSON.stringify(manifest.sources) !== JSON.stringify(expected.sources)) return false;
  if (JSON.stringify(manifest.skills) !== JSON.stringify(expected.skills)) return false;
  if (manifest.rules.length !== expected.modules.length) return false;
  return manifest.rules.every((rule, index) => {
    const module = expected.modules[index];
    return (
      rule.id === module.id &&
      rule.link === module.link &&
      rule.file === module.link &&
      rule.title === module.title &&
      rule.sourcePath === module.sourcePath &&
      rule.contentHash === hashText(module.content)
    );
  });
}

function readSafeVersionFile(versionDir: string, relativePath: string): string {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/u).some((part) => !part || part === ".." || part === ".")) {
    throw new Error("Invalid project instruction cache path");
  }
  const target = resolve(versionDir, relativePath);
  const root = realpathSync(versionDir);
  const realTarget = realpathSync(target);
  const fromRoot = relative(root, realTarget);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error("Project instruction cache path escapes its version directory");
  }
  assertPathComponentsNotSymlinks(root, relativePath);
  return readRegularFile(realTarget);
}

function writeFallbackGuide(prepared: PreparedProjectInstructions): void {
  const inputDir = join(prepared.cacheDir, "inputs", prepared.manifest.inputHash);
  ensurePrivateDirectory(inputDir);
  const target = getProjectInstructionFallbackPath(prepared.cacheDir, prepared.manifest.inputHash);
  if (existsSync(target)) assertNotSymlink(target);
  const temporary = join(inputDir, `.fallback-${process.pid}-${randomUUID()}.tmp`);
  writePrivateFile(temporary, renderFallbackGuide(prepared));
  renameSync(temporary, target);
}

function hasValidFallbackGuide(prepared: PreparedProjectInstructions): boolean {
  try {
    return (
      readRegularFile(getProjectInstructionFallbackPath(prepared.cacheDir, prepared.manifest.inputHash)) ===
      renderFallbackGuide(prepared)
    );
  } catch {
    return false;
  }
}

function renderFallbackGuide(prepared: PreparedProjectInstructions): string {
  const lines = [
    "# Ordinary-read project instruction fallback",
    "",
    `Input SHA-256: ${prepared.manifest.inputHash}`,
    `Immutable cache version: ${prepared.versionDir}`,
    `Physical rule catalog: ${join(prepared.versionDir, prepared.manifest.rulesCatalogFile)}`,
    `Physical skill catalog: ${join(prepared.versionDir, prepared.manifest.skillsCatalogFile)}`,
    "",
    "## Authoritative instruction sources",
    ...prepared.manifest.sources.map((source) => `- ${source.path}`),
    "",
    "## Authoritative skill roots",
    ...prepared.manifest.skills.map((skill) => `- ${skill.name}: ${skill.filePath}`),
    "",
    "Resolve relative catalog page and module links from the immutable cache version directory.",
  ];
  return `${lines.join("\n")}\n`;
}

function writeCurrentPointer(cacheDir: string, manifest: ProjectInstructionManifest, version: string): void {
  const current: CurrentPointer = {
    schemaVersion: 1,
    agentsHash: manifest.agentsHash,
    inputHash: manifest.inputHash,
    version,
  };
  const currentPath = join(cacheDir, "current.json");
  if (existsSync(currentPath)) assertNotSymlink(currentPath);
  const temporary = join(cacheDir, `.current-${process.pid}-${randomUUID()}.tmp`);
  writePrivateFile(temporary, `${JSON.stringify(current, null, 2)}\n`);
  renameSync(temporary, currentPath);
}

function parseCurrentPointer(value: unknown): CurrentPointer | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const current = value as Record<string, unknown>;
  if (
    current.schemaVersion !== 1 ||
    typeof current.agentsHash !== "string" ||
    typeof current.inputHash !== "string" ||
    typeof current.version !== "string"
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    agentsHash: current.agentsHash,
    inputHash: current.inputHash,
    version: current.version,
  };
}
