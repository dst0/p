import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Skill } from "../skills.ts";
import { PROJECT_INSTRUCTION_MODULE_MAX_BYTES } from "./limits.ts";
import type {
  ProjectInstructionModuleInput,
  ProjectInstructionSkillRecord,
  ProjectInstructionSourceInput,
  ProjectInstructionSourceRecord,
} from "./types.ts";

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildSourceRecords(sources: ProjectInstructionSourceInput[]): ProjectInstructionSourceRecord[] {
  return sources.map((source) => ({ path: source.path, contentHash: hashText(source.content) }));
}

export function computeAgentsHash(sources: ProjectInstructionSourceInput[]): string {
  return hashText(JSON.stringify(buildSourceRecords(sources)));
}

export function computeInputHash(
  agentsHash: string,
  skills: ProjectInstructionSkillRecord[],
  compilerVersion: string,
): string {
  return hashText(
    JSON.stringify({
      agentsHash,
      compilerVersion,
      skills: skills.map(({ link, name, description, filePath, baseDir, rootHash }) => ({
        link,
        name,
        description,
        filePath,
        baseDir,
        rootHash,
      })),
    }),
  );
}

export function splitInstructionSources(sources: ProjectInstructionSourceInput[]): ProjectInstructionModuleInput[] {
  const modules: ProjectInstructionModuleInput[] = [];
  sources.forEach((source, sourceIndex) => {
    const sections = splitAtMajorHeadings(source.content);
    sections.forEach((section, sectionIndex) => {
      splitLargeSection(section).forEach((content, partIndex) => {
        const title = getSectionTitle(content, source.path, partIndex);
        const slug = slugify(title);
        const id = `${sourceIndex + 1}-${sectionIndex + 1}-${partIndex + 1}-${slug}-${hashText(content).slice(0, 8)}`;
        modules.push({
          id,
          link: `rules/${id}.md`,
          title,
          sourcePath: source.path,
          content,
        });
      });
    });
  });
  return modules;
}

export function buildSkillRecords(skills: Skill[]): ProjectInstructionSkillRecord[] {
  return skills
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => {
      const filePath = realpathSync(skill.filePath);
      const baseDir = realpathSync(skill.baseDir);
      if (dirname(filePath) !== baseDir) {
        throw new Error(`Skill root must be directly inside its base directory: ${skill.filePath}`);
      }
      const rootContent = readFileSync(filePath, "utf8");
      const id = `${slugify(skill.name)}-${hashText(filePath).slice(0, 8)}`;
      return {
        id,
        link: `skills/${id}/SKILL.md`,
        name: skill.name,
        description: skill.description,
        filePath,
        baseDir,
        rootHash: hashText(rootContent),
      };
    })
    .sort((left, right) => left.link.localeCompare(right.link));
}

function splitAtMajorHeadings(content: string): string[] {
  if (!content) return [];
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const sections: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && /^#{1,2}\s+\S/u.test(line)) {
      sections.push(current);
      current = "";
    }
    current += line;
  }
  if (current) sections.push(current);
  return sections;
}

function splitLargeSection(section: string): string[] {
  if (Buffer.byteLength(section, "utf8") <= PROJECT_INSTRUCTION_MODULE_MAX_BYTES) return [section];
  const parts: string[] = [];
  let remaining = section;
  while (Buffer.byteLength(remaining, "utf8") > PROJECT_INSTRUCTION_MODULE_MAX_BYTES) {
    const splitAt = findByteSafeSplit(remaining);
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function findByteSafeSplit(value: string): number {
  let bytes = 0;
  let codeUnits = 0;
  let lastNewline = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > PROJECT_INSTRUCTION_MODULE_MAX_BYTES) break;
    bytes += characterBytes;
    codeUnits += character.length;
    if (character === "\n") lastNewline = codeUnits;
  }
  return lastNewline > 0 ? lastNewline : codeUnits;
}

function getSectionTitle(content: string, sourcePath: string, partIndex: number): string {
  const heading = /^#{1,6}\s+(.+)$/mu.exec(content)?.[1]?.trim();
  const base = heading || `${basename(sourcePath)} preamble`;
  return partIndex === 0 ? base.slice(0, 120) : `${base.slice(0, 105)} part ${partIndex + 1}`;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "instructions";
}
