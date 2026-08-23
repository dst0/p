import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement definition continuity across user nudges", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it.each([
    "progress?",
    "report status",
    "so?",
    "please continue",
    "Are you done with the task or is there anything left? If you are finished, ensure all requirements are satisfied and create finish_notes.md.",
  ])("retains a frozen definition after the non-requirement nudge: %s", async (nudge) => {
    const harness = await definedHarness(workspaces);
    const before = harness.controller.currentState;

    await sendAuditUserPrompt(harness, nudge, 200);

    expect(harness.controller.currentState.requirementAudit).toEqual(before.requirementAudit);
    expect(harness.controller.currentState.taskPrompts).toEqual(before.taskPrompts);
    expect(harness.controller.currentState.requirementSourceRefs).toEqual(before.requirementSourceRefs);
  });

  it("invalidates the definition when a later prompt adds a requirement", async () => {
    const harness = await definedHarness(workspaces);

    await sendAuditUserPrompt(harness, "Also require an uppercase suffix.", 200);

    expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
    expect(harness.controller.currentState.requirementAudit.requirements).toEqual([]);
    expect(harness.controller.currentState.taskPrompts).toHaveLength(2);
  });

  it("does not hide a path-free requirement inside completion-reminder boilerplate", async () => {
    const harness = await definedHarness(workspaces);

    await sendAuditUserPrompt(
      harness,
      "Are you done with the task or is there anything left? If you are finished, ensure all requirements are satisfied. Also require a lowercase fallback.",
      200,
    );

    expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
    expect(harness.controller.currentState.requirementAudit.requirements).toEqual([]);
    expect(harness.controller.currentState.taskPrompts).toHaveLength(2);
  });
});

async function definedHarness(workspaces: string[]) {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-nudge-"));
  workspaces.push(workspace);
  await writeFile(join(workspace, "SPEC.md"), "Render the greeting in uppercase.\n");
  git(workspace, "init", "-q");
  git(workspace, "add", "SPEC.md");
  const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
  const taskPrompt = "Implement SPEC.md. When complete, create finish_notes.md.";
  await sendAuditUserPrompt(harness, taskPrompt, 100);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: taskPrompt,
  });
  await callRequirementAudit(harness.controller, {
    action: "prepare_definition",
    selected_paths: ["SPEC.md"],
    ignored_paths: [{ path: "finish_notes.md", reason: "This is an output deliverable, not an input specification." }],
  });
  await nextModelTurn(harness);
  const defined = await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: "Render the greeting in uppercase",
        acceptance_criterion: "The rendered greeting equals uppercase text",
        source_prompt_indexes: [1, 2],
        source_clause_ids: ["S2-C1"],
      },
    ],
    ignored_source_prompts: [],
    ignored_source_clauses: [],
  });
  expect(defined).toContain("Defined 1 atomic requirement");
  return harness;
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
