import { Buffer } from "node:buffer";
import {
  PROJECT_INSTRUCTION_CATALOG_PAGE_MAX_BYTES,
  PROJECT_INSTRUCTION_READ_MAX_BYTES,
  PROJECT_INSTRUCTIONS_PROMPT_BUDGET,
} from "./limits.ts";
import { getProjectInstructionFallbackPath } from "./paths.ts";
import type {
  ProjectInstructionCatalogOutput,
  ProjectInstructionMode,
  ProjectInstructionRuleRecord,
  ProjectInstructionSkillRecord,
  ProjectInstructionSourceInput,
} from "./types.ts";

export { PROJECT_INSTRUCTIONS_PROMPT_BUDGET } from "./limits.ts";

interface RenderProjectInstructionsOptions {
  agentsHash: string;
  inputHash: string;
  cacheDir: string;
  mode: ProjectInstructionMode;
  body?: string;
  sources: ProjectInstructionSourceInput[];
  rules: ProjectInstructionRuleRecord[];
  skills: ProjectInstructionSkillRecord[];
}

interface CatalogEntry {
  title: string;
  content: string;
}

export function renderProjectInstructions(options: RenderProjectInstructionsOptions): string | undefined {
  const ruleRoutes = options.rules.map((rule) => `- ${singleLine(rule.trigger, 150)}: \`${rule.link}\``);
  const skillRoutes = options.skills.map(
    (skill) =>
      `- ${singleLine(skill.description, 120)}: \`${skill.link}\` (source \`${escapeBackticks(skill.filePath)}\`)`,
  );
  const sourceBody =
    options.mode === "exact"
      ? options.sources
          .map((source) => `### Authoritative source: \`${escapeBackticks(source.path)}\`\n\n${source.content}`)
          .join("\n\n")
      : options.body?.trim() || fallbackBody(options.rules);
  const fallbackPath = getProjectInstructionFallbackPath(options.cacheDir, options.inputHash);

  const build = (rules: string[], skills: string[], body: string): string => {
    const lines = [
      `<project_instructions agents_sha256="${options.agentsHash}" mode="${options.mode}">`,
      "AGENTS/CLAUDE sources are authoritative. Extracted rules are instruction modules, not user skills.",
      "Before matching work, call read_rules with the relevant relative link and follow every returned module.",
      "Rule catalog: `rules/catalog.md`. If no route matches below, read the catalog before project work.",
      "For matching specialized guidance, call read_skills with its relative link before acting.",
      "Skill catalog: `skills/catalog.md`; relative resources keep the same skill-link prefix.",
      `If either reader is unavailable, ordinary-read \`${escapeBackticks(fallbackPath)}\` for authoritative source and physical catalog paths.`,
      "",
      body,
    ];
    if (rules.length > 0) lines.push("", "Rule routes:", ...rules);
    if (skills.length > 0) lines.push("", "Skill routes:", ...skills);
    lines.push("</project_instructions>");
    return lines.join("\n");
  };

  if (options.mode === "exact" && build([], [], sourceBody).length > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) {
    return undefined;
  }
  const boundedBody = fitBody(sourceBody, build);
  const selectedRules: string[] = [];
  const selectedSkills: string[] = [];
  let prompt = build(selectedRules, selectedSkills, boundedBody);
  for (const route of ruleRoutes) {
    const candidate = build([...selectedRules, route], selectedSkills, boundedBody);
    if (candidate.length > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) break;
    selectedRules.push(route);
    prompt = candidate;
  }
  for (const route of skillRoutes) {
    const candidate = build(selectedRules, [...selectedSkills, route], boundedBody);
    if (candidate.length > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) break;
    selectedSkills.push(route);
    prompt = candidate;
  }
  return prompt;
}

export function renderRulesCatalog(rules: ProjectInstructionRuleRecord[]): ProjectInstructionCatalogOutput {
  return renderCatalog(
    "rules",
    "Project instruction modules",
    "These are exact slices of authoritative AGENTS/CLAUDE sources. Read every module whose trigger matches.",
    rules.map((rule) => ({
      title: rule.title,
      content: [
        `- \`${rule.link}\``,
        `  - Trigger: ${singleLine(rule.trigger, 300)}`,
        `  - Source: ${rule.sourcePath}`,
      ].join("\n"),
    })),
  );
}

