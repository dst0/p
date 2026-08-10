import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getSubagentStorageDir } from "../../src/core/subagents.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession subagent artifact isolation", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      const harness = harnesses.pop();
      if (!harness) continue;
      const target = {
        sessionDir: harness.sessionManager.getSessionDir(),
        sessionId: harness.sessionManager.getSessionId(),
        isPersisted: harness.sessionManager.isPersisted(),
      };
      rmSync(getSubagentStorageDir(target), { recursive: true, force: true });
      harness.cleanup();
    }
  });

  it("keeps runtime context and session recall on the current branch", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const rootId = harness.sessionManager.appendCustomEntry("test-root");
    const branchAId = harness.sessionManager.appendCustomEntry("test-branch-a");
    harness.session.recordSubagentDigest("explore", "isolation", "ALPHA_RESEARCH_SECRET");

    expect(harness.session._createRuntimeContextPrompts("isolation", "base").subagentDigestPrompt).toContain(
      "ALPHA_RESEARCH_SECRET",
    );
    expect(harness.session._recallSessionEvidence({ query: "ALPHA_RESEARCH_SECRET" }).hits).toHaveLength(1);

    harness.sessionManager.branch(rootId);
    harness.sessionManager.appendCustomEntry("test-branch-b");

    expect(harness.session._createRuntimeContextPrompts("isolation", "base").subagentDigestPrompt).toBeUndefined();
    expect(harness.session._recallSessionEvidence({ query: "ALPHA_RESEARCH_SECRET" }).hits).toHaveLength(0);

    harness.sessionManager.branch(branchAId);
    expect(harness.session._createRuntimeContextPrompts("isolation", "base").subagentDigestPrompt).toContain(
      "ALPHA_RESEARCH_SECRET",
    );
  });
});
