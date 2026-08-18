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
      "- When creating or editing files (source code, JSON, JSONL, markdown, configs), always ensure the content terminates with a trailing newline ('\\n') unless explicitly requested otherwise. This preserves clean single-line diffs on future appends and adheres to POSIX line standards.",
    );
    expect(prompt).not.toContain("Subagent Exploration");
    expect(prompt).toContain(
      "- Collection & Batch Return Signatures (Homogeneous Mapping): When implementing functions that operate on an array or batch of inputs (T[]), the return type must be the direct array of item results (R[]) matching input items 1-to-1, rather than an artificial wrapper object (e.g. return R[] directly, not { results }), preserving standard array iteration and .length properties.",
    );
    expect(prompt).toContain(
      "- Develop and verify iteratively: write focused code, then accompany it with domain tests covering positive paths, negative inputs, boundary conditions, failure/recovery modes, and invariant preservation.",
    );
    expect(prompt).toContain(
      "- API Method Test Exhaustiveness: Every public method, static factory, and function exported by the module must have dedicated unit tests covering normal execution, edge cases, and failure modes. Never leave any public API method or lifecycle function untested in your test suite.",
    );
    expect(prompt).toContain(
      "- Ensure transactional operations guarantee atomic rollback: on any mid-operation failure, all state modifications, external mutations, caches, logs, and tracking registries must revert cleanly to their pre-operation state.",
    );
    expect(prompt).toContain(
      "- Perform an explicit Requirements Traceability Audit before declaring work complete: re-read the original specification line-by-line, verifying that every requirement (happy paths, negative inputs, specific error types, idempotency rules, boundary conditions, and corruption/integrity handling) is implemented and asserted by dedicated tests.",
    );
    expect(prompt).toContain(
      "- Stream & File Framing Integrity: In line-delimited and record-oriented protocols (e.g. JSONL/NDJSON), every valid stream must strictly terminate with a newline. When parsing, assert that the raw input string ends with '\\n' before splitting; reject with the domain validation error if the terminating delimiter is missing or stripped.",
    );
    expect(prompt).toContain(
      "- Domain Error Hierarchy: Instantiate and throw domain-specific custom error types for business invariant, validation, or optimistic concurrency violations, rather than unadorned generic 'new Error()'.",
    );
    expect(prompt).toContain(
      "- Before declaring code complete, run the type checker and test suite to ensure clean compilation and 100% green tests. Fix all type errors and test failures before finishing.",
    );
    expect(prompt).toContain(
      "- When fixing test failures or compiler errors in existing code, prefer precise 'edit' calls targeting the specific failing logic over completely rewriting files with 'write'. Retain verified invariants and avoid collateral regressions.",
    );
    expect(prompt).toContain(
      "- Context Efficiency & Tool Output Discipline: Before running tests, builds, benchmarks, or log-heavy commands, plan the smallest useful target and use available harnesses, quiet reporters, or output wrappers so the model reads only a compact PASS result or a FAIL result with the decisive reason. Preserve full output outside model context when it is needed for diagnosis. Treat the process exit code as authoritative; never infer success from a trailing 'success' or 'done' line.",
    );
    expect(prompt).toContain(
      "- When working on complex testing, architecture, or ecosystem integrations, consult any loaded specialized skills for domain playbooks and reference patterns.",
    );
    expect(prompt).not.toContain("test-output-discipline");
  });

  it("does not demand subagents when no such workflow is part of P", () => {
    const prompt = buildSystemPrompt(baseOptions);
    expect(prompt).not.toMatch(/subagents?|parallel research/iu);
  });

  it("does not mistake local semantic search for web research capability", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["read", "semantic_search"],
      toolSnippets: { read: "Read a file", semantic_search: "Search local code" },
    });
    expect(prompt).not.toContain("Proactive Web Research & Validation");
  });

  it("includes web research guidance when a web-capable tool is active", () => {
    const prompt = buildSystemPrompt({
      cwd: "/test",
      selectedTools: ["read", "web_search"],
      toolSnippets: { read: "Read a file", web_search: "Search the web" },
    });
    expect(prompt).toContain("Proactive Web Research & Validation");
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
