import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "./benchmark-project-instruction-diagnostics.js";
import { parseCompiledProjectInstructionMarker } from "./benchmark-project-instruction-marker.js";
import { computeAuthorizedProjectInstructionPromptHashes } from "./benchmark-project-instruction-prompt-projection.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^[a-f0-9]{64}-[a-f0-9]{64}$/u;

export function captureVerifiedCompiledCache(workspace, sourceSha256) {
  try {
    const cacheDir = join(workspace, ".pdev", "instructions");
    const cacheStats = lstatSync(cacheDir);
    if (!cacheStats.isDirectory() || cacheStats.isSymbolicLink()) return undefined;
    const current = JSON.parse(readFileSync(join(cacheDir, "current.json"), "utf8"));
    if (!isCurrent(current)) return undefined;
    const versionDir = join(cacheDir, "versions", current.version);
    const manifest = JSON.parse(readArtifact(versionDir, "manifest.json"));
    if (!isManifest(manifest) || current.version !== `${manifest.inputHash}-${manifest.resultHash}`) return undefined;
    if (
      current.agentsHash !== manifest.agentsHash ||
      current.inputHash !== manifest.inputHash ||
      computeBenchmarkProjectInstructionResultHash(manifest) !== manifest.resultHash
    ) {
      return undefined;
    }
    const prompt = readArtifact(versionDir, manifest.promptFile);
    if (
      hashText(prompt) !== manifest.promptHash ||
      hashText(readArtifact(versionDir, manifest.rulesCatalogFile)) !== manifest.rulesCatalogHash ||
      hashText(readArtifact(versionDir, manifest.skillsCatalogFile)) !== manifest.skillsCatalogHash
    ) {
      return undefined;
    }
    for (const page of [...manifest.rulesCatalogPages, ...manifest.skillsCatalogPages]) {
      if (hashText(readArtifact(versionDir, page.file)) !== page.contentHash) return undefined;
    }
    for (const rule of manifest.rules) {
      if (hashText(readArtifact(versionDir, rule.file)) !== rule.contentHash) return undefined;
    }
    const promptMarker = parseCompiledProjectInstructionMarker(prompt);
    const authorizedPromptHashes = computeAuthorizedProjectInstructionPromptHashes(prompt);
    if (!authorizedPromptHashes) return undefined;
    const expectedSourcePath = realpathSync(join(workspace, "AGENTS.md"));
    const sourceHashes = manifest.sources.map((source) => source.contentHash);
    const expectedSources = manifest.sources.filter(
      (source) => realpathSync(source.path) === expectedSourcePath && source.contentHash === sourceSha256,
    );
    return {
      evidence: {
        current: {
          schemaVersion: current.schemaVersion,
          agentsHash: current.agentsHash,
          inputHash: current.inputHash,
          version: current.version,
        },
        manifest: {
          schemaVersion: manifest.schemaVersion,
          compilerVersion: manifest.compilerVersion,
          agentsHash: manifest.agentsHash,
          inputHash: manifest.inputHash,
          resultHash: manifest.resultHash,
          promptHash: manifest.promptHash,
          rulesCatalogHash: manifest.rulesCatalogHash,
          skillsCatalogHash: manifest.skillsCatalogHash,
          mode: manifest.mode,
          compilerStatus: manifest.compilerStatus,
          compilerDiagnostic: manifest.compilerDiagnostic,
          compilerUsage: manifest.compilerUsage
            ? {
                input: manifest.compilerUsage.input,
                output: manifest.compilerUsage.output,
                cacheRead: manifest.compilerUsage.cacheRead,
                cacheWrite: manifest.compilerUsage.cacheWrite,
                total: manifest.compilerUsage.total,
              }
            : undefined,
          sourceHashes,
        },
        promptBytes: Buffer.byteLength(prompt, "utf8"),
        authorizedPromptHashes,
        promptHashVerified: true,
        promptMarkerVerified:
          promptMarker?.agentsSha256 === manifest.agentsHash &&
          promptMarker.inputSha256 === manifest.inputHash &&
          promptMarker.mode === manifest.mode,
        sourceHashVerified:
          expectedSources.length === 1 && hashText(readFileSync(expectedSourcePath, "utf8")) === sourceSha256,
        currentMatchesManifest: true,
        artifactClosureVerified: true,
        cacheClosureSha256: hashCacheClosure(cacheDir),
      },
      rules: manifest.rules.map((rule) => ({
        id: rule.id,
        link: rule.link,
        file: rule.file,
        title: rule.title,
        trigger: rule.trigger,
        routable: rule.routable,
        sourcePath: rule.sourcePath,
        contentHash: rule.contentHash,
      })),
    };
  } catch {
    return undefined;
  }
}

