/**
 * System prompt construction and project context loading
 */

import type { CompletionMode } from "@dst0/p-agent-core";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { LearningsStore } from "./learnings/learnings-store.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";
import { formatCompletionProtocolInstructions } from "./system-prompt/completion-protocol.ts";
import { formatContextFileForPrompt } from "./system-prompt/context-formatting.ts";

export { formatCompletionProtocolInstructions } from "./system-prompt/completion-protocol.ts";
export { formatContextFileForPrompt } from "./system-prompt/context-formatting.ts";

export interface BuildSystemPromptOptions {
  /** Custom system prompt (replaces default). */
  customPrompt?: string;
  /** Tools to include in prompt. Default: [read, bash, edit, write] */
  selectedTools?: string[];
  /** Optional one-line tool snippets keyed by tool name. */
  toolSnippets?: Record<string, string>;
  /** Additional guideline bullets appended to the default system prompt guidelines. */
  promptGuidelines?: string[];
  /** Text to append to system prompt. */
  appendSystemPrompt?: string;
  /** Working directory. */
  cwd: string;
  /** Pre-loaded context files. */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Pre-loaded skills. */
  skills?: Skill[];
  /** Prepared, budget-bounded project instruction block. */
  projectInstructions?: string;
  /** Completion protocol to instruct the model about. */
  completionMode?: CompletionMode;
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const {
    customPrompt,
    selectedTools,
    toolSnippets,
    promptGuidelines,
    appendSystemPrompt,
    cwd,
    contextFiles: providedContextFiles,
    skills: providedSkills,
    projectInstructions,
    completionMode,
  } = options;
  const resolvedCwd = cwd;
  const promptCwd = resolvedCwd.replace(/\\/g, "/");

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const date = `${year}-${month}-${day}`;

  const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
  const completionProtocolSection = formatCompletionProtocolInstructions(completionMode);
  const completionSection = completionProtocolSection ? `\n\n${completionProtocolSection}` : "";

  const contextFiles = providedContextFiles ?? [];
  const skills = providedSkills ?? [];
  const learningsStore = new LearningsStore({ cwd: resolvedCwd });
  const learningsSection = learningsStore.formatForPrompt(5);

  if (customPrompt) {
    let prompt = customPrompt;

    if (appendSection) {
      prompt += appendSection;
    }
    if (completionSection) {
      prompt += completionSection;
    }

    if (projectInstructions) {
      prompt += `\n\n${projectInstructions}\n`;
    } else if (contextFiles.length > 0) {
      prompt += "\n\n<project_context>\n\n";
      prompt += "Project-specific instructions and guidelines:\n\n";
      for (const { path: filePath, content } of contextFiles) {
        prompt += `<project_instructions path="${filePath}">\n${formatContextFileForPrompt(filePath, content)}\n</project_instructions>\n\n`;
      }
      prompt += "</project_context>\n";
    }

    if (learningsSection) {
      prompt += `\n\n${learningsSection}\n`;
    }

    // Append skills section (only if read tool is available)
    const customPromptHasRead = !selectedTools || selectedTools.includes("read");
    if (!projectInstructions && customPromptHasRead && skills.length > 0) {
      prompt += formatSkillsForPrompt(skills);
    }

    // Add date and working directory last
    prompt += `\nCurrent date: ${date}`;
    prompt += `\nCurrent working directory: ${promptCwd}`;

    return prompt;
  }

  // Get absolute paths to documentation and examples
  const readmePath = getReadmePath();
  const docsPath = getDocsPath();
  const examplesPath = getExamplesPath();

  // Build tools list based on selected tools.
  const tools = selectedTools || ["read", "bash", "edit", "write"];
  const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
  const toolsList =
    visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

  // Build guidelines based on which tools are actually available
  const guidelinesList: string[] = [];
  const guidelinesSet = new Set<string>();
  const addGuideline = (guideline: string): void => {
    if (guidelinesSet.has(guideline)) {
      return;
    }
    guidelinesSet.add(guideline);
    guidelinesList.push(guideline);
  };

  const hasBash = tools.includes("bash");
  const hasGrep = tools.includes("grep") || tools.includes("rg");
  const hasFind = tools.includes("find");
  const hasLs = tools.includes("ls");
  const hasRead = tools.includes("read");
  const hasSemanticSearch = tools.includes("semantic_search");

