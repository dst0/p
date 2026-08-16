import { describe, expect, it } from "vitest";
import { sanitizeUIOutput } from "./helpers/ui-visual-snapshot-harness.ts";

describe("UI visual snapshot sanitization", () => {
  it("normalizes a branch name truncated before its closing parenthesis", () => {
    const output = "/Users/example/dev/p/packages/coding-agent (codex/requirement-audit-cert...";

    expect(sanitizeUIOutput(output)).toBe("~/dev/p/packages/coding-agent (main)");
  });

  it("preserves truncated text outside the coding-agent footer", () => {
    const output = "Failure in packages/coding-agent (details...";

    expect(sanitizeUIOutput(output)).toBe(output);
  });
});
