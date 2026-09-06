import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRoutedTurns } from "../../src/project-instructions/routed-turn-validation.ts";

test("identifies the completed mutating action missing its authoritative rule batch", () => {
  const reason = validateRoutedTurns(
    {
      userTurns: [{ eventOrdinal: 10, selectionVerified: true, expectedRouteLinks: ["rules/testing.md"] }],
      runtimeContexts: [
        {
          eventOrdinal: 11,
          routeInputHash: "a".repeat(64),
          routeLinkCount: 1,
          routeLinks: ["rules/testing.md"],
        },
      ],
      phaseRelevantToolCalls: [
        {
          toolName: "record_learning",
          eventOrdinal: 42,
          endOrdinal: 43,
          selectionVerified: true,
          phases: [],
          expectedActionRuleLinks: ["rules/learnings.md"],
          blockedByProjectRuleGate: false,
        },
      ],
    },
    { manifest: { inputHash: "a".repeat(64) } },
  );

  assert.equal(reason, "completed mutating action had no authoritative rule batch: tool=record_learning, event=42");
});

test("reduces child-controlled tool names to a fixed diagnostic category", () => {
  const reason = validateRoutedTurns(
    {
      userTurns: [{ eventOrdinal: 10, selectionVerified: true, expectedRouteLinks: ["rules/testing.md"] }],
      runtimeContexts: [
        {
          eventOrdinal: 11,
          routeInputHash: "a".repeat(64),
          routeLinkCount: 1,
          routeLinks: ["rules/testing.md"],
        },
      ],
      phaseRelevantToolCalls: [
        {
          toolName: "privatePayload123",
          eventOrdinal: 42,
          endOrdinal: 43,
          selectionVerified: true,
          phases: [],
          expectedActionRuleLinks: ["rules/testing.md"],
          blockedByProjectRuleGate: false,
        },
      ],
    },
    { manifest: { inputHash: "a".repeat(64) } },
  );

  assert.equal(reason, "completed mutating action had no authoritative rule batch: tool=custom, event=42");
  assert.equal(reason?.includes("privatePayload123"), false);
});
