import { Buffer } from "node:buffer";
import { lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { hashText } from "./content.ts";
import { expandProjectInstructionRuleLinks } from "./dependency-graph.ts";
import { PROJECT_INSTRUCTION_READ_MAX_BYTES } from "./limits.ts";
import { ProjectInstructionReadError } from "./read-error.ts";
import type {
  PreparedProjectInstructions,
  ProjectInstructionRuleRecord,
  ProjectInstructionSkillRecord,
  ProjectInstructionState,
} from "./types.ts";

export function readRuleLinks(state: ProjectInstructionState, links: string[]): string {
  const prepared = requireFreshPreparedState(state);
  const ruleByLink = new Map(prepared.manifest.rules.map((rule) => [rule.link, rule]));
  const pageByLink = new Map(prepared.manifest.rulesCatalogPages.map((page) => [page.link, page]));
  const expandedLinks = expandProjectInstructionRuleLinks(prepared.manifest.rules, links);
  return readRequestedLinks(expandedLinks, (link, maxBytes) => {
    if (link === prepared.manifest.rulesCatalogFile) {
      return readVersionFile(prepared, link, prepared.manifest.rulesCatalogHash, maxBytes);
    }
    const page = pageByLink.get(link);
    if (page) return readVersionFile(prepared, page.file, page.contentHash, maxBytes);
    const rule = ruleByLink.get(link);
    if (!rule) throw new ProjectInstructionReadError(`Rule link is not cataloged: ${link}`);
    return readRuleFile(prepared, rule, maxBytes);
  });
}

export function readSkillLinks(state: ProjectInstructionState, links: string[]): string {
  const prepared = requireFreshPreparedState(state);
  const pageByLink = new Map(prepared.manifest.skillsCatalogPages.map((page) => [page.link, page]));
  return readRequestedLinks(links, (link, maxBytes) => {
    if (link === prepared.manifest.skillsCatalogFile) {
      return readVersionFile(prepared, link, prepared.manifest.skillsCatalogHash, maxBytes);
    }
    const page = pageByLink.get(link);
    if (page) return readVersionFile(prepared, page.file, page.contentHash, maxBytes);
    const skill = findSkillForLink(prepared.manifest.skills, link);
    if (!skill) throw new ProjectInstructionReadError(`Skill link is not cataloged: ${link}`);
    return readSkillFile(skill, link, maxBytes);
  });
}

export function requireFreshPreparedState(state: ProjectInstructionState): PreparedProjectInstructions {
  const prepared = state.current;
  if (!prepared) throw new ProjectInstructionReadError("Project instruction cache is unavailable; reload the session");
  const expectedVersion = `${prepared.manifest.inputHash}-${prepared.manifest.resultHash}`;
  if (basename(prepared.versionDir) !== expectedVersion) {
    throw new ProjectInstructionReadError("Project instruction cache version identity is invalid; reload the session");
  }
  for (const source of prepared.manifest.sources) {
    if (readSourceHash(source.path) !== source.contentHash) {
      throw new ProjectInstructionReadError(
        `Project instruction cache is stale because ${source.path} changed; reload`,
      );
    }
  }
  for (const skill of prepared.manifest.skills) {
    if (readSourceHash(skill.filePath) !== skill.rootHash) {
      throw new ProjectInstructionReadError(`Skill catalog is stale because ${skill.filePath} changed; reload`);
    }
  }
  return prepared;
}

function readRequestedLinks(links: string[], reader: (link: string, maxBytes: number) => string): string {
  if (links.length === 0) throw new ProjectInstructionReadError("At least one catalog link is required");
  const sections: string[] = [];
  let remainingBytes = PROJECT_INSTRUCTION_READ_MAX_BYTES;
  for (const link of links) {
    assertLogicalLink(link);
    const prefix = sections.length > 0 ? "\n\n" : "";
    const heading = `${prefix}## ${link}\n\n`;
    remainingBytes -= Buffer.byteLength(heading, "utf8");
    if (remainingBytes < 0) throwReadLimit();
    const content = reader(link, remainingBytes);
    remainingBytes -= Buffer.byteLength(content, "utf8");
    if (remainingBytes < 0) throwReadLimit();
    sections.push(`${heading}${content}`);
  }
  return sections.join("");
}

function readRuleFile(
  prepared: PreparedProjectInstructions,
  rule: ProjectInstructionRuleRecord,
  maxBytes: number,
): string {
  return readVersionFile(prepared, rule.file, rule.contentHash, maxBytes);
}

function readVersionFile(
  prepared: PreparedProjectInstructions,
  relativePath: string,
  expectedHash: string,
  maxBytes: number,
): string {
  const content = readBoundedFile(resolveWithin(prepared.versionDir, relativePath), maxBytes);
  if (hashText(content) !== expectedHash) {
    throw new ProjectInstructionReadError(`Instruction cache integrity check failed for ${relativePath}`);
  }
  return content;
}

function findSkillForLink(
  skills: ProjectInstructionSkillRecord[],
  link: string,
): ProjectInstructionSkillRecord | undefined {
  return skills.find((skill) => link === skill.link || link.startsWith(skill.link.slice(0, -"SKILL.md".length)));
}

function readSkillFile(skill: ProjectInstructionSkillRecord, link: string, maxBytes: number): string {
  if (link === skill.link) {
    const content = readBoundedFile(realpathSync(skill.filePath), maxBytes);
    if (hashText(content) !== skill.rootHash) {
      throw new ProjectInstructionReadError(`Skill catalog is stale because ${skill.filePath} changed; reload`);
    }
    return content;
  }
  const prefix = skill.link.slice(0, -"SKILL.md".length);
  const relativeResource = link.slice(prefix.length);
  return readBoundedFile(resolveWithin(realpathSync(skill.baseDir), relativeResource), maxBytes);
}

function resolveWithin(root: string, relativePath: string): string {
  assertLogicalLink(relativePath);
  const realRoot = realpathSync(root);
  let realTarget: string;
  try {
    realTarget = realpathSync(resolve(realRoot, relativePath));
  } catch {
    throw new ProjectInstructionReadError(`Instruction link does not exist: ${relativePath}`);
  }
  const fromRoot = relative(realRoot, realTarget);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ProjectInstructionReadError(`Instruction link resolves outside its catalog root: ${relativePath}`);
  }
  return realTarget;
}

