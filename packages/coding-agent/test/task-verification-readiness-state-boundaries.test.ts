import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  MAX_COMPLETION_CHECKLIST_ITEMS,
  persistedCompletionChecklistIsCanonical,
  validatedCompletionChecklist,
} from "../src/core/task-verification/completion-checklist-policy.ts";
import {
  MAX_EXTERNAL_EFFECT_RECEIPTS,
  type TaskVerificationResolvedToolEffect,
} from "../src/core/task-verification/external-effect-state.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { taskEffectStateIsValid } from "../src/core/task-verification/task-effect-state-validation.ts";
import { recordSuccessfulExternalEffect } from "../src/core/task-verification/taskverificationcontroller-methods/external-effect-receipt.ts";
import { evidenceIsCurrentDeclaredExternalReadback } from "../src/core/task-verification/taskverificationcontroller-methods/external-readback-evidence.ts";
import type { TaskVerificationEvidence } from "../src/core/task-verification/types.ts";
import {
  isTaskOwnedPathBaselines,
  isTaskOwnedPaths,
  MAX_TASK_OWNED_PATHS,
  normalizedFilesChanged,
  normalizeWorkspaceEffectPath,
} from "../src/core/task-verification/workspace-effect-state.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

describe("task-verification readiness state boundaries", () => {
  it("rejects empty, oversized, overlong, and duplicate behavioral checklists", () => {
    expect(validatedCompletionChecklist(undefined)).toContain("requires 1-12");
    expect(validatedCompletionChecklist([])).toContain("requires 1-12");
    expect(validatedCompletionChecklist(["The report is complete", 1])).toContain("must be text");
    expect(validatedCompletionChecklist(["The report is complete", "   "])).toContain("must be non-empty");

    const tooManyBehaviors = Array.from(
      { length: MAX_COMPLETION_CHECKLIST_ITEMS + 1 },
      (_, index) => `Observable behavior ${index + 1} remains correct`,
    );
    expect(validatedCompletionChecklist(tooManyBehaviors)).toContain("requires 1-12");
    expect(validatedCompletionChecklist([`Observable output contains ${"x".repeat(301)}`])).toContain(
      "within 300 characters",
    );
    expect(validatedCompletionChecklist(["The report is complete", "the report is complete"])).toContain(
      "duplicate criteria",
    );
  });

  it("distinguishes canonical persisted criteria from normalizable input", () => {
    const canonical = ["The exported report contains the requested summary"];

    expect(validatedCompletionChecklist(["  The exported   report contains the requested summary  "])).toEqual(
      canonical,
    );
    expect(persistedCompletionChecklistIsCanonical(canonical)).toBe(true);
    expect(persistedCompletionChecklistIsCanonical(["  The exported report contains the requested summary  "])).toBe(
      false,
    );
    expect(persistedCompletionChecklistIsCanonical("not-an-array")).toBe(false);
  });

  it("keeps the workspace-effect ledger canonical, bounded, and one-to-one", () => {
    expect(normalizeWorkspaceEffectPath("./src//feature.ts")).toBe("src/feature.ts");
    expect(normalizeWorkspaceEffectPath("src/node_modules/dependency.js")).toBeUndefined();
    expect(isTaskOwnedPaths(undefined)).toBe(true);
    expect(isTaskOwnedPaths(["src/feature.ts", "src/feature.ts"])).toBe(false);
    expect(isTaskOwnedPaths(Array.from({ length: MAX_TASK_OWNED_PATHS + 1 }, (_, index) => `src/${index}.ts`))).toBe(
      false,
    );
    expect(
      isTaskOwnedPathBaselines([
        { path: "src/feature.ts", state: null },
        { path: "src/feature.ts", state: "duplicate" },
      ]),
    ).toBe(false);
    expect(isTaskOwnedPathBaselines([{ path: "src/feature.ts", state: "x".repeat(201) }])).toBe(false);
    expect(normalizedFilesChanged(["src/z.ts", "./src/a.ts", "src/z.ts"])).toEqual(["src/a.ts", "src/z.ts"]);
    expect(normalizedFilesChanged(["../outside.ts"])).toBeUndefined();
  });

  it("accepts only aligned paths and current external-effect receipts", () => {
    const receipt = {
      id: "external-effect-1-1",
      toolCallId: "send-1",
      toolName: "send_email",
      effect: {
        kind: "external_write" as const,
        risk: "high" as const,
        domains: ["network_send" as const],
        source: "declared" as const,
      },
      effectRevision: 1,
    };
    const valid = {
      ...emptyState("readiness-state", "evidence"),
      mutationRevision: 1,
      taskOwnedPaths: ["src/feature.ts"],
      taskOwnedPathBaselines: [{ path: "src/feature.ts", state: null }],
      externalEffectReceipts: [receipt],
    };

    expect(taskEffectStateIsValid(valid)).toBe(true);
    expect(taskEffectStateIsValid({ ...valid, taskOwnedPathOverflow: "yes" })).toBe(false);
    expect(taskEffectStateIsValid({ ...valid, taskOwnedPathBaselines: [] })).toBe(false);
    expect(taskEffectStateIsValid({ ...valid, taskOwnedPathBaselines: [{ path: "src/other.ts", state: null }] })).toBe(
      false,
    );
    expect(taskEffectStateIsValid({ ...valid, externalEffectReceipts: [{ ...receipt, effectRevision: 2 }] })).toBe(
      false,
    );
    expect(taskEffectStateIsValid({ ...valid, mutationRevision: -1 })).toBe(false);
  });

  it("fails closed without fabricating evidence when the external-effect ledger is full", () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const effect: TaskVerificationResolvedToolEffect = {
      kind: "external_write",
      risk: "high",
      domains: ["network_send"],
      source: "declared",
    };
    controller.state.externalEffectReceipts = Array.from({ length: MAX_EXTERNAL_EFFECT_RECEIPTS }, (_, index) => ({
      id: `external-effect-1-${index + 1}`,
      toolCallId: `send-${index + 1}`,
      toolName: "send_email",
      effect,
      effectRevision: 1,
    }));

    const recorded = recordSuccessfulExternalEffect(
      controller,
      { toolCall: { id: "send-overflow", name: "send_email" } } as never,
      effect,
      2,
    );

    expect(recorded).toMatchObject({
      overflow: true,
      trackingFailed: false,
      receipts: { length: MAX_EXTERNAL_EFFECT_RECEIPTS },
    });
    expect(recorded.evidence).toBeUndefined();
    expect(controller.evidence.size).toBe(0);
  });

  it("treats only the latest declared readback in the same unbound scope as current", () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const first = declaredReadback(controller.currentState.taskId, "readback-1", ["persistent_state", "deployment"]);
    const unrelated = declaredReadback(controller.currentState.taskId, "readback-2", ["persistent_state"]);
    const latest = declaredReadback(controller.currentState.taskId, "readback-3", ["deployment", "persistent_state"]);
    controller.evidence.set(first.ref, first);
    controller.evidence.set(unrelated.ref, unrelated);
    controller.evidence.set(latest.ref, latest);

    expect(evidenceIsCurrentDeclaredExternalReadback(controller, first)).toBe(false);
    expect(evidenceIsCurrentDeclaredExternalReadback(controller, unrelated)).toBe(true);
    expect(evidenceIsCurrentDeclaredExternalReadback(controller, latest)).toBe(true);
  });
});

function declaredReadback(
  taskId: string,
  ref: string,
  domains: TaskVerificationResolvedToolEffect["domains"],
): TaskVerificationEvidence {
  return {
    version: 2,
    taskId,
    ref,
    toolCallId: `${ref}-call`,
    toolName: "read_remote_state",
    descriptor: "declared external readback",
    outputSummary: "current remote state",
    toolEffect: { kind: "read", risk: "normal", domains, source: "declared" },
    isError: false,
    mutationRevision: 1,
    timestamp: new Date().toISOString(),
  };
}
