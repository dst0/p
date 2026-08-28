import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE } from "../src/core/agent-session/constants.ts";
import {
  filterProjectInstructionHistory,
  PROJECT_RULE_BATCH_CUSTOM_TYPE,
  PROJECT_RULE_RECEIPT_CUSTOM_TYPE,
  PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE,
  persistProjectRuleSupersession,
  preserveCompiledProjectInstructionPrompt,
  restoreProjectRuleGateFromHistory,
} from "../src/core/agent-session/project-instruction-integrity.ts";
import type { ProjectRuleGate } from "../src/core/agent-session/state-types.ts";
import type { BranchSummaryMessage, CompactionSummaryMessage, CustomMessage } from "../src/core/messages.ts";
import type { SessionEntry } from "../src/core/session-manager/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const inputHash = "a".repeat(64);
const testingLink = "rules/testing.md";
const securityLink = "rules/security.md";
const routeContent = `<project_rule_routes input_sha256="${inputHash}">\n- \`${testingLink}\`: testing\n- \`${securityLink}\`: security\n</project_rule_routes>`;

describe("project-instruction history integrity", () => {
  it("preserves only mode-compatible blocks across text and rich history", () => {
    const image: ImageContent = { type: "image", data: "c2FmZQ==", mimeType: "image/png" };
    const runtime: CustomMessage = {
      role: "custom",
      customType: RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
      content: [
        { type: "text", text: "before <project_rules>legacy</project_rules>" },
        image,
        { type: "text", text: `${routeContent}<project_context>context</project_context> after` },
      ],
      display: false,
      timestamp: 1,
    };
    const compaction: CompactionSummaryMessage = {
      role: "compactionSummary",
      summary: "<project_rules>legacy</project_rules>\n<project_rule_routes>routes</project_rule_routes>",
      tokensBefore: 10,
      timestamp: 2,
    };
    const branch: BranchSummaryMessage = {
      role: "branchSummary",
      summary: "<project_context>context</project_context>\nkeep this",
      fromId: "entry",
      timestamp: 3,
    };
    const messages = [
      runtime,
      compaction,
      branch,
      { role: "user", content: "hello", timestamp: 4 },
    ] satisfies AgentMessage[];

    const compiled = filterProjectInstructionHistory(messages, "compiled");
    expect(compiled).toHaveLength(4);
    expect(compiled[0]).toMatchObject({
      content: [{ type: "text", text: "before" }, image, { type: "text", text: `${routeContent}\nafter` }],
    });
    expect((compiled[1] as CompactionSummaryMessage).summary).toBe("");
    expect((compiled[2] as BranchSummaryMessage).summary).toBe("keep this");

    const legacy = filterProjectInstructionHistory(messages, "legacy");
    expect((legacy[0] as CustomMessage).content).toEqual([
      { type: "text", text: "before <project_rules>legacy</project_rules>" },
      image,
      { type: "text", text: "after" },
    ]);
    expect((legacy[1] as CompactionSummaryMessage).summary).toBe("");

    const off = filterProjectInstructionHistory(messages, "off");
    expect(off).toHaveLength(4);
    expect((off[0] as CustomMessage).content).toEqual([
      { type: "text", text: "before" },
      image,
      { type: "text", text: "after" },
    ]);
    expect(preserveCompiledProjectInstructionPrompt("<project_rules>stale</project_rules>", "immutable")).toBe(
      "immutable",
    );
  });

  it("restores valid batches and candidate links while rejecting stale history", () => {
    let generation = 0;
    const gate = restoreProjectRuleGateFromHistory(
      [
        customEntry(PROJECT_RULE_BATCH_CUSTOM_TYPE, {
          version: 1,
          source: "action",
          inputHash,
          links: [testingLink],
        }),
        customMessageEntry(
          [
            { type: "text", text: routeContent },
            { type: "image", data: "c2FmZQ==", mimeType: "image/png" },
          ],
          {
            projectInstructionMode: "compiled",
            projectRuleGate: {
              inputHash,
              batches: [],
              activeGeneration: 0,
              candidateLinks: [testingLink, securityLink],
              candidateMerge: "union",
            } satisfies ProjectRuleGate,
          },
        ),
      ],
      inputHash,
      () => ++generation,
    );

    expect(gate).toMatchObject({
      inputHash,
      candidateLinks: [securityLink],
      batches: [{ links: [testingLink], generation: 1, satisfied: false }],
    });
  });

  it("fails closed for malformed batches, receipts, supersession, and route details", () => {
    const cases: SessionEntry[][] = [
      [customEntry(PROJECT_RULE_BATCH_CUSTOM_TYPE, { version: 2, source: "action", inputHash, links: [testingLink] })],
      [customEntry(PROJECT_RULE_RECEIPT_CUSTOM_TYPE, { version: 1, inputHash, links: [securityLink] })],
      [customEntry(PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE, { version: 1, inputHash, source: "unknown" })],
      [customMessageEntry(routeContent, undefined)],
      [
        customMessageEntry(routeContent, {
          projectInstructionMode: "compiled",
          projectRuleGate: { inputHash, batches: [{}], activeGeneration: 0, candidateLinks: [testingLink] },
        }),
      ],
      [
        customMessageEntry(routeContent, {
          projectInstructionMode: "compiled",
          projectRuleGate: { inputHash, batches: [], activeGeneration: 0, candidateLinks: [testingLink, testingLink] },
        }),
      ],
    ];

    for (const entries of cases) {
      const restored = restoreProjectRuleGateFromHistory(entries, inputHash, () => 1);
      expect(restored?.failure).toContain("cannot");
    }
  });

  it("rejects stale and duplicate route state after a valid batch", () => {
    const staleBatch = customEntry(PROJECT_RULE_BATCH_CUSTOM_TYPE, {
      version: 1,
      source: "action",
      inputHash: "b".repeat(64),
      links: [testingLink],
    });
    const duplicateRoute = customMessageEntry(
      `<project_rule_routes input_sha256="${inputHash}">\n- \`${testingLink}\`: one\n- \`${testingLink}\`: two\n</project_rule_routes>`,
      {
        projectInstructionMode: "compiled",
        projectRuleGate: {
          inputHash,
          batches: [],
          activeGeneration: 0,
          candidateLinks: [testingLink],
        },
      },
    );
    const restored = restoreProjectRuleGateFromHistory([staleBatch, duplicateRoute], inputHash, () => 1);
    expect(restored?.failure).toContain("changed");
  });

  it("persists a supersession marker with its source", () => {
    const manager = SessionManager.inMemory("/workspace");
    persistProjectRuleSupersession(manager, inputHash, "model-refresh");
    expect(manager.getBranch()).toContainEqual(
      expect.objectContaining({
        type: "custom",
        customType: PROJECT_RULE_SUPERSESSION_CUSTOM_TYPE,
        data: { version: 1, inputHash, source: "model-refresh" },
      }),
    );
  });
});

function customEntry(customType: string, data: unknown): SessionEntry {
  return {
    type: "custom",
    customType,
    data,
    id: `${customType}-id`,
    parentId: null,
    timestamp: new Date(0).toISOString(),
  };
}

function customMessageEntry(content: string | (TextContent | ImageContent)[], details: unknown): SessionEntry {
  return {
    type: "custom_message",
    customType: RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
    content,
    details,
    display: false,
    id: "runtime-id",
    parentId: null,
    timestamp: new Date(0).toISOString(),
  };
}
