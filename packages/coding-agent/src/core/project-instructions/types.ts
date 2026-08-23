import type { Skill } from "../skills.ts";

export type ProjectInstructionMode = "exact" | "compiled" | "fallback";
export type ProjectInstructionDeliveryMode = "compiled" | "legacy" | "off";
export type ProjectInstructionCompilerStatus = "success" | "failed" | "not-needed" | "unavailable";
export const PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS = [
  "project instruction compiler model context capacity was insufficient",
  "project instruction compiler model does not support thinking off",
  "project instruction compiler model lacks explicit thinking-disable compatibility",
  "project instruction compiler source size limit was exceeded",
  "project instruction compiler output validation failed",
  "project instruction compiler provider call failed",
  "project instruction compiler failed",
] as const;
export type ProjectInstructionCompilerDiagnostic = (typeof PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS)[number];
export type ProjectInstructionScope = "always-on" | "routed";

export interface ProjectInstructionSourceInput {
  path: string;
  content: string;
}

export interface ProjectInstructionSourceRecord {
  path: string;
  contentHash: string;
}

export interface ProjectInstructionModuleInput {
  id: string;
  link: string;
  title: string;
  sourcePath: string;
  content: string;
  sourceOrdinal?: number;
  sourceStartOffset?: number;
  headingContext?: Array<{ id: string; content: string; sourceText: string; level?: number }>;
}

export interface ProjectInstructionConstraintInput {
  id: string;
  moduleId: string;
  kind: "content" | "orphan-heading";
  headingContext: Array<{ id: string; content: string; sourceText: string }>;
  content: string;
  sourceText: string;
}

export interface ProjectInstructionRuleRecord {
  id: string;
  link: string;
  file: string;
  title: string;
  trigger: string;
  routable: boolean;
  sourcePath: string;
  contentHash: string;
}

export interface ProjectInstructionSkillRecord {
  id: string;
  link: string;
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  rootHash: string;
}

export interface ProjectInstructionCatalogPageRecord {
  link: string;
  file: string;
  contentHash: string;
}

export interface ProjectInstructionCatalogPageOutput {
  link: string;
  content: string;
}

export interface ProjectInstructionCatalogOutput {
  root: string;
  pages: ProjectInstructionCatalogPageOutput[];
}

export interface ProjectInstructionManifest {
  schemaVersion: 1;
  compilerVersion: string;
  agentsHash: string;
  inputHash: string;
  resultHash: string;
  promptHash: string;
  rulesCatalogHash: string;
  skillsCatalogHash: string;
  rulesCatalogPages: ProjectInstructionCatalogPageRecord[];
  skillsCatalogPages: ProjectInstructionCatalogPageRecord[];
  mode: ProjectInstructionMode;
  compilerStatus: ProjectInstructionCompilerStatus;
  compilerDiagnostic?: ProjectInstructionCompilerDiagnostic;
  compilerUsage?: ProjectInstructionCompilerUsage;
  promptFile: "prompt.md";
  rulesCatalogFile: "rules/catalog.md";
  skillsCatalogFile: "skills/catalog.md";
  sources: ProjectInstructionSourceRecord[];
  rules: ProjectInstructionRuleRecord[];
  skills: ProjectInstructionSkillRecord[];
}

export interface PreparedProjectInstructions {
  prompt: string;
  manifest: ProjectInstructionManifest;
  cacheDir: string;
  versionDir: string;
}

export interface ProjectInstructionCompilerRequest {
  sources: ProjectInstructionSourceInput[];
  modules: ProjectInstructionModuleInput[];
  constraints: ProjectInstructionConstraintInput[];
}

export interface ProjectInstructionClassifications {
  modules: Record<string, ProjectInstructionScope>;
  constraints: Record<string, ProjectInstructionScope>;
}

export interface ProjectInstructionCompilerResult {
  body: string;
  triggers: Record<string, string>;
  classifications: ProjectInstructionClassifications;
  alwaysOn: Record<string, string>;
  usage?: ProjectInstructionCompilerUsage;
}

export interface ProjectInstructionCompilerUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export type ProjectInstructionCompiler = (
  request: ProjectInstructionCompilerRequest,
) => Promise<ProjectInstructionCompilerResult>;

export interface PrepareProjectInstructionsOptions {
  cwd: string;
  cacheDir?: string;
  contextFiles: ProjectInstructionSourceInput[];
  skills: Skill[];
  compiler?: ProjectInstructionCompiler;
  compilerIdentity?: string;
  compilerFailureBackoffMs?: number;
}

export interface ProjectInstructionState {
  current: PreparedProjectInstructions | undefined;
}

export interface ProjectInstructionTurnRoutes {
  links: string[];
  prompt: string;
  inputHash: string;
}

export interface ProjectInstructionController {
  state: ProjectInstructionState;
  refresh(): Promise<PreparedProjectInstructions>;
}
