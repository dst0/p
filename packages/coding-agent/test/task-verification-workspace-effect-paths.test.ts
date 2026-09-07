import { describe, expect, it } from "vitest";
import { normalizeWorkspaceEffectPath } from "../src/core/task-verification/workspace-effect-state.ts";

describe("workspace effect path normalization", () => {
  it("rejects control characters while preserving ordinary relative paths", () => {
    expect(normalizeWorkspaceEffectPath("docs/guide.md")).toBe("docs/guide.md");
    expect(normalizeWorkspaceEffectPath("docs/\u0000guide.md")).toBeUndefined();
    expect(normalizeWorkspaceEffectPath("docs/\u001fguide.md")).toBeUndefined();
    expect(normalizeWorkspaceEffectPath("docs/\u007fguide.md")).toBeUndefined();
  });
});
