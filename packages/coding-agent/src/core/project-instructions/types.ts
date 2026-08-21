import type { Skill } from "../skills.ts";

export type ProjectInstructionMode = "exact" | "compiled" | "fallback";
export type ProjectInstructionCompilerStatus = "success" | "failed" | "not-needed" | "unavailable";

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
}

export interface ProjectInstructionRuleRecord {
  id: string;
  link: string;
  file: string;
  title: string;
  trigger: string;
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
}

export interface ProjectInstructionCompilerResult {
  body: string;
  triggers: Record<string, string>;
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

export interface ProjectInstructionController {
  state: ProjectInstructionState;
  refresh(): Promise<PreparedProjectInstructions>;
}
