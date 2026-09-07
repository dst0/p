import { describe, expect, it } from "vitest";
import { formatRequirementDefinitionPrompt } from "../src/core/task-verification/requirement-definition-prompt.ts";

describe("universal requirement-definition prompt", () => {
  it("uses source-driven guidance instead of benchmark-specific implementation rules", () => {
    const prompt = formatRequirementDefinitionPrompt([{ id: "user", text: "Prepare a customer handoff." }]);

    expect(prompt).toContain(
      "Preserve every explicit subject, behavior, qualifier, boundary, and verification condition",
    );
    expect(prompt).not.toContain("terminal-newline");
    expect(prompt).not.toContain("validPayload.slice");
    expect(prompt).not.toContain("command-ID");
    expect(prompt).not.toContain("idempotency-record");
  });
});
