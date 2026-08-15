/**
 * System prompt construction and project context loading
 */

import type { CompletionMode } from "@dst0/p-agent-core";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
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

  if (customPrompt) {
    let prompt = customPrompt;

    if (appendSection) {
      prompt += appendSection;
    }
    if (completionSection) {
      prompt += completionSection;
    }

    // Append project context files
    if (contextFiles.length > 0) {
      prompt += "\n\n<project_context>\n\n";
      prompt += "Project-specific instructions and guidelines:\n\n";
      for (const { path: filePath, content } of contextFiles) {
        prompt += `<project_instructions path="${filePath}">\n${formatContextFileForPrompt(filePath, content)}\n</project_instructions>\n\n`;
      }
      prompt += "</project_context>\n";
    }

    // Append skills section (only if read tool is available)
    const customPromptHasRead = !selectedTools || selectedTools.includes("read");
    if (customPromptHasRead && skills.length > 0) {
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

  // Core agent guidelines
  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");
  addGuideline(
    "Before implementing non-trivial features, architectural changes, third-party library integrations, concurrency logic, or test strategies, use web search to consult current ecosystem best practices, error modes, and framework edge cases.",
  );
  addGuideline(
    "When modifying or creating code, write tests covering all changes across the 5-factor test matrix: positive paths, negative paths, boundary edge cases, crash/recovery (e.g. AbortSignal, I/O errors, rollbacks), and invariant preservation. Superficial mocks or assertions added solely to pass line coverage without validating domain logic are prohibited.",
  );
  addGuideline(
    "Consult the software-testing skill and its reference playbooks for TDD workflows, invariant contracts, realistic fixture isolation, and mutation self-verification.",
  );
  addGuideline("Run tests after writing or modifying them to verify they pass before proceeding");
  addGuideline(
    "Before final verification, map every explicit acceptance requirement to fresh evidence. For absolute or negative guarantees such as any, all, never, exactly, atomic, idempotent, or tamper-proof, add adversarial boundary tests; passing visible tests alone is not sufficient",
  );
  addGuideline(
    "For transactional and serialization guarantees, test the smallest boundary mutation literally: remove exactly one final byte, not a whole line or record. After every failed atomic operation, retry each attempted identity with both the same and changed payload to prove that state, logs, positions, hashes, and idempotency registries all rolled back. A coarser proxy test does not satisfy an exact boundary requirement",
  );
  addGuideline(
    "Preserve public API shapes exactly and do not invent response wrappers. For idempotency, compare a lossless canonical identity containing every semantically relevant command field and option; never use a partial projection such as only operation type and resource ID",
  );
  addGuideline(
    "After writing any guard, validation, or idempotency check, trace every branch: list the input states, the boolean conditions evaluated, and which path is taken. Verify the throw path triggers only on the intended violation, not on the happy path. A common error is inverting the condition so valid inputs are rejected.",
  );
  addGuideline(
    "Every filter, parser, or line splitter must include a test for the exact truncation boundary: a string missing its final newline terminator. Verify the code rejects incomplete data, not just malformed data.",
  );
  addGuideline(
    "Before declaring any code complete, run the type checker and visible test suite. Do not assume code compiles or tests pass based on syntax alone. Fix all type errors and test failures before moving to the next step.",
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

  // Append project context files
  if (contextFiles.length > 0) {
    prompt += "\n\n<project_context>\n\n";
    prompt += "Project-specific instructions and guidelines:\n\n";
    for (const { path: filePath, content } of contextFiles) {
      prompt += `<project_instructions path="${filePath}">\n${formatContextFileForPrompt(filePath, content)}\n</project_instructions>\n\n`;
    }
    prompt += "</project_context>\n";
  }

  // Append skills section (only if read tool is available)
  if (hasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
  }

  // Add date and working directory last
  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}
