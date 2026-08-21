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
      "Prioritize semantic_search over bash, read, rg, and find for code discovery. Use semantic_search to locate code by concept when identifiers or paths are unknown, then inspect the cited files. Reserve rg/find for exact identifiers and literals.",
    );
  }
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline(
      "Use bash for file operations like ls, rg, find when dedicated tools are unavailable. Always prefer dedicated tools (grep, find, ls) when they are available.",
    );
  }
  if (hasBash || hasGrep || hasFind || hasLs || hasRead) {
    addGuideline(
      "If a tool call fails from a recoverable syntax, path, allowlist, or command-choice error, correct the call or use an equivalent available tool and continue.",
    );
  }

  for (const guideline of promptGuidelines ?? []) {
    const normalized = guideline.trim();
    if (normalized.length > 0) {
      addGuideline(normalized);
    }
  }

  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");
  addGuideline(
    "When creating or editing files (source code, JSON, JSONL, markdown, configs), always ensure the content terminates with a trailing newline ('\\n') unless explicitly requested otherwise. This preserves clean single-line diffs on future appends and adheres to POSIX line standards.",
  );

  const hasWebResearch = tools.some((toolName) => /(?:web|browser|fetch|curl)/iu.test(toolName));
  if (hasWebResearch) {
    addGuideline(
      "Proactive Web Research & Validation: When starting a task involving unfamiliar packages, complex protocols, ambiguous architectures, or when uncertain about the optimal implementation approach, do not guess. Proactively perform web research to consult official documentation, ecosystem standards, real-world examples, and library error modes before writing code.",
    );
  }
  addGuideline(
    "Collection & Batch Return Signatures (Homogeneous Mapping): When implementing functions that operate on an array or batch of inputs (T[]), the return type must be the direct array of item results (R[]) matching input items 1-to-1, rather than an artificial wrapper object (e.g. return R[] directly, not { results }), preserving standard array iteration and .length properties.",
  );
  addGuideline(
    "Develop and verify iteratively: write focused code, then accompany it with domain tests covering positive paths, negative inputs, boundary conditions, failure/recovery modes, and invariant preservation.",
  );
  addGuideline(
    "API Method Test Exhaustiveness: Every public method, static factory, and function exported by the module must have dedicated unit tests covering normal execution, edge cases, and failure modes. Never leave any public API method or lifecycle function untested in your test suite.",
  );
  addGuideline(
    "Ensure transactional operations guarantee atomic rollback: on any mid-operation failure, all state modifications, external mutations, caches, logs, and tracking registries must revert cleanly to their pre-operation state.",
  );
  addGuideline(
    "Perform an explicit Requirements Traceability Audit before declaring work complete: re-read the original specification line-by-line, verifying that every requirement (happy paths, negative inputs, specific error types, idempotency rules, boundary conditions, and corruption/integrity handling) is implemented and asserted by dedicated tests.",
  );
  addGuideline(
    "Stream & File Framing Integrity: In line-delimited and record-oriented protocols (e.g. JSONL/NDJSON), every valid stream must strictly terminate with a newline. When parsing, assert that the raw input string ends with '\\n' before splitting; reject with the domain validation error if the terminating delimiter is missing or stripped.",
  );
  addGuideline(
    "Domain Error Hierarchy: Instantiate and throw domain-specific custom error types for business invariant, validation, or optimistic concurrency violations, rather than unadorned generic 'new Error()'.",
  );
  addGuideline(
    "Before declaring code complete, run the type checker and test suite to ensure clean compilation and 100% green tests. Fix all type errors and test failures before finishing.",
  );
  addGuideline(
    "When fixing test failures or compiler errors in existing code, prefer precise 'edit' calls targeting the specific failing logic over completely rewriting files with 'write'. Retain verified invariants and avoid collateral regressions.",
  );
  addGuideline(
    "Context Efficiency & Tool Output Discipline: Before running tests, builds, benchmarks, or log-heavy commands, plan the smallest useful target and use available harnesses, quiet reporters, or output wrappers so the model reads only a compact PASS result or a FAIL result with the decisive reason. Preserve full output outside model context when it is needed for diagnosis. Treat the process exit code as authoritative; never infer success from a trailing 'success' or 'done' line.",
  );
  addGuideline(
    "When working on complex testing, architecture, or ecosystem integrations, consult any loaded specialized skills for domain playbooks and reference patterns.",
  );

  const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

  let prompt = `You are an expert coding assistant operating inside p, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

p documentation (read only when the user asks about p itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When reading p docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), p packages (docs/packages.md)
- When working on p topics, read the docs and examples, and follow .md cross-references before implementing
- Always read p .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

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
