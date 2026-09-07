/**
 * System prompt construction and project context loading
 */

import type { CompletionMode } from "@dst0/p-agent-core";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { LearningsStore } from "./learnings/learnings-store.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";
import { formatCompletionProtocolInstructions } from "./system-prompt/completion-protocol.ts";
import { formatContextFileForPrompt } from "./system-prompt/context-formatting.ts";
import { formatTaskVerificationGuideline } from "./system-prompt/task-verification-guidance.ts";
import type { TaskVerificationMode } from "./task-verification/mode.ts";

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
  /** Evidence policy to describe in completion guidance. */
  taskVerificationMode?: TaskVerificationMode;
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
    taskVerificationMode,
  } = options;
  const resolvedCwd = cwd;
  const promptCwd = resolvedCwd.replace(/\\/g, "/");

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const date = `${year}-${month}-${day}`;

  const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
  const completionProtocolSection = formatCompletionProtocolInstructions(completionMode, taskVerificationMode);
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
      "Use semantic_search when identifiers or paths are unknown; inspect cited files, and reserve exact search for known literals.",
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
    addGuideline("For unfamiliar or time-sensitive claims, use available web tools and prefer authoritative sources.");
  }
  addGuideline(
    "Plan the smallest complete outcome that satisfies the request. Establish a baseline when relevant, verify each meaningful increment, fix failures before expanding, and finish required checks and deliverables before optional work.",
  );
  addGuideline(
    "Preserve declared transaction, rollback, irreversibility, and append-only semantics. Never invent rollback for irreversible effects or rewrite audit history; when rollback is required, restore only contract-declared reversible state.",
  );
  addGuideline(formatTaskVerificationGuideline(taskVerificationMode));
  addGuideline(
    "Preserve exact requested formats and boundaries. When whitespace, framing, ordering, units, or byte-level representation is material, verify the raw artifact rather than an implicitly normalized view.",
  );
  addGuideline(
    "For implementation changes, run the relevant static checks and focused tests plus any broader checks the user or project requires. Distinguish focused evidence from full-suite evidence and fix failures caused by the change.",
  );
  addGuideline(
    "When fixing tests or compiler errors, prefer precise edit calls on failing logic over whole-file write calls; preserve verified invariants and avoid collateral regressions.",
  );
  addGuideline(
    "Use compact, high-signal tool output and preserve full logs outside model context when needed. Treat exit status as authoritative and never mask a failed operation with trailing success output.",
  );
  addGuideline(
    "For complex testing, architecture, or ecosystem integrations, consult loaded specialized skills for domain playbooks and reference patterns.",
  );

  const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

  let prompt = `You are an expert task assistant in p. Help users understand information, reason, create artifacts, and safely execute available tools.

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
- Before answering p questions or performing p work, read relevant .md files completely, inspect relevant examples, and follow their .md cross-references`;

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
