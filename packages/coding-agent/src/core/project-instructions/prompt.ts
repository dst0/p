import { Buffer } from "node:buffer";
import {
  PROJECT_INSTRUCTION_CATALOG_PAGE_MAX_BYTES,
  PROJECT_INSTRUCTION_READ_MAX_BYTES,
  PROJECT_INSTRUCTIONS_PROMPT_BUDGET,
  PROJECT_INSTRUCTIONS_PROMPT_TARGET,
} from "./limits.ts";
import { getProjectInstructionFallbackPath } from "./paths.ts";
import { getMaximumProjectInstructionTurnContextLength } from "./routing.ts";
import type {
  PreparedProjectInstructions,
  ProjectInstructionCatalogOutput,
  ProjectInstructionMode,
  ProjectInstructionRuleRecord,
  ProjectInstructionSkillRecord,
  ProjectInstructionSourceInput,
} from "./types.ts";
import { inferProjectInstructionRulePhases } from "./work-phases.ts";

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

const RULE_CATALOG_GUIDANCE = "Rule catalog: `rules/catalog.md`; use read_rules only with cataloged rules/* links.";
const LIST_SKILLS_GUIDANCE = "Use list_skills for bounded metadata-only skill discovery.";
const READ_SKILLS_GUIDANCE = "Use read_skills only with selected cataloged skills/* virtual links.";

export function selectProjectInstructionPromptForTools(
  prepared: PreparedProjectInstructions,
  toolNames: readonly string[],
): string {
  const activeTools = new Set(toolNames);
  let prompt = prepared.prompt;
  if (!activeTools.has("read_rules")) prompt = removeGuidance(prompt, RULE_CATALOG_GUIDANCE);
  if (!activeTools.has("list_skills")) prompt = removeGuidance(prompt, LIST_SKILLS_GUIDANCE);
  if (!activeTools.has("read_skills")) prompt = removeGuidance(prompt, READ_SKILLS_GUIDANCE);
  if (!activeTools.has("read") || activeTools.has("read_rules") || activeTools.has("read_skills")) {
    prompt = removeGuidance(prompt, fallbackGuidance(prepared.cacheDir, prepared.manifest.inputHash));
  }
  return prompt;
}

export function renderProjectInstructions(options: RenderProjectInstructionsOptions): string | undefined {
  const sourceBody =
    options.mode === "exact"
      ? options.sources
          .map((source) => `### Authoritative source: \`${escapeBackticks(source.path)}\`\n\n${source.content}`)
          .join("\n\n")
      : options.body?.trim()
        ? options.body
        : fallbackBody(options.rules);
  const build = (body: string): string => {
    return [
      `<project_instructions agents_sha256="${options.agentsHash}" input_sha256="${options.inputHash}" mode="${options.mode}">`,
      "AGENTS/CLAUDE sources are authoritative. Extracted rules are instruction modules, not user skills.",
      "Apply these always-on constraints:",
      body,
      ...(options.mode === "exact"
        ? [
            "Per-turn links are candidates. The first potentially mutating action supplies the sole authoritative 1-3-link read_rules batch.",
          ]
        : []),
      RULE_CATALOG_GUIDANCE,
      LIST_SKILLS_GUIDANCE,
      READ_SKILLS_GUIDANCE,
      fallbackGuidance(options.cacheDir, options.inputHash),
      "</project_instructions>",
    ].join("\n");
  };
  if (build("").length > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) {
    throw new Error("Project instruction routing metadata exceeds the prompt budget");
  }

  const exactPrompt = build(sourceBody);
  if (options.mode === "exact" && exactPrompt.length > PROJECT_INSTRUCTIONS_PROMPT_TARGET) {
    return undefined;
  }
  if (options.mode === "exact") return exactPrompt;
  const prompt = build(sourceBody);
  const routeReserve = getMaximumProjectInstructionTurnContextLength(options.rules, options.inputHash);
  if (prompt.length + routeReserve > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) return undefined;
  return prompt;
}

export function renderRulesCatalog(rules: ProjectInstructionRuleRecord[]): ProjectInstructionCatalogOutput {
  return renderCatalog(
    "rules",
    "Project instruction modules",
    "These are exact slices of authoritative AGENTS/CLAUDE sources. Lifecycle phases are additive; semantic triggers remain authoritative.",
    rules.map((rule) => {
      const phases = inferProjectInstructionRulePhases(rule);
      return {
        title: rule.title,
        content: [
          `- \`${rule.link}\``,
          `  - Trigger: ${singleLine(rule.trigger, 300)}`,
          `  - Requires: ${rule.requires?.length ? rule.requires.join(", ") : "none"}`,
          `  - Phases: ${phases.length > 0 ? phases.join(", ") : "semantic-only"}`,
          `  - Source: ${rule.sourcePath}`,
        ].join("\n"),
      };
    }),
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

function fallbackBody(rules: ProjectInstructionRuleRecord[]): string {
  if (rules.length === 0) return "No project rule modules were discovered.";
  return "No optimized always-on body is available. Exact rule modules remain authoritative.";
}

function fallbackGuidance(cacheDir: string, inputHash: string): string {
  const fallbackPath = getProjectInstructionFallbackPath(cacheDir, inputHash);
  return `Only when neither logical reader is active, ordinary-read \`${escapeBackticks(fallbackPath)}\` for authoritative source and physical catalog paths; never pass this path to read_rules or read_skills.`;
}

function removeGuidance(prompt: string, guidance: string): string {
  return prompt.replace(`\n${guidance}`, "");
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
