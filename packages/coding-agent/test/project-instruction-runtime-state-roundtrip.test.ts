import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session/agentsession.ts";
import { do__createRuntimeContextPromptMessage } from "../src/core/agent-session/agentsession-methods/prompt-context.ts";
import { RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE } from "../src/core/agent-session/constants.ts";
import { restoreProjectRuleGateFromHistory } from "../src/core/agent-session/project-instruction-integrity.ts";
import type { ProjectRuleGate } from "../src/core/agent-session/state-types.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

const inputHash = "a".repeat(64);
const link = "rules/testing.md";

describe("project instruction runtime state persistence", () => {
  it("serializes pending batches as unsatisfied immutable route state", () => {
    const gate: ProjectRuleGate = {
      inputHash,
      batches: [{ links: [link], satisfied: true, generation: 7 }],
      activeGeneration: 7,
      candidateLinks: [link],
    };
    const message = do__createRuntimeContextPromptMessage(
      { _projectInstructionMode: "compiled" } as AgentSession,
      "route context",
      123,
      gate,
    );

    expect(message.details).toMatchObject({
      projectInstructionMode: "compiled",
      projectRuleGate: {
        inputHash,
        batches: [{ links: [link], satisfied: false, generation: 7 }],
        activeGeneration: 7,
        candidateLinks: [link],
      },
    });
    expect(gate.batches[0]?.satisfied).toBe(true);
  });

  it.each([
    ["contradictory failure", { inputHash, batches: [], candidateLinks: [link], failure: "failed" }],
    ["non-string input hash", { inputHash: 42, batches: [], candidateLinks: [link] }],
    [
      "excessive batch count",
      { inputHash, batches: Array.from({ length: 65 }, () => ({ links: [link] })), candidateLinks: [link] },
    ],
  ])("fails closed for %s in hidden route metadata", (_label, projectRuleGate) => {
    const entries: SessionEntry[] = [
      {
        type: "custom_message",
        id: "entry-1",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        customType: RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
        content: `<project_rule_routes input_sha256="${inputHash}">\n- \`${link}\`: test execution\n</project_rule_routes>`,
        display: false,
        details: { projectInstructionMode: "compiled", projectRuleGate },
      },
    ];

    expect(restoreProjectRuleGateFromHistory(entries, inputHash, () => 1)?.failure).toMatch(/cannot be verified/iu);
  });
});
