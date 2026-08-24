import { BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "./diagnostics.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^[a-f0-9]{64}-[a-f0-9]{64}$/u;

type CompilerUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
type CacheSource = { path: string; contentHash: string };
type CacheRule = {
  id: string;
  link: string;
  file: string;
  title: string;
  trigger: string;
  routable: boolean;
  sourcePath: string;
  contentHash: string;
};
type CacheSkill = {
  id: string;
  link: string;
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  rootHash: string;
};
type CachePage = { link: string; file: string; contentHash: string };
export type CacheManifest = {
  schemaVersion: 1;
  compilerVersion: string;
  agentsHash: string;
  inputHash: string;
  resultHash: string;
  promptHash: string;
  rulesCatalogHash: string;
  skillsCatalogHash: string;
  rulesCatalogPages: CachePage[];
  skillsCatalogPages: CachePage[];
  mode: string;
  compilerStatus: string;
  compilerDiagnostic?: string;
  compilerUsage?: CompilerUsage;
  promptFile: string;
  rulesCatalogFile: string;
  skillsCatalogFile: string;
  sources: CacheSource[];
  rules: CacheRule[];
  skills: CacheSkill[];
};
type CacheCurrent = { schemaVersion: 1; agentsHash: string; inputHash: string; version: string };

export function isCacheManifest(value: unknown): value is CacheManifest {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.compilerVersion === "string" &&
    [
      value.agentsHash,
      value.inputHash,
      value.resultHash,
      value.promptHash,
      value.rulesCatalogHash,
      value.skillsCatalogHash,
    ].every(isHash) &&
    typeof value.mode === "string" &&
    ["exact", "compiled", "fallback"].includes(value.mode) &&
    typeof value.compilerStatus === "string" &&
    ["success", "failed", "not-needed", "unavailable"].includes(value.compilerStatus) &&
    (value.compilerDiagnostic === undefined || isCompilerDiagnostic(value.compilerDiagnostic)) &&
    (value.compilerStatus === "failed") === (value.compilerDiagnostic !== undefined) &&
    (value.compilerUsage === undefined || isCompilerUsage(value.compilerUsage)) &&
    value.promptFile === "prompt.md" &&
    value.rulesCatalogFile === "rules/catalog.md" &&
    value.skillsCatalogFile === "skills/catalog.md" &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) => isRecord(source) && typeof source.path === "string" && isHash(source.contentHash),
    ) &&
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

function isRule(value: unknown): value is CacheRule {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.link === "string" &&
    /^rules\/[a-z0-9][a-z0-9-]*\.md$/u.test(value.link) &&
    value.file === value.link &&
    typeof value.title === "string" &&
    typeof value.trigger === "string" &&
    typeof value.routable === "boolean" &&
    typeof value.sourcePath === "string" &&
    isHash(value.contentHash)
  );
}

function isSkill(value: unknown): value is CacheSkill {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.link === "string" &&
    /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/u.test(value.link) &&
    [value.name, value.description, value.filePath, value.baseDir].every((entry) => typeof entry === "string") &&
    isHash(value.rootHash)
  );
}

function isPage(value: unknown, namespace: "rules" | "skills"): value is CachePage {
  return (
    isRecord(value) &&
    typeof value.link === "string" &&
    new RegExp(`^${namespace}/catalog-pages/[0-9]+\\.md$`, "u").test(value.link) &&
    value.file === value.link &&
    isHash(value.contentHash)
  );
}

function isCompilerUsage(value: unknown): value is CompilerUsage {
  return (
    isRecord(value) &&
    Object.keys(value).length === 5 &&
    ["input", "output", "cacheRead", "cacheWrite", "total"].every((key) => Object.hasOwn(value, key)) &&
    [value.input, value.output, value.cacheRead, value.cacheWrite, value.total].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
    )
  );
}

function isCompilerDiagnostic(value: unknown): value is string {
  return (
    typeof value === "string" && BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS.some((entry) => entry === value)
  );
}

export function isCacheCurrent(value: unknown): value is CacheCurrent {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    value.schemaVersion === 1 &&
    isHash(value.agentsHash) &&
    isHash(value.inputHash) &&
    typeof value.version === "string" &&
    VERSION_PATTERN.test(value.version)
  );
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
