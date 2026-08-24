import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { ACTIVE_REJECTED_DEFINITION_MARKER } from "../src/core/task-verification/requirement-definition-prompt.ts";
import {
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition bounded status recovery", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("keeps the repair barrier armed when bounded status omits the active indexed batch", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "p-requirement-repair-bounded-status-"));
    workspaces.push(workspace);
    await writeFile(join(workspace, "README.md"), "Shipping reduces both onHand and the reservation.\n");
    git(workspace, "init", "-q");
    git(workspace, "add", "README.md");
    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement the behavior specified by README.md.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement the behavior specified by README.md",
    });
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    await nextModelTurn(harness);
    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [compoundRequirement()],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
    await nextModelTurn(harness);
    const split = await callRequirementAudit(harness.controller, {
      action: "repair_definition",
      definition_revision: revisionFrom(rejected),
      requirement_repairs: [
        {
          requirement_index: 1,
          replacements: [
            facetRequirement("onHand", "S2-C1-F1"),
            facetRequirement(`invoice-${"x".repeat(34_000)}`, "S2-C1-F2"),
          ],
        },
      ],
    });
    const splitRevision = revisionFrom(split);

    const status = await callTaskVerification(harness.controller, { action: "status" });
    expect(status).not.toContain(ACTIVE_REJECTED_DEFINITION_MARKER);
    expect(harness.controller.requirementRepairStatusRevision).toBe(splitRevision);
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "repair_definition",
        definition_revision: splitRevision,
        requirement_repairs: [{ requirement_index: 2, replacements: [facetRequirement("reservation", "S2-C1-F2")] }],
      }),
    ).toContain('record_task_verification with action "status"');
  });
});

function compoundRequirement() {
  return {
    type: "behavior" as const,
    text: "Shipping reduces both onHand and the reservation",
    acceptance_criterion: "Shipping reduces both onHand and the reservation by the shipped quantity",
    source_prompt_indexes: [1, 2],
    source_clause_ids: ["S2-C1"],
    source_facet_ids: ["S2-C1-F1", "S2-C1-F2"],
  };
}

function facetRequirement(object: string, sourceFacetId: string) {
  return {
    type: "behavior" as const,
    text: `Shipping reduces ${object}`,
    acceptance_criterion: `Shipping reduces ${object} by the shipped quantity`,
    source_prompt_indexes: [1, 2],
    source_clause_ids: ["S2-C1"],
    source_facet_ids: [sourceFacetId],
  };
}

function revisionFrom(text: string): string {
  const revision = text.match(/definition_revision: ([0-9a-f-]+)/u)?.[1];
  if (!revision) throw new Error(`Missing definition revision in: ${text}`);
  return revision;
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
