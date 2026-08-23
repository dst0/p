import { hashText } from "./content.ts";
import { parseProjectInstructionCompilerUsage } from "./compiler-usage.ts";
import type {
  ProjectInstructionCatalogPageRecord,
  ProjectInstructionCompilerDiagnostic,
  ProjectInstructionManifest,
  ProjectInstructionRuleRecord,
  ProjectInstructionSkillRecord,
  ProjectInstructionSourceRecord,
} from "./types.ts";
import { PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "./types.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export function parseProjectInstructionManifest(value: unknown): ProjectInstructionManifest | undefined {
  if (!isRecord(value)) return undefined;
  const compilerUsage =
    value.compilerUsage === undefined ? undefined : parseProjectInstructionCompilerUsage(value.compilerUsage, true);
  if (
    value.schemaVersion !== 1 ||
    typeof value.compilerVersion !== "string" ||
    !isHash(value.agentsHash) ||
    !isHash(value.inputHash) ||
    !isHash(value.resultHash) ||
    !isHash(value.promptHash) ||
    !isHash(value.rulesCatalogHash) ||
    !isHash(value.skillsCatalogHash) ||
    !Array.isArray(value.rulesCatalogPages) ||
    !value.rulesCatalogPages.every((page) => isCatalogPageRecord(page, "rules")) ||
    !Array.isArray(value.skillsCatalogPages) ||
    !value.skillsCatalogPages.every((page) => isCatalogPageRecord(page, "skills")) ||
    !isMode(value.mode) ||
    !isCompilerStatus(value.compilerStatus) ||
    (value.compilerDiagnostic !== undefined && !isCompilerDiagnostic(value.compilerDiagnostic)) ||
    (value.compilerStatus === "failed") !== (value.compilerDiagnostic !== undefined) ||
    (value.compilerUsage !== undefined && compilerUsage === undefined) ||
    value.promptFile !== "prompt.md" ||
    value.rulesCatalogFile !== "rules/catalog.md" ||
    value.skillsCatalogFile !== "skills/catalog.md" ||
    !Array.isArray(value.sources) ||
    !value.sources.every(isSourceRecord) ||
    !Array.isArray(value.rules) ||
    !value.rules.every(isRuleRecord) ||
    !Array.isArray(value.skills) ||
    !value.skills.every(isSkillRecord)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    compilerVersion: value.compilerVersion,
    agentsHash: value.agentsHash,
    inputHash: value.inputHash,
    resultHash: value.resultHash,
    promptHash: value.promptHash,
    rulesCatalogHash: value.rulesCatalogHash,
    skillsCatalogHash: value.skillsCatalogHash,
    rulesCatalogPages: value.rulesCatalogPages,
    skillsCatalogPages: value.skillsCatalogPages,
    mode: value.mode,
    compilerStatus: value.compilerStatus,
    compilerDiagnostic: value.compilerDiagnostic,
    compilerUsage,
    promptFile: value.promptFile,
    rulesCatalogFile: value.rulesCatalogFile,
    skillsCatalogFile: value.skillsCatalogFile,
    sources: value.sources,
    rules: value.rules,
    skills: value.skills,
  };
}

export function computeProjectInstructionResultHash(manifest: {
  schemaVersion: number;
  compilerVersion: string;
  agentsHash: string;
  inputHash: string;
  promptHash: string;
  rulesCatalogHash: string;
  skillsCatalogHash: string;
  rulesCatalogPages: ProjectInstructionCatalogPageRecord[];
  skillsCatalogPages: ProjectInstructionCatalogPageRecord[];
  mode: string;
  compilerStatus: string;
  compilerDiagnostic?: ProjectInstructionManifest["compilerDiagnostic"];
  compilerUsage?: ProjectInstructionManifest["compilerUsage"];
  promptFile: string;
  rulesCatalogFile: string;
  skillsCatalogFile: string;
  sources: ProjectInstructionSourceRecord[];
  rules: ProjectInstructionRuleRecord[];
  skills: ProjectInstructionSkillRecord[];
}): string {
  const material = JSON.stringify({
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
  });
  return hashText(material);
}

function isSourceRecord(value: unknown): value is ProjectInstructionSourceRecord {
  return isRecord(value) && typeof value.path === "string" && isHash(value.contentHash);
}

function isRuleRecord(value: unknown): value is ProjectInstructionRuleRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRuleLink(value.link) &&
    value.file === value.link &&
    typeof value.title === "string" &&
    typeof value.trigger === "string" &&
    typeof value.routable === "boolean" &&
    typeof value.sourcePath === "string" &&
    isHash(value.contentHash)
  );
}

function isSkillRecord(value: unknown): value is ProjectInstructionSkillRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.link === "string" &&
    /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/u.test(value.link) &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.filePath === "string" &&
    typeof value.baseDir === "string" &&
    isHash(value.rootHash)
  );
}

function isCatalogPageRecord(
  value: unknown,
  namespace: "rules" | "skills",
): value is ProjectInstructionCatalogPageRecord {
  return (
    isRecord(value) &&
    typeof value.link === "string" &&
    new RegExp(`^${namespace}/catalog-pages/[0-9]+\\.md$`, "u").test(value.link) &&
    value.file === value.link &&
    isHash(value.contentHash)
  );
}

function isRuleLink(value: unknown): value is string {
  return typeof value === "string" && /^rules\/[a-z0-9][a-z0-9-]*\.md$/u.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isMode(value: unknown): value is ProjectInstructionManifest["mode"] {
  return value === "exact" || value === "compiled" || value === "fallback";
}

function isCompilerStatus(value: unknown): value is ProjectInstructionManifest["compilerStatus"] {
  return value === "success" || value === "failed" || value === "not-needed" || value === "unavailable";
}

function isCompilerDiagnostic(value: unknown): value is ProjectInstructionCompilerDiagnostic {
  return PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS.some((diagnostic) => diagnostic === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
