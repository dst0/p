/**
 * System prompt construction and project context loading
 */

import { type CompletionMode, FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";
import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

const MAX_FULL_CONTEXT_FILE_CHARS = 6000;
const MAX_COMPACT_CONTEXT_FILE_CHARS = 6000;
const RULE_KEYWORD_PATTERN =
	/\b(always|ask|before|block|cannot|commands?|do not|don't|must|never|no \w+|only|required|rules?|run|should|test|use \w+|verify)\b|^\s*(No |Prefer |Avoid |For |Use )/i;

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

function formatCompletionProtocolInstructions(mode: CompletionMode | undefined): string {
	const sessionStateInstructions = [
		`Before calling \`${FINISH_WORK_TOOL_NAME}\`, reconcile the visible working state.`,
		"A next action must be a specific unfinished action; never use completed or status-only entries such as `Done`, `Complete`, or `All done`. Record completed work as progress, and leave next actions empty when no work remains.",
		"Use `initial_plan` only for a fresh task with no active plan; otherwise use `replan` to replace the complete current plan.",
		`If \`${FINISH_WORK_TOOL_NAME}\` is rejected for unresolved state, do not retry it unchanged: first update or replan the state, or finish as partial/failed with remaining work.`,
		"Use session-state tools to update that state. Never edit `.pdev` state or snapshot files directly; they do not update the running session.",
	].join(" ");
	if (mode === "explicit_finish") {
		return [
			"You are operating in explicit completion mode.",
			`You must not end the task with a normal assistant message. When the task is complete, call \`${FINISH_WORK_TOOL_NAME}\`.`,
			"If more work is needed, call tools.",
			`If you encounter an unrecoverable problem, call \`${FINISH_WORK_TOOL_NAME}\` with status \`failed\` or \`partial\` and explain the remaining issue.`,
			sessionStateInstructions,
		].join("\n");
	}
	if (mode === "hybrid") {
		return [
			"You are operating in hybrid completion mode.",
			`Prefer calling \`${FINISH_WORK_TOOL_NAME}\` when the task is complete instead of ending with a normal assistant message.`,
			"If more work is needed, call tools.",
			`If you encounter an unrecoverable problem, call \`${FINISH_WORK_TOOL_NAME}\` with status \`failed\` or \`partial\` and explain the remaining issue.`,
			sessionStateInstructions,
		].join("\n");
	}
	return "";
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
	// A tool appears in Available tools only when the caller provides a one-line snippet.
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
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration guidelines
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

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");
	addGuideline("After writing or modifying tests, run them immediately to verify they pass before proceeding");
	addGuideline(
		"When editing, writing, creating, or refactoring code, write tests for the changes unless the user explicitly asks not to",
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

export function formatContextFileForPrompt(filePath: string, content: string): string {
	if (content.length <= MAX_FULL_CONTEXT_FILE_CHARS) {
		return content;
	}

	const selectedLines: string[] = [
		`[Large project rules file compacted from ${content.length} chars.]`,
		`Full rules remain available at ${filePath}; read the file before broad changes or when exact wording matters.`,
		"",
	];
	let omitted = 0;
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("#") || RULE_KEYWORD_PATTERN.test(trimmed)) {
			selectedLines.push(line);
		} else {
			omitted++;
		}
		if (selectedLines.join("\n").length >= MAX_COMPACT_CONTEXT_FILE_CHARS) {
			break;
		}
	}

	if (omitted > 0) {
		selectedLines.push("", `[${omitted} lower-signal lines omitted from prompt context.]`);
	}

	const compacted = selectedLines.join("\n");
	if (compacted.length <= MAX_COMPACT_CONTEXT_FILE_CHARS) {
		return compacted;
	}
	return `${compacted.slice(0, MAX_COMPACT_CONTEXT_FILE_CHARS - 80).trimEnd()}\n[compacted rules truncated to prompt budget]`;
}