const INVALID_PATH_PATTERN = /(?:^|[\\/])(?:\.\.?|)(?:[\\/]|$)/u;

function assertLogicalLink(link: string): void {
  if (!link || isAbsolute(link) || link.includes("\\") || INVALID_PATH_PATTERN.test(link)) {
    throw new ProjectInstructionReadError(`Invalid relative catalog link: ${link}`);
  }
}

function readBoundedFile(filePath: string, maxBytes: number): string {
  const stats = assertRegularFile(filePath);
  if (stats.size > maxBytes) throwReadLimit();
  const content = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > maxBytes) throwReadLimit();
  return content;
}

function assertRegularFile(filePath: string): Stats {
  let stats: Stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    throw new ProjectInstructionReadError(`Instruction link does not reference a readable file: ${filePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new ProjectInstructionReadError(`Instruction link does not reference a regular file: ${filePath}`);
  }
  return stats;
}

function readSourceHash(filePath: string): string {
  try {
    const target = realpathSync(filePath);
    assertRegularFile(target);
    return hashText(readFileSync(target, "utf8"));
  } catch (error) {
    if (error instanceof ProjectInstructionReadError) throw error;
    throw new ProjectInstructionReadError(`Instruction source is unreadable: ${filePath}`);
  }
}

function throwReadLimit(): never {
  throw new ProjectInstructionReadError("Requested instruction content exceeds the per-call read limit");
}
