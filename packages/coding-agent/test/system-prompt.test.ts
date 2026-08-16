import { describe, expect, it } from "vitest";
import { buildSystemPrompt, formatContextFileForPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
  const baseOptions = {
    cwd: "/test",
    selectedTools: ["read", "bash"],
    toolSnippets: {
      read: "Read a file",
      bash: "Run a shell command",
    },
  };

  it("includes default guidelines", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain("Guidelines:");
    expect(prompt).toContain("- Be concise in your responses");
    expect(prompt).toContain("- Show file paths clearly when working with files");
  });

  it("includes testing-related guidelines by default", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain(
      "- Preserve existing public API shapes, signatures, and contracts strictly. Do not invent response wrappers, extra properties, or altered return types unless explicitly requested.",
    );
    expect(prompt).toContain(
      "- Develop and verify iteratively: write focused code, then accompany it with domain tests covering positive paths, negative inputs, boundary conditions, failure/recovery modes, and invariant preservation.",
    );
    expect(prompt).toContain(
      "- Ensure transactional and atomic operations guarantee clean rollback: on any mid-operation failure, all state modifications, caches, logs, and identity registries must revert to their pre-operation state.",
    );
    expect(prompt).toContain(
      "- Validate input streams, parsers, and serializations thoroughly against incomplete, corrupted, or truncated data (e.g. data missing terminating delimiters).",
    );
    expect(prompt).toContain(
      "- Before declaring code complete, run the type checker and test suite to ensure clean compilation and 100% green tests. Fix all type errors and test failures before finishing.",
    );
    expect(prompt).toContain(
      "- When working on complex testing, architecture, or ecosystem integrations, consult available specialized skills (e.g. software-testing) for domain playbooks and reference patterns.",
    );
  });

  it("includes promptGuidelines in the prompt", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      promptGuidelines: ["Custom guideline"],
    });
    expect(prompt).toContain("- Custom guideline");
  });

  it("includes web search guideline when search tools are available", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      selectedTools: ["read", "bash", "web_search"],
    });
    expect(prompt).toContain(
      "- Use web search to consult current documentation, ecosystem practices, and library error modes when integrating unfamiliar packages or APIs.",
    );
  });

  it("includes tool-specific guidelines when tools are available", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain(
      "- If a tool call fails from a recoverable syntax, path, allowlist, or command-choice error, correct the call or use an equivalent available tool and continue.",
    );
  });

  it("includes bash-only file exploration guideline when no dedicated tools present", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["bash"],
      toolSnippets: { bash: "Run a shell command" },
    });
    expect(prompt).toContain("- Use bash for file operations like ls, rg, find when dedicated tools are unavailable.");
  });

  it("does not include bash-only file exploration guideline when dedicated tools present", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["bash", "grep"],
      toolSnippets: { bash: "Run a shell command", grep: "Search for patterns" },
    });
    expect(prompt).not.toContain("Use bash for file operations like ls, rg, find when dedicated tools are unavailable");
  });

  it("includes explicit_finish completion protocol instructions", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      completionMode: "explicit_finish",
    });
    expect(prompt).toContain("You are operating in explicit completion mode.");
    expect(prompt).toContain("When the task is complete, call `finish_work`.");
  });

  it("includes hybrid completion protocol instructions", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      completionMode: "hybrid",
    });
    expect(prompt).toContain("You are operating in hybrid completion mode.");
    expect(prompt).toContain("Prefer calling `finish_work` when the task is complete");
  });

  it("includes p documentation section", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain("p documentation");
    expect(prompt).toContain("Main documentation:");
    expect(prompt).toContain("Additional docs:");
    expect(prompt).toContain("Examples:");
  });

  it("includes date and working directory", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain("Current date:");
    expect(prompt).toContain("Current working directory: /test");
  });

  it("uses custom prompt when provided", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      customPrompt: "Custom system prompt",
    });
    expect(prompt).toContain("Custom system prompt");
    expect(prompt).not.toContain("Available tools:");
  });

  it("includes context files in custom prompt mode", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      customPrompt: "Custom prompt",
      contextFiles: [{ path: "/test/AGENTS.md", content: "# Test Rules\n- must do X" }],
    });
    expect(prompt).toContain("<project_context>");
    expect(prompt).toContain("Test Rules");
  });

  it("handles Windows-style paths in cwd", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      cwd: "C:\\Users\\test",
    });
    expect(prompt).toContain("Current working directory: C:/Users/test");
  });

  it("includes appendSystemPrompt", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      appendSystemPrompt: "Extra instructions",
    });
    expect(prompt).toContain("Extra instructions");
  });

  it("includes context files in default mode", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      contextFiles: [{ path: "/test/AGENTS.md", content: "# Test Rules" }],
    });
    expect(prompt).toContain("<project_context>");
    expect(prompt).toContain("Test Rules");
  });

  it("handles empty context files array", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      contextFiles: [],
    });
    expect(prompt).not.toContain("<project_context>");
  });

  it("includes skills in prompt when read tool is available", () => {
    const mockSkill = {
      name: "test-skill",
      description: "A test skill description",
      filePath: "/test/skills/test-skill/SKILL.md",
      baseDir: "/test/skills/test-skill",
      sourceInfo: {
        path: "/test/skills/test-skill/SKILL.md",
        source: "local",
        scope: "user" as const,
        origin: "top-level" as const,
      },
      disableModelInvocation: false,
    };
    const prompt = buildSystemPrompt({
      ...baseOptions,
      selectedTools: ["read", "bash"],
      skills: [mockSkill],
    });
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>test-skill</name>");
    expect(prompt).toContain("<description>A test skill description</description>");
  });

  it("omits skills from prompt when read tool is not available", () => {
    const mockSkill = {
      name: "test-skill",
      description: "A test skill description",
      filePath: "/test/skills/test-skill/SKILL.md",
      baseDir: "/test/skills/test-skill",
      sourceInfo: {
        path: "/test/skills/test-skill/SKILL.md",
        source: "local",
        scope: "user" as const,
        origin: "top-level" as const,
      },
      disableModelInvocation: false,
    };
    const prompt = buildSystemPrompt({
      ...baseOptions,
      selectedTools: ["bash", "edit"],
      skills: [mockSkill],
    });
    expect(prompt).not.toContain("<available_skills>");
  });

  it("includes skills in custom prompt mode when read tool is available", () => {
    const mockSkill = {
      name: "test-skill",
      description: "A test skill description",
      filePath: "/test/skills/test-skill/SKILL.md",
      baseDir: "/test/skills/test-skill",
      sourceInfo: {
        path: "/test/skills/test-skill/SKILL.md",
        source: "local",
        scope: "user" as const,
        origin: "top-level" as const,
      },
      disableModelInvocation: false,
    };
    const prompt = buildSystemPrompt({
      ...baseOptions,
      customPrompt: "Custom prompt text",
      selectedTools: ["read", "bash"],
      skills: [mockSkill],
    });
    expect(prompt).toContain("Custom prompt text");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>test-skill</name>");
  });
});

