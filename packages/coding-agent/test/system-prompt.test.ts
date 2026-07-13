import { describe, expect, test } from "vitest";
import { buildSystemPrompt, formatContextFileForPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("instructs models to resolve pi docs and examples under absolute base paths", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain(
				"- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
			);
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("adds recoverable tool-call failure guidance when tools are available", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "bash"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("recoverable syntax, path, allowlist, or command-choice error");
		});

		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});

	describe("completion protocol", () => {
		test("adds explicit_finish instructions and finish_work tool snippet", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "finish_work"],
				toolSnippets: {
					finish_work: "Terminate explicitly",
				},
				completionMode: "explicit_finish",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- finish_work: Terminate explicitly");
			expect(prompt).toContain("You are operating in explicit completion mode.");
			expect(prompt).toContain("You must not end the task with a normal assistant message.");
			expect(prompt).toContain("call `finish_work`");
		});

		test("requires reconciling next actions before finishing", () => {
			const prompt = buildSystemPrompt({
				completionMode: "explicit_finish",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("never use completed or status-only entries such as `Done`");
			expect(prompt).toContain("leave next actions empty when no work remains");
			expect(prompt).toContain("Never edit `.pdev` state or snapshot files directly");
		});

		test("adds completion instructions to custom prompts", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "Custom base prompt.",
				completionMode: "explicit_finish",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Custom base prompt.");
			expect(prompt).toContain("You are operating in explicit completion mode.");
			expect(prompt).toContain("Current working directory:");
		});

		test("adds hybrid instructions without making normal text preferred", () => {
			const prompt = buildSystemPrompt({
				completionMode: "hybrid",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("You are operating in hybrid completion mode.");
			expect(prompt).toContain("Prefer calling `finish_work`");
		});
	});

	describe("project context files", () => {
		test("keeps small context files verbatim", () => {
			const content = "# Rules\n\nAlways run checks.";

			expect(formatContextFileForPrompt("/tmp/AGENTS.md", content)).toBe(content);
		});

		test("compacts large context files into a bounded rule index", () => {
			const content = [
				"# Rules",
				"Always run checks.",
				...Array.from({ length: 700 }, (_, index) => `background detail ${index}`),
				"Never commit unrelated files.",
			].join("\n");

			const compacted = formatContextFileForPrompt("/tmp/AGENTS.md", content);

			expect(compacted.length).toBeLessThanOrEqual(6000);
			expect(compacted).toContain("Large project rules file compacted");
			expect(compacted).toContain("Always run checks.");
			expect(compacted).toContain("Never commit unrelated files.");
			expect(compacted).not.toContain("background detail 699");
		});
	});
});