function hashCacheClosure(root) {
  const canonicalRoot = realpathSync(root);
  const files = listCacheFiles(canonicalRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(canonicalRoot, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listCacheFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile()) || (stats.isFile() && stats.nlink !== 1)) {
      throw new Error("unsafe cache artifact");
    }
    if (stats.isDirectory()) files.push(...listCacheFiles(root, path));
    else files.push(relative(root, path));
  }
  return files.toSorted();
}

export function computeBenchmarkProjectInstructionResultHash(manifest) {
  return hashText(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      compilerVersion: manifest.compilerVersion,
      agentsHash: manifest.agentsHash,
      inputHash: manifest.inputHash,
      promptHash: manifest.promptHash,
      rulesCatalogHash: manifest.rulesCatalogHash,
      skillsCatalogHash: manifest.skillsCatalogHash,
      rulesCatalogPages: manifest.rulesCatalogPages,
      skillsCatalogPages: manifest.skillsCatalogPages,
      mode: manifest.mode,
      compilerStatus: manifest.compilerStatus,
      compilerDiagnostic: manifest.compilerDiagnostic,
      compilerUsage: manifest.compilerUsage,
      promptFile: manifest.promptFile,
      rulesCatalogFile: manifest.rulesCatalogFile,
      skillsCatalogFile: manifest.skillsCatalogFile,
      sources: manifest.sources,
      rules: manifest.rules,
      skills: manifest.skills,
    }),
  );
}

export function hashBenchmarkProjectInstructionCacheState(mode, sourceSha256, state) {
  return hashText(JSON.stringify({ mode, sourceSha256, state }));
}

function readArtifact(versionDir, file) {
  if (typeof file !== "string" || isAbsolute(file) || file.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")) {
    throw new Error("invalid cache artifact path");
  }
  let current = realpathSync(versionDir);
  for (const part of file.split(/[\\/]/u)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("symlinked cache artifact");
  }
  const target = realpathSync(resolve(versionDir, file));
  const fromRoot = relative(realpathSync(versionDir), target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot) || !lstatSync(target).isFile()) {
    throw new Error("cache artifact escaped version");
  }
  return readFileSync(target, "utf8");
}

function isManifest(value) {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.compilerVersion === "string" &&
    [value.agentsHash, value.inputHash, value.resultHash, value.promptHash, value.rulesCatalogHash, value.skillsCatalogHash].every(isHash) &&
    ["exact", "compiled", "fallback"].includes(value.mode) &&
    ["success", "failed", "not-needed", "unavailable"].includes(value.compilerStatus) &&
    (value.compilerDiagnostic === undefined || isCompilerDiagnostic(value.compilerDiagnostic)) &&
    ((value.compilerStatus === "failed") === (value.compilerDiagnostic !== undefined)) &&
    (value.compilerUsage === undefined || isCompilerUsage(value.compilerUsage)) &&
    value.promptFile === "prompt.md" &&
    value.rulesCatalogFile === "rules/catalog.md" &&
    value.skillsCatalogFile === "skills/catalog.md" &&
    Array.isArray(value.sources) &&
    value.sources.every((source) => isRecord(source) && typeof source.path === "string" && isHash(source.contentHash)) &&
    Array.isArray(value.rules) &&
    value.rules.every(isRule) &&
    Array.isArray(value.skills) &&
    value.skills.every(isSkill) &&
    Array.isArray(value.rulesCatalogPages) &&
    value.rulesCatalogPages.every((page) => isPage(page, "rules")) &&
    Array.isArray(value.skillsCatalogPages) &&
    value.skillsCatalogPages.every((page) => isPage(page, "skills"))
  );
}

function isRule(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    /^rules\/[a-z0-9][a-z0-9-]*\.md$/u.test(value.link) &&
    value.file === value.link &&
    typeof value.title === "string" &&
    typeof value.trigger === "string" &&
    typeof value.routable === "boolean" &&
    typeof value.sourcePath === "string" &&
    isHash(value.contentHash)
  );
}

function isSkill(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/u.test(value.link) &&
    [value.name, value.description, value.filePath, value.baseDir].every((entry) => typeof entry === "string") &&
    isHash(value.rootHash)
  );
}

function isPage(value, namespace) {
  return (
    isRecord(value) &&
    new RegExp(`^${namespace}/catalog-pages/[0-9]+\\.md$`, "u").test(value.link) &&
    value.file === value.link &&
    isHash(value.contentHash)
  );
}

function isCompilerUsage(value) {
  return (
    isRecord(value) &&
    Object.keys(value).length === 5 &&
    ["input", "output", "cacheRead", "cacheWrite", "total"].every((key) => Object.hasOwn(value, key)) &&
    [value.input, value.output, value.cacheRead, value.cacheWrite, value.total].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
    )
  );
}

function isCompilerDiagnostic(value) {
  return BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS.includes(value);
}

function isCurrent(value) {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    value.schemaVersion === 1 &&
    isHash(value.agentsHash) &&
    isHash(value.inputHash) &&
    VERSION_PATTERN.test(value.version)
  );
}

function isHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}
