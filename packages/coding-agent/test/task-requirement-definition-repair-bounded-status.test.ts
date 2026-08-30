import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import type { VerificationResult } from "../src/core/task-verification/types.ts";
import {
  activateRequirementDefinitionAfterEvidenceForTest,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordProductionMutationForTest,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition bounded status recovery", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("keeps an oversized selected repair non-actionable until exact identity can be retrieved", async () => {
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
    await recordProductionMutationForTest(harness);
    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);
    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [compoundRequirement()],
      ignored_source_prompts: [
        { source_prompt_index: 1, reason: "Pure delegation to the referenced README specification" },
      ],
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
    expect(status).toContain("REQUIREMENT AUDIT — SELECTED REPAIR EXCEEDS THE DEFINITION LIMIT");
    expect(status).toContain(`definition_revision: ${splitRevision}`);
    expect(status).toContain("next_required_action: status");
    expect(status).toContain("exact raw status result");
    expect(status).not.toContain("next_required_action: repair_definition");
    expect(status).not.toContain("next_required_action: define");
    expect(status).not.toContain(`invoice-${"x".repeat(1_000)}`);
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeDefined();

    const draftBeforeRepair = harness.controller.rejectedRequirementDefinitionDraft;
    const apply = vi.spyOn(harness.controller, "applyRequirementAudit");
    await nextModelTurn(harness);
    const blockedResult = await harness.controller.requirementAuditToolDefinition.execute(
      "oversized-selected-repair",
      {
        action: "repair_definition",
        definition_revision: splitRevision,
        requirement_repairs: [{ requirement_index: 2, replacements: [facetRequirement("reservation", "S2-C1-F2")] }],
      },
      undefined,
      undefined,
      {} as never,
    );
    const blocked = blockedResult.content[0]?.type === "text" ? blockedResult.content[0].text : "";
    const blockedDetails = blockedResult.details as VerificationResult;
    expect(apply).not.toHaveBeenCalled();
    expect(blocked).toContain("next_required_action: status");
    expect(blocked).not.toContain("next_required_action: repair_definition");
    expect(blockedDetails.contextExtract?.summary).toContain("next_required_action: status");
    expect(blockedDetails.contextExtract?.summary).not.toContain("next_required_action: repair_definition");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBe(draftBeforeRepair);
    expect(revisionFrom(blocked)).toBe(splitRevision);
  });
});

function compoundRequirement() {
  return {
    type: "behavior" as const,
    text: "Shipping reduces both onHand and the reservation",
    acceptance_criterion: "Shipping reduces both onHand and the reservation by the shipped quantity",
    source_prompt_indexes: [],
    source_clause_ids: ["S2-C1"],
    source_facet_ids: ["S2-C1-F1", "S2-C1-F2"],
  };
}

function facetRequirement(object: string, sourceFacetId: string) {
  return {
    type: "behavior" as const,
    text: `Shipping reduces ${object}`,
    acceptance_criterion: `Shipping reduces ${object} by the shipped quantity`,
    source_prompt_indexes: [],
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
