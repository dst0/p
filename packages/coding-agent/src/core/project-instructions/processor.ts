import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { findWorkspaceRoot } from "../workspace-root.ts";
import { loadCachedProjectInstructions, persistProjectInstructions } from "./cache.ts";
import {
  loadCachedCompilation,
  loadCachedCompilationFailure,
  persistCompilation,
  persistCompilationFailure,
} from "./compilation-cache.ts";
import { buildProjectInstructionConstraints } from "./compiler-constraints.ts";
import { classifyProjectInstructionCompilerError } from "./compiler-diagnostics.ts";
import { type ProjectInstructionCompilationAttempt, runProjectInstructionCompiler } from "./compiler-runner.ts";
import { validateProjectInstructionCompilerResult } from "./compiler-validation.ts";
import {
  buildSkillRecords,
  buildSourceRecords,
  computeAgentsHash,
  computeInputHash,
  hashText,
  splitInstructionSources,
} from "./content.ts";
import { computeProjectInstructionResultHash } from "./manifest.ts";
import { renderProjectInstructions, renderRulesCatalog, renderSkillsCatalog } from "./prompt.ts";
import type {
  PreparedProjectInstructions,
  PrepareProjectInstructionsOptions,
  ProjectInstructionCompilerDiagnostic,
  ProjectInstructionCompilerResult,
  ProjectInstructionCompilerStatus,
  ProjectInstructionMode,
  ProjectInstructionRuleRecord,
} from "./types.ts";

export const PROJECT_INSTRUCTION_COMPILER_VERSION = "project-instructions-v4-exact-source-v14-scope-repair-evidence";

export async function prepareProjectInstructions(
  options: PrepareProjectInstructionsOptions,
): Promise<PreparedProjectInstructions> {
  const discoveredWorkspaceRoot = resolve(findWorkspaceRoot(options.cwd));
  const workspaceRoot = realpathSync(discoveredWorkspaceRoot);
  const requestedCacheDir = resolve(options.cacheDir ?? join(discoveredWorkspaceRoot, ".pdev", "instructions"));
  assertRequestedCachePathSafe(requestedCacheDir, workspaceRoot);
  const cacheDir = canonicalizeProspectivePath(requestedCacheDir);
  const sources = options.contextFiles.map((source) => ({ ...source }));
  const sourceRecords = buildSourceRecords(sources);
  const skillRecords = buildSkillRecords(options.skills);
  const agentsHash = computeAgentsHash(sources);
  const compilerCacheIdentity = options.compiler ? options.compilerIdentity?.trim() || "default" : "none";
  const inputHash = computeInputHash(
    agentsHash,
    skillRecords,
    `${PROJECT_INSTRUCTION_COMPILER_VERSION}:${compilerCacheIdentity}`,
  );
  const modules = splitInstructionSources(sources);
  const constraints = buildProjectInstructionConstraints(modules);
  const expected = { sources: sourceRecords, modules, skills: skillRecords };
  const cacheOptions = {
    cacheDir,
    workspaceRoot,
    agentsHash,
    inputHash,
    compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
    expected,
  };
  const cached = loadCachedProjectInstructions(cacheOptions);
  if (cached && (cached.manifest.mode !== "fallback" || !options.compiler)) return cached;

  let rules = buildRuleRecords(modules, constraints);
  let mode: ProjectInstructionMode = "exact";
  let compilerStatus: ProjectInstructionCompilerStatus = "not-needed";
  let compilerDiagnostic: ProjectInstructionCompilerDiagnostic | undefined;
  let compilerUsage: ProjectInstructionCompilerResult["usage"];
  let prompt = renderProjectInstructions({
    agentsHash,
    inputHash,
    cacheDir,
    mode,
    sources,
    rules,
    skills: skillRecords,
  });
  if (!prompt) {
    const compilation = await getCompilation(options, {
      cacheDir,
      workspaceRoot,
      agentsHash,
      compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
      compilerIdentity: options.compilerIdentity,
      modules,
      constraints,
    });
    compilerStatus = compilation.status;
    compilerDiagnostic = compilation.diagnostic;
    compilerUsage = compilation.result?.usage;
    rules = buildRuleRecords(modules, constraints, compilation.result);
    mode = compilation.result ? "compiled" : "fallback";
    prompt = renderProjectInstructions({
      agentsHash,
      inputHash,
      cacheDir,
      mode,
      body: compilation.result?.body,
      sources,
      rules,
      skills: skillRecords,
    });
    if (!prompt && compilation.result) {
      mode = "fallback";
      compilerStatus = "failed";
      compilerDiagnostic = "project instruction compiler output validation failed";
      prompt = renderProjectInstructions({
        agentsHash,
        inputHash,
        cacheDir,
        mode,
        sources,
        rules,
        skills: skillRecords,
      });
    }
  }
  if (!prompt) throw new Error("Unable to render project instructions inside the prompt budget");

  const rulesCatalog = renderRulesCatalog(rules);
  const skillsCatalog = renderSkillsCatalog(skillRecords);
  const partialManifest = {
    schemaVersion: 1 as const,
    compilerVersion: PROJECT_INSTRUCTION_COMPILER_VERSION,
    agentsHash,
    inputHash,
    resultHash: "",
    promptHash: hashText(prompt),
    rulesCatalogHash: hashText(rulesCatalog.root),
    skillsCatalogHash: hashText(skillsCatalog.root),
    rulesCatalogPages: rulesCatalog.pages.map((page) => ({
      link: page.link,
      file: page.link,
      contentHash: hashText(page.content),
    })),
    skillsCatalogPages: skillsCatalog.pages.map((page) => ({
      link: page.link,
      file: page.link,
      contentHash: hashText(page.content),
    })),
    mode,
    compilerStatus,
    compilerDiagnostic,
    compilerUsage,
    promptFile: "prompt.md" as const,
    rulesCatalogFile: "rules/catalog.md" as const,
    skillsCatalogFile: "skills/catalog.md" as const,
    sources: sourceRecords,
    rules,
    skills: skillRecords,
  };
  const manifest = {
    ...partialManifest,
    resultHash: computeProjectInstructionResultHash(partialManifest),
  };
  return persistProjectInstructions({
    ...cacheOptions,
    prompt,
    manifest,
    rulesCatalog,
    skillsCatalog,
  });
}

