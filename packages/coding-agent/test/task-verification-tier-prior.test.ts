import { describe, expect, it } from "vitest";
import { initialVerificationTier, promptRequiresStrictTier } from "../src/core/task-verification/task-tier.ts";

describe("verification tier prior", () => {
  it.each([
    "Implement a slugify helper in src/slug.ts with tests",
    "Fix the off-by-one bug in src/range.ts",
    "Refactor the loader to use async iterators",
    "Add tests for the tokenizer",
    "Rename helper X and run its test",
  ])("starts code-changing work STRICT: %s", (prompt) => {
    expect(promptRequiresStrictTier(prompt)).toBe(true);
    expect(initialVerificationTier("auto", prompt)).toEqual({ tier: "strict", reason: "prior" });
  });

  it.each([
    "What is 17*23? Reply with just the number.",
    "read package.json and report one script",
    "Explain how the parser works",
    "Say exactly: ok",
    "Run npm test and report failures",
    "Find where finish_work is defined",
    "Look at src/a.ts.",
  ])("keeps questions and unclassified requests LIGHT: %s", (prompt) => {
    expect(promptRequiresStrictTier(prompt)).toBe(false);
    expect(initialVerificationTier("auto", prompt)).toEqual({ tier: "light", reason: "prior" });
  });

  it("keeps documentation edits LIGHT even though they require an effect", () => {
    expect(promptRequiresStrictTier("Add a line to README.md that says hello")).toBe(false);
    expect(promptRequiresStrictTier("Update the README to mention the new flag")).toBe(false);
  });

  it("accepts the known false positive for a no-change instruction as STRICT", () => {
    expect(promptRequiresStrictTier("Change nothing; summarize the diff")).toBe(true);
  });

  it("treats empty and whitespace prompts as LIGHT", () => {
    expect(promptRequiresStrictTier("")).toBe(false);
    expect(promptRequiresStrictTier("   \n")).toBe(false);
  });

  it("lets explicit light and strict policies override the prior", () => {
    expect(initialVerificationTier("light", "Fix the off-by-one bug in src/range.ts")).toEqual({
      tier: "light",
      reason: "user_override",
    });
    expect(initialVerificationTier("strict", "What is 17*23?")).toEqual({ tier: "strict", reason: "user_override" });
  });
});
