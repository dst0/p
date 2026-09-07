import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callEvidenceVerification, createEvidenceHarness } from "./task-verification-evidence-test-harness.ts";

describe("multilingual evidence-checklist continuity across user nudges", () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
  });

  it.each([
    "Ну и как успехи?",
    "Какой статус?",
    "Есть прогресс?",
    "продолжай",
    "готово?",
    "Як успіхи?",
    "Який статус?",
    "Є прогрес?",
    "продовжуй",
    "закінчено?",
  ])("retains the frozen checklist after the short progress nudge: %s", async (nudge) => {
    const harness = await checklistHarness(workspaces);
    const before = harness.controller.currentState;

    await harness.emit({
      type: "message_end",
      message: { role: "user", content: nudge, timestamp: 200 },
    });

    expect(harness.controller.currentState.completionChecklist).toEqual(before.completionChecklist);
    expect(harness.controller.currentState.taskPrompts).toEqual(before.taskPrompts);
  });

  it.each(["продолжай и добавь логирование", "продовжуй і додай логування"])(
    "invalidates the checklist when a continuation message adds a requirement: %s",
    async (instruction) => {
      const harness = await checklistHarness(workspaces);

      await harness.emit({
        type: "message_end",
        message: { role: "user", content: instruction, timestamp: 200 },
      });

      expect(harness.controller.currentState.completionChecklist).toBeUndefined();
      expect(harness.controller.currentState.taskPrompts?.map((prompt) => prompt.text)).toEqual([
        "Implement the requested parser behavior.",
        instruction,
      ]);
    },
  );
});

async function checklistHarness(workspaces: string[]) {
  const workspace = mkdtempSync(join(tmpdir(), "p-multilingual-nudge-"));
  workspaces.push(workspace);
  const harness = createEvidenceHarness(workspace);
  await harness.emit({ type: "turn_start" });
  await harness.emit({
    type: "message_end",
    message: {
      role: "user",
      content: "Implement the requested parser behavior.",
      timestamp: 100,
    },
  });
  const recorded = await callEvidenceVerification(harness.controller, {
    action: "record_completion_checklist",
    completion_checklist: ["The parser implements the requested behavior"],
  });
  expect(recorded).toContain("Completion checklist recorded");
  return harness;
}