export function renderSkillsCatalog(skills: ProjectInstructionSkillRecord[]): ProjectInstructionCatalogOutput {
  return renderCatalog(
    "skills",
    "Available skills",
    "Use read_skills with a listed virtual link. Relative resources stay within that skill prefix.",
    skills.map((skill) => ({
      title: skill.name,
      content: [
        `- \`${skill.link}\``,
        `  - Name: ${skill.name}`,
        `  - Use when: ${singleLine(skill.description, 500)}`,
        `  - Source file: ${skill.filePath}`,
      ].join("\n"),
    })),
  );
}

function renderCatalog(
  namespace: "rules" | "skills",
  title: string,
  description: string,
  entries: CatalogEntry[],
): ProjectInstructionCatalogOutput {
  const header = `# ${title}\n\n${description}`;
  const complete = `${[header, ...entries.map((entry) => entry.content)].join("\n\n")}\n`;
  if (Buffer.byteLength(complete, "utf8") <= PROJECT_INSTRUCTION_CATALOG_PAGE_MAX_BYTES) {
    return { root: complete, pages: [] };
  }
  const entryPages = paginateEntries(entries, PROJECT_INSTRUCTION_CATALOG_PAGE_MAX_BYTES - 1_024);
  const width = String(entryPages.length).length;
  const pages = entryPages.map((page, index) => ({
    link: `${namespace}/catalog-pages/${String(index + 1).padStart(width, "0")}.md`,
    content: `${header}\n\nPage ${index + 1} of ${entryPages.length}.\n\n${page.map((entry) => entry.content).join("\n\n")}\n`,
  }));
  const indexLines = [
    header,
    "",
    "The catalog is paginated. Read every page whose title range may match the work:",
    ...pages.map((page, index) => {
      const entriesOnPage = entryPages[index];
      return `- \`${page.link}\`: ${singleLine(entriesOnPage[0].title, 80)} through ${singleLine(entriesOnPage.at(-1)?.title ?? "", 80)}`;
    }),
  ];
  const root = `${indexLines.join("\n")}\n`;
  if (Buffer.byteLength(root, "utf8") > PROJECT_INSTRUCTION_READ_MAX_BYTES) {
    throw new Error(`${title} index exceeds the read limit`);
  }
  return { root, pages };
}

function paginateEntries(entries: CatalogEntry[], pageEntryBudget: number): CatalogEntry[][] {
  const pages: CatalogEntry[][] = [];
  let current: CatalogEntry[] = [];
  let currentBytes = 0;
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(`${entry.content}\n\n`, "utf8");
    if (entryBytes > pageEntryBudget) {
      throw new Error(`Catalog entry exceeds the page limit: ${entry.title}`);
    }
    if (current.length > 0 && currentBytes + entryBytes > pageEntryBudget) {
      pages.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entryBytes;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

function fitBody(sourceBody: string, build: (rules: string[], skills: string[], body: string) => string): string {
  const empty = build([], [], "");
  if (empty.length > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) {
    throw new Error("Project instruction routing metadata exceeds the prompt budget");
  }
  const allowance = PROJECT_INSTRUCTIONS_PROMPT_BUDGET - empty.length;
  if (sourceBody.length <= allowance) return sourceBody;
  const marker = "\n[optimized body truncated; use the rule catalog]";
  return `${safeSlice(sourceBody, Math.max(0, allowance - marker.length)).trimEnd()}${marker}`;
}

function safeSlice(value: string, maxCodeUnits: number): string {
  let end = Math.min(value.length, maxCodeUnits);
  if (end > 0 && end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1])) end--;
  return value.slice(0, end);
}

function fallbackBody(rules: ProjectInstructionRuleRecord[]): string {
  if (rules.length === 0) return "No project rule modules were discovered.";
  return [
    "Apply the authoritative project rules. Retrieve exact modules before acting on their topics.",
    ...rules.slice(0, 12).map((rule) => `- ${singleLine(rule.trigger, 120)}: read \`${rule.link}\`.`),
  ].join("\n");
}

function singleLine(value: string, maxChars: number): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function escapeBackticks(value: string): string {
  return value.replace(/`/g, "\\`");
}