describe("formatContextFileForPrompt", () => {
  it("returns content as-is when under the limit", () => {
    const result = formatContextFileForPrompt("/test/rules.md", "Short content");
    expect(result).toBe("Short content");
  });

  it("compacts large files and keeps headers and keyword lines", () => {
    const largeContent = `${"regular line\n".repeat(500)}# Header\nalways do this\nmust follow rules\n`;
    const result = formatContextFileForPrompt("/test/large.md", largeContent);
    expect(result).toContain("[Large project rules file compacted from");
    expect(result).toContain("Full rules remain available at /test/large.md");
    expect(result).toContain("# Header");
    expect(result).toContain("always do this");
    expect(result).toContain("must follow rules");
  });

  it("includes omitted lines count when lines are skipped", () => {
    const largeContent = `${"# Header\n\n".repeat(500) + "regular line\n".repeat(100)}always do this\n`;
    const result = formatContextFileForPrompt("/test/large.md", largeContent);
    expect(result).toMatch(/\[\d+ lower-signal lines omitted from prompt context\.\]/);
  });

  it("truncates compacted output if still too large", () => {
    const hugeContent = `# ${"x".repeat(100)}\n`.repeat(100);
    const result = formatContextFileForPrompt("/test/huge.md", hugeContent);
    expect(result).toContain("[compacted rules truncated to prompt budget]");
  });
});
