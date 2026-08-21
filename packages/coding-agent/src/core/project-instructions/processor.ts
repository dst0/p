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
  ProjectInstructionCompilerResult,
  ProjectInstructionCompilerStatus,
  ProjectInstructionMode,
  ProjectInstructionRuleRecord,
} from "./types.ts";

export const PROJECT_INSTRUCTION_COMPILER_VERSION = "project-instructions-v3";

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
  const inputHash = computeInputHash(agentsHash, skillRecords, PROJECT_INSTRUCTION_COMPILER_VERSION);
  const modules = splitInstructionSources(sources);
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

  let rules = buildRuleRecords(modules);
  let mode: ProjectInstructionMode = "exact";
  let compilerStatus: ProjectInstructionCompilerStatus = "not-needed";
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
    });
    compilerStatus = compilation.status;
    rules = buildRuleRecords(modules, compilation.result);
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
  },
): Promise<{ status: ProjectInstructionCompilerStatus; result?: ProjectInstructionCompilerResult; error?: string }> {
  const allowedLinks = cache.modules.map((module) => module.link);
  const cached = loadCachedCompilation(cache);
  if (cached) {
    try {
      return { status: "success", result: validateCompilerResult(cached, allowedLinks) };
    } catch {
      // Treat a malformed derived compiler cache as absent and regenerate it.
    }
  }
  const backoffMs = Math.max(0, options.compilerFailureBackoffMs ?? 0);
  const previousFailure = backoffMs > 0 ? loadCachedCompilationFailure(cache) : undefined;
  if (previousFailure && Date.now() - previousFailure.failedAtMs < backoffMs) {
    return { status: "failed", error: previousFailure.error };
  }
  const compilation = await runCompiler(options, cache.modules);
  if (compilation.result) persistCompilation(cache, compilation.result);
  else if (compilation.status === "failed") {
    persistCompilationFailure(cache, {
      failedAtMs: Date.now(),
      error: compilation.error ?? "Compiler failed without a diagnostic",
    });
  }
  return compilation;
}

async function runCompiler(
  options: PrepareProjectInstructionsOptions,
  modules: ReturnType<typeof splitInstructionSources>,
): Promise<{ status: ProjectInstructionCompilerStatus; result?: ProjectInstructionCompilerResult; error?: string }> {
  if (!options.compiler || options.contextFiles.length === 0) return { status: "unavailable" };
  try {
    const candidate = await options.compiler({ sources: options.contextFiles, modules });
    return {
      status: "success",
      result: validateCompilerResult(
        candidate,
        modules.map((module) => module.link),
      ),
    };
  } catch (error) {
    return { status: "failed", error: sanitizeCompilerError(error) };
  }
}

function buildRuleRecords(
  modules: ReturnType<typeof splitInstructionSources>,
  compilation?: ProjectInstructionCompilerResult,
): ProjectInstructionRuleRecord[] {
  return modules.map((module) => ({
    id: module.id,
    link: module.link,
    file: module.link,
    title: module.title,
    trigger: compilation?.triggers[module.id]?.trim().slice(0, 500) || fallbackTrigger(module.title),
    sourcePath: module.sourcePath,
    contentHash: hashText(module.content),
  }));
}

function validateCompilerResult(
  result: ProjectInstructionCompilerResult,
  allowedLinks: string[],
): ProjectInstructionCompilerResult {
  if (!result || typeof result.body !== "string" || !result.body.trim()) {
    throw new Error("Project instruction compiler returned an empty body");
  }
  if (typeof result.triggers !== "object" || result.triggers === null || Array.isArray(result.triggers)) {
    throw new Error("Project instruction compiler returned invalid triggers");
  }
  const allowedLinkSet = new Set(["rules/catalog.md", ...allowedLinks]);
  for (const link of result.body.match(/rules\/[a-z0-9][a-z0-9./-]*/gu) ?? []) {
    if (!allowedLinkSet.has(link.replace(/[.),;:]+$/u, ""))) {
      throw new Error(`Project instruction compiler referenced unknown link: ${link}`);
    }
  }
  const allowedIds = new Set(allowedLinks.map((link) => link.slice("rules/".length, -".md".length)));
  const triggers: Record<string, string> = {};
  for (const [id, trigger] of Object.entries(result.triggers)) {
    if (!allowedIds.has(id) || typeof trigger !== "string" || !trigger.trim()) {
      throw new Error(`Project instruction compiler returned an invalid trigger for ${id}`);
    }
    triggers[id] = trigger.trim().slice(0, 500);
  }
  return { body: result.body.trim(), triggers };
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

function sanitizeCompilerError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown compiler error";
  return message
    .replace(/https?:\/\/\S+/gu, "[url]")
    .replace(/[A-Za-z0-9_=-]{32,}/gu, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}