  // File exploration guidelines
  if (hasSemanticSearch) {
    addGuideline(
      "Prioritize semantic_search for code discovery when identifiers or paths are unknown; inspect cited files, and reserve rg/find for exact identifiers or literals.",
    );
  }
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline("Use bash for ls, rg, or find only when the corresponding dedicated tool is unavailable.");
  }
  if (hasBash || hasGrep || hasFind || hasLs || hasRead) {
    addGuideline(
      "Recover from tool syntax, path, allowlist, or command-choice errors by correcting the call or using an equivalent available tool, then continue.",
    );
  }

  for (const guideline of promptGuidelines ?? []) {
    const normalized = guideline.trim();
    if (normalized.length > 0) {
      addGuideline(normalized);
    }
  }

  addGuideline("Be concise and show file paths clearly.");
  addGuideline(
    "End created or edited text files (including source, JSON/JSONL, Markdown, and config files) with '\\n' unless explicitly requested otherwise.",
  );

  const hasWebResearch = tools.some((toolName) => /(?:web|browser|fetch|curl)/iu.test(toolName));
  if (hasWebResearch) {
    addGuideline(
      "Proactive Web Research & Validation: For unfamiliar packages, protocols, architectures, or uncertain approaches, research official docs, real examples, and library error modes.",
    );
  }
  addGuideline(
    "For homogeneous 1-to-1 batch functions over T[], return R[] directly, not a wrapper such as { results: R[] }.",
  );
  addGuideline(
    "After any required baseline, implement the smallest complete production slice. Run each new or changed test immediately; fix it before writing another. Budget work so required coverage, requested final checks, and deliverables finish before optional expansion. Cover each exported function, public method, static factory, and lifecycle function for normal, negative, boundary, failure/recovery, and invariant cases.",
  );
  addGuideline(
    "Transactional operations require atomic rollback: on any mid-operation failure, revert state changes, external mutations, caches, logs, and tracking registries to their pre-operation state.",
  );
  addGuideline(
    "Before completion, re-read the original specification line by line and audit every requirement: verify happy paths, negative inputs, specific error types, idempotency, boundaries, and corruption/integrity handling are implemented and asserted by dedicated tests.",
  );
  addGuideline(
    "For exact record formats (JSONL/NDJSON), validate framing before trimming: if terminal '\\n' is required, verify raw input ends with '\\n' before splitting and prove validPayload.slice(0, -1) throws the domain validation error.",
  );
  addGuideline(
    "Use domain-specific custom errors, not generic Error, for business invariants, validation, or optimistic concurrency violations.",
  );
  addGuideline(
    "Before declaring code complete, run the type checker and relevant tests, then the full test suite to 100% green. Fix every type error and test failure.",
  );
  addGuideline(
    "When fixing tests or compiler errors, prefer precise edit calls on failing logic over whole-file write calls; preserve verified invariants and avoid collateral regressions.",
  );
  addGuideline(
    "Output Discipline: plan the smallest useful target and use compact output. Preserve full output outside model context when needed. Treat exit codes as authoritative: use throwing assertions; never use `console.assert` for verification, never append `; echo $?`, and never add trailing success that masks status.",
  );
  addGuideline(
    "For complex testing, architecture, or ecosystem integrations, consult loaded specialized skills for domain playbooks and reference patterns.",
  );

  const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

  let prompt = `You are an expert coding assistant in p. Help users inspect, execute, edit, and create files.

Available tools:
${toolsList}

Other project-specific custom tools may also be available.

Guidelines:
${guidelines}

p documentation (read only for questions or work about p, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- Resolve docs/... under Additional docs and examples/... under Examples, not cwd
- Topic map: extensions: docs/extensions.md and examples/extensions/; themes: docs/themes.md; skills: docs/skills.md; prompt templates: docs/prompt-templates.md; TUI: docs/tui.md; keybindings: docs/keybindings.md; SDK: docs/sdk.md; providers: docs/custom-provider.md; models: docs/models.md; packages: docs/packages.md
- Before answering p questions or implementing p work, read relevant .md files completely, inspect relevant examples, and follow their .md cross-references`;

  if (appendSection) {
    prompt += appendSection;
  }
  if (completionSection) {
    prompt += completionSection;
  }

  if (projectInstructions) {
    prompt += `\n\n${projectInstructions}\n`;
  } else if (contextFiles.length > 0) {
    prompt += "\n\n<project_context>\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path: filePath, content } of contextFiles) {
      prompt += `<project_instructions path="${filePath}">\n${formatContextFileForPrompt(filePath, content)}\n</project_instructions>\n\n`;
    }
    prompt += "</project_context>\n";
  }

  if (learningsSection) {
    prompt += `\n\n${learningsSection}\n`;
  }

  // Append skills section (only if read tool is available)
  if (!projectInstructions && hasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
  }

  // Add date and working directory last
  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}
