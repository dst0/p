import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CacheManifest } from "./cache-schema.ts";
import { isCacheCurrent, isCacheManifest } from "./cache-schema.ts";
import { parseCompiledProjectInstructionMarker } from "./marker.ts";
import { computeAuthorizedProjectInstructionPromptHashes } from "./prompt-projection.ts";

export function captureVerifiedCompiledCache(workspace: string, sourceSha256: string) {
  try {
    const cacheDir = join(workspace, ".pdev", "instructions");
    const cacheStats = lstatSync(cacheDir);
    if (!cacheStats.isDirectory() || cacheStats.isSymbolicLink()) return undefined;
    const current: unknown = JSON.parse(readFileSync(join(cacheDir, "current.json"), "utf8"));
    if (!isCacheCurrent(current)) return undefined;
    const versionDir = join(cacheDir, "versions", current.version);
    const manifest: unknown = JSON.parse(readArtifact(versionDir, "manifest.json"));
    if (!isCacheManifest(manifest) || current.version !== `${manifest.inputHash}-${manifest.resultHash}`)
      return undefined;
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
          promptMarker !== undefined &&
          promptMarker.agentsSha256 === manifest.agentsHash &&
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

function hashCacheClosure(root: string): string {
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

function listCacheFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile()) || (stats.isFile() && stats.nlink !== 1)) {
      throw new Error("unsafe cache artifact");
    }
    if (stats.isDirectory()) files.push(...listCacheFiles(root, path));
    else files.push(relative(root, path));
  }
  return files.sort();
}

export function computeBenchmarkProjectInstructionResultHash(
  manifest: Omit<CacheManifest, "resultHash"> & { resultHash?: string },
): string {
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

export function hashBenchmarkProjectInstructionCacheState(mode: string, sourceSha256: string, state: string): string {
  return hashText(JSON.stringify({ mode, sourceSha256, state }));
}

function readArtifact(versionDir: string, file: unknown): string {
  if (
    typeof file !== "string" ||
    isAbsolute(file) ||
    file.split(/[\\/]/u).some((part) => !part || part === "." || part === "..")
  ) {
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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
