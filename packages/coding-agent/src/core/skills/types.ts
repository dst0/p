import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SourceInfo } from "../source-info.ts";

/** Max name length per spec */
export const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
export const MAX_DESCRIPTION_LENGTH = 1024;

export const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo: SourceInfo;
  disableModelInvocation: boolean;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsFromDirOptions {
  /** Directory to scan for skills */
  dir: string;
  /** Source identifier for these skills */
  source: string;
}

export interface LoadSkillsOptions {
  /** Working directory for project-local skills. */
  cwd: string;
  /** Agent config directory for global skills. */
  agentDir: string;
  /** Explicit skill paths (files or directories) */
  skillPaths: string[];
  /** Include default skills directories. */
  includeDefaults: boolean;
  /** Include bundled skills directory (defaults to includeDefaults). */
  includeBundled?: boolean;
  /** Optional bundled skills directory override. */
  bundledSkillsDir?: string;
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
export function validateName(name: string): string[] {
  const errors: string[] = [];

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
  }

  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push("name must not start or end with a hyphen");
  }

  if (name.includes("--")) {
    errors.push("name must not contain consecutive hyphens");
  }

  return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
export function validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];

  if (!description || description.trim() === "") {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }

  return errors;
}
