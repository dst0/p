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

describe("delegated prompt definition repair", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("classifies delegation context without replacing clause-backed requirement provenance", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "p-delegated-prompt-repair-"));
    workspaces.push(workspace);
    await writeFile(join(workspace, "SPEC.md"), "Implement widget.\n");
    git(workspace, "init", "-q");
    git(workspace, "config", "maintenance.auto", "false");
    git(workspace, "config", "gc.auto", "0");
    git(workspace, "add", "SPEC.md");

    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement every requirement from SPEC.md and finish verification.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement every requirement from SPEC.md.",
    });
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["SPEC.md"],
      ignored_paths: [],
    });
    await nextModelTurn(harness);

    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "deliverable",
          text: "Implement widget",
          acceptance_criterion: "The widget is implemented",
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
    expect(rejected).toContain("unclassified indexes: 1");

    await nextModelTurn(harness);
    const repaired = await callRequirementAudit(harness.controller, {
      action: "repair_definition",
      definition_revision: harness.controller.rejectedRequirementDefinitionDraft?.revision,
      ignored_source_prompt_upserts: [
        { source_prompt_index: 1, reason: "Delegation and verification workflow context only" },
      ],
    });

    expect(repaired).toContain("Defined 1 atomic requirement");
    expect(harness.controller.currentState.requirementAudit.requirements[0]).toMatchObject({
      sourceClauseIds: ["S2-C1"],
      sourcePromptIndexes: [2],
    });
    expect(harness.controller.currentState.requirementAudit.ignoredSourcePrompts).toEqual([
      { sourcePromptIndex: 1, reason: "Delegation and verification workflow context only" },
    ]);
  });
});

function git(workspace: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