async function getCompilation(
  options: PrepareProjectInstructionsOptions,
  cache: {
    cacheDir: string;
    workspaceRoot: string;
    agentsHash: string;
    compilerVersion: string;
    compilerIdentity?: string;
    modules: ReturnType<typeof splitInstructionSources>;
    constraints: ReturnType<typeof buildProjectInstructionConstraints>;
  },
): Promise<ProjectInstructionCompilationAttempt> {
  const cached = loadCachedCompilation(cache);
  if (cached) {
    try {
      return {
        status: "success",
        result: validateProjectInstructionCompilerResult(cached, cache.modules, cache.constraints),
      };
    } catch {
      // Treat a malformed derived compiler cache as absent and regenerate it.
    }
  }
  const backoffMs = Math.max(0, options.compilerFailureBackoffMs ?? 0);
  const previousFailure = backoffMs > 0 ? loadCachedCompilationFailure(cache) : undefined;
  if (previousFailure && Date.now() - previousFailure.failedAtMs < backoffMs) {
    return {
      status: "failed",
      error: previousFailure.error,
      diagnostic: classifyProjectInstructionCompilerError(previousFailure.error),
    };
  }
  const compilation = await runProjectInstructionCompiler(options.compiler, {
    sources: options.contextFiles,
    modules: cache.modules,
    constraints: cache.constraints,
  });
  if (compilation.result) persistCompilation(cache, compilation.result);
  else if (compilation.status === "failed") {
    persistCompilationFailure(cache, {
      failedAtMs: Date.now(),
      error: compilation.error ?? "Compiler failed without a diagnostic",
      ...(compilation.compilerFailure ? { compilerFailure: compilation.compilerFailure } : {}),
    });
  }
  return compilation;
}

function buildRuleRecords(
  modules: ReturnType<typeof splitInstructionSources>,
  constraints: ReturnType<typeof buildProjectInstructionConstraints>,
  compilation?: ProjectInstructionCompilerResult,
): ProjectInstructionRuleRecord[] {
  return modules.map((module) => ({
    id: module.id,
    link: module.link,
    file: module.link,
    title: module.title,
    trigger: compilation?.triggers[module.id]?.trim().slice(0, 500) || fallbackTrigger(module.title),
    routable:
      compilation?.classifications.constraints !== undefined &&
      constraints.some(
        (constraint) =>
          constraint.moduleId === module.id && compilation.classifications.constraints[constraint.id] === "routed",
      ),
    sourcePath: module.sourcePath,
    contentHash: hashText(module.content),
  }));
}

function fallbackTrigger(title: string): string {
  return `Work involving ${title
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 180)}`;
}

function canonicalizeProspectivePath(filePath: string): string {
  const missingParts: string[] = [];
  let existingPath = filePath;
  while (!existsSync(existingPath)) {
    missingParts.unshift(basename(existingPath));
    const parent = dirname(existingPath);
    if (parent === existingPath) break;
    existingPath = parent;
  }
  return resolve(realpathSync(existingPath), ...missingParts);
}

function assertRequestedCachePathSafe(cacheDir: string, workspaceRoot: string): void {
  let current = cacheDir;
  let workspaceAlias: string | undefined;
  while (true) {
    if (existsSync(current) && realpathSync(current) === workspaceRoot) workspaceAlias = current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!workspaceAlias) throw new Error(`Project instruction cache must stay inside the workspace: ${cacheDir}`);
  current = workspaceAlias;
  for (const part of relative(workspaceAlias, cacheDir).split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) return;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlinked cache path: ${current}`);
  }
}
