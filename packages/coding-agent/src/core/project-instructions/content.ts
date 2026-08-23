import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Skill } from "../skills.ts";
import { scanProjectInstructionStructuralUnits } from "./compiler-structural-units.ts";
import { PROJECT_INSTRUCTION_MODULE_MAX_BYTES } from "./limits.ts";
import { consumeMarkdownFence, createMarkdownFenceState, getMarkdownHeadingMarker } from "./markdown-structure.ts";
import type {
  ProjectInstructionModuleInput,
  ProjectInstructionSkillRecord,
  ProjectInstructionSourceInput,
  ProjectInstructionSourceRecord,
} from "./types.ts";

export const PROJECT_INSTRUCTION_ARTIFACT_RENDERER_VERSION = "project-instructions-artifact-v2-list-skills";

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
  compilerIdentity: string,
  artifactRendererVersion = PROJECT_INSTRUCTION_ARTIFACT_RENDERER_VERSION,
): string {
  return hashText(
    JSON.stringify({
      agentsHash,
      compilerIdentity,
      artifactRendererVersion,
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
    sections.forEach(({ content: section, startOffset }, sectionIndex) => {
      let sectionOffset = 0;
      splitLargeSection(section, source.path).forEach((content, partIndex) => {
        const sourceStartOffset = startOffset + sectionOffset;
        const activeHeadingContext = getActiveHeadingContext(
          source.content.slice(0, sourceStartOffset),
          sourceIndex + 1,
        );
        const leadingHeadingLevel = partIndex === 0 ? getMarkdownHeadingMarker(content)?.length : undefined;
        const headingContext =
          leadingHeadingLevel === undefined
            ? activeHeadingContext
            : activeHeadingContext.filter((heading) => heading.level < leadingHeadingLevel);
        const title = getSectionTitle(content, source.path, partIndex, headingContext.at(-1)?.content);
        const slug = slugify(title);
        const id = `${sourceIndex + 1}-${sectionIndex + 1}-${partIndex + 1}-${slug}-${hashText(content).slice(0, 8)}`;
        modules.push({
          id,
          link: `rules/${id}.md`,
          title,
          sourcePath: source.path,
          content,
          sourceOrdinal: sourceIndex + 1,
          sourceStartOffset,
          headingContext,
        });
        sectionOffset += content.length;
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

function splitAtMajorHeadings(content: string): Array<{ content: string; startOffset: number }> {
  if (!content) return [];
  const lines = content.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  const sections: Array<{ content: string; startOffset: number }> = [];
  const fence = createMarkdownFenceState();
  let current = "";
  let currentStartOffset = 0;
  let offset = 0;
  for (const line of lines) {
    const fenceEvent = consumeMarkdownFence(line.replace(/(?:\r\n|\r|\n)$/u, ""), fence);
    const headingMarker = fenceEvent ? undefined : getMarkdownHeadingMarker(line);
    if (current && headingMarker && headingMarker.length <= 2) {
      sections.push({ content: current, startOffset: currentStartOffset });
      current = "";
      currentStartOffset = offset;
    }
    current += line;
    offset += line.length;
  }
  if (current) sections.push({ content: current, startOffset: currentStartOffset });
  return sections;
}

function splitLargeSection(section: string, sourcePath: string): string[] {
  if (Buffer.byteLength(section, "utf8") <= PROJECT_INSTRUCTION_MODULE_MAX_BYTES) return [section];
  const boundaries = scanProjectInstructionStructuralUnits(section).splitOffsets;
  const parts: string[] = [];
  let startOffset = 0;
  while (startOffset < section.length) {
    let splitAt: number | undefined;
    for (const boundary of boundaries) {
      if (boundary <= startOffset) continue;
      if (Buffer.byteLength(section.slice(startOffset, boundary), "utf8") > PROJECT_INSTRUCTION_MODULE_MAX_BYTES) break;
      splitAt = boundary;
    }
    if (splitAt === undefined) {
      const nextBoundary = boundaries.find((boundary) => boundary > startOffset) ?? section.length;
      const unitBytes = Buffer.byteLength(section.slice(startOffset, nextBoundary), "utf8");
      throw new Error(
        `Project instruction source ${sourcePath} contains a single structural instruction unit of ${unitBytes} bytes that exceeds the ${PROJECT_INSTRUCTION_MODULE_MAX_BYTES}-byte module limit`,
      );
    }
    parts.push(section.slice(startOffset, splitAt));
    startOffset = splitAt;
  }
  return parts;
}

function getSectionTitle(content: string, sourcePath: string, partIndex: number, inheritedHeading?: string): string {
  const heading = /^ {0,3}#{1,6}\s+(.+)$/mu.exec(content)?.[1]?.trim();
  const inheritedTitle = /^ {0,3}#{1,6}\s+(.+)$/u.exec(inheritedHeading ?? "")?.[1]?.trim();
  const base = heading || inheritedTitle || `${basename(sourcePath)} preamble`;
  return partIndex === 0 ? base.slice(0, 120) : `${base.slice(0, 105)} part ${partIndex + 1}`;
}

function getActiveHeadingContext(
  content: string,
  sourceOrdinal: number,
): Array<{ id: string; content: string; sourceText: string; level: number }> {
  const headings: Array<{ id: string; level: number; content: string; sourceText: string }> = [];
  const fence = createMarkdownFenceState();
  let offset = 0;
  for (const lineWithEnding of content.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []) {
    const line = lineWithEnding.replace(/(?:\r\n|\r|\n)$/u, "");
    const fenceEvent = consumeMarkdownFence(line, fence);
    const headingMarker = fenceEvent ? undefined : getMarkdownHeadingMarker(line);
    if (headingMarker) {
      const level = headingMarker.length;
      const retainedCount = headings.findIndex((heading) => heading.level >= level);
      if (retainedCount >= 0) headings.splice(retainedCount);
      headings.push({ id: `heading-${sourceOrdinal}-${offset}`, level, content: line, sourceText: lineWithEnding });
    }
    offset += lineWithEnding.length;
  }
  return headings.map(({ id, content: headingContent, sourceText, level }) => ({
    id,
    content: headingContent,
    sourceText,
    level,
  }));
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
