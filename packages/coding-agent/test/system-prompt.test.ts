import { describe, expect, it } from "vitest";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
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
    expect(prompt).toContain("- Be concise and show file paths clearly.");
  });

  it("preserves every static default invariant in a compact prompt", () => {
    const prompt = buildSystemPrompt(baseOptions);
    const invariantNeedles = [
      "End created or edited text files",
      "Plan the smallest complete outcome",
      "Establish a baseline when relevant",
      "verify each meaningful increment",
      "fix failures before expanding",
      "finish required checks and deliverables before optional work",
      "declared transaction, rollback, irreversibility, and append-only semantics",
      "Never invent rollback for irreversible effects",
      "restore only contract-declared reversible state",
      "re-read the original request and authoritative sources",
      "one concise completion checklist",
      "map each checklist item to direct evidence",
      "Do not expand free text into an exhaustive formal clause matrix",
      "Preserve exact requested formats and boundaries",
      "whitespace, framing, ordering, units, or byte-level representation",
      "verify the raw artifact",
      "For implementation changes",
      "relevant static checks and focused tests",
      "Distinguish focused evidence from full-suite evidence",
      "precise edit calls on failing logic over whole-file write calls",
      "avoid collateral regressions",
      "compact, high-signal tool output",
      "preserve full logs outside model context",
      "Treat exit status as authoritative",
      "never mask a failed operation",
      "consult loaded specialized skills",
    ];
    for (const needle of invariantNeedles) expect(prompt).toContain(needle);
    expect(prompt).not.toContain("Subagent Exploration");
    expect(prompt).not.toContain("test-output-discipline");
    expect(prompt.length).toBeLessThanOrEqual(3_500);
  });

  it("keeps the full static prompt with every conditional guideline within budget", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["read", "bash", "semantic_search", "web_search"],
      toolSnippets: {
        read: "Read a file",
        bash: "Run a shell command",
        semantic_search: "Search local code",
        web_search: "Search the web",
      },
    });
    expect(prompt).toContain("Use semantic_search when identifiers or paths are unknown");
    expect(prompt).toContain("For unfamiliar or time-sensitive claims");
    expect(prompt.length).toBeLessThanOrEqual(3_500);
  });

  it("does not demand subagents when no such workflow is part of P", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).not.toMatch(/subagents?|parallel research/iu);
  });

  it("keeps the default role and always-on guidance domain-neutral", () => {
    const prompt = buildSystemPrompt(baseOptions);

    expect(prompt).toContain("expert task assistant in p");
    expect(prompt).not.toContain("expert coding assistant");
    expect(prompt).not.toContain("JSONL/NDJSON");
    expect(prompt).not.toContain("validPayload.slice");
    expect(prompt).not.toContain("domain-specific custom errors");
    expect(prompt).not.toContain("full test suite to 100% green");
    expect(prompt).not.toContain("revert state changes, external mutations, caches, logs, and tracking registries");
    expect(prompt).toContain("Preserve declared transaction, rollback, irreversibility, and append-only semantics");
  });

  it("keeps exhaustive semantic auditing behind the audit verification mode", () => {
    const evidencePrompt = buildSystemPrompt(baseOptions);
    const auditPrompt = buildSystemPrompt({ ...baseOptions, taskVerificationMode: "audit" });

    expect(evidencePrompt).toContain("one concise completion checklist");
    expect(evidencePrompt).not.toContain("audit every requirement");
    expect(auditPrompt).toContain("audit every requirement");
  });

  it("does not mistake local semantic search for web research capability", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["read", "semantic_search"],
      toolSnippets: { read: "Read a file", semantic_search: "Search local code" },
    });
    expect(prompt).not.toContain("For unfamiliar or time-sensitive claims");
  });

  it("includes web research guidance when a web-capable tool is active", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["read", "web_search"],
      toolSnippets: { read: "Read a file", web_search: "Search the web" },
    });
    expect(prompt).toContain("For unfamiliar or time-sensitive claims");
  });

  it("includes promptGuidelines in the prompt", () => {
    const prompt = buildSystemPrompt({
      ...baseOptions,
      promptGuidelines: ["Custom guideline"],
    });
    expect(prompt).toContain("- Custom guideline");
  });

  it("includes tool-specific guidelines when tools are available", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain(
      "- Recover from tool syntax, path, allowlist, or command-choice errors by correcting the call or using an equivalent available tool, then continue.",
    );
  });

  it("includes bash-only file exploration guideline when no dedicated tools present", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["bash"],
      toolSnippets: { bash: "Run a shell command" },
    });
    expect(prompt).toContain(
      "- Use bash for ls, rg, or find only when the corresponding dedicated tool is unavailable.",
    );
  });

  it("does not include bash-only file exploration guideline when dedicated tools present", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["bash", "grep"],
      toolSnippets: { bash: "Run a shell command", grep: "Search for patterns" },
    });
    expect(prompt).not.toContain(
      "Use bash for ls, rg, or find only when the corresponding dedicated tool is unavailable",
    );
  });

  it("includes p documentation section", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).toContain("p documentation");
    expect(prompt).toContain("Main documentation:");
    expect(prompt).toContain("Additional docs:");
    expect(prompt).toContain("Examples:");
    expect(prompt).toMatch(/Before answering p questions or performing p work/iu);
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

  it("uses the prepared project block instead of raw resources in custom prompt mode", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      customPrompt: "Custom prompt",
      projectInstructions: '<project_instructions mode="compiled">bounded routing</project_instructions>',
      contextFiles: [{ path: "/test/AGENTS.md", content: "RAW_CONTEXT_SENTINEL" }],
      skills: [
        {
          name: "raw-skill",
          description: "RAW_SKILL_SENTINEL",
          filePath: "/test/raw-skill/SKILL.md",
          baseDir: "/test/raw-skill",
          sourceInfo: createSyntheticSourceInfo("/test/raw-skill/SKILL.md", { source: "test" }),
          disableModelInvocation: false,
        },
      ],
    });

    expect(prompt).toContain("bounded routing");
    expect(prompt).not.toContain("RAW_CONTEXT_SENTINEL");
    expect(prompt).not.toContain("RAW_SKILL_SENTINEL");
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
