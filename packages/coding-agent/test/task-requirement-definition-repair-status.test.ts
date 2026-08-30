import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  activateRequirementDefinitionAfterEvidenceForTest,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("rejected requirement definition status recovery", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("recovers the latest sparse-repair revision instead of restarting a full definition", async () => {
    const { harness, firstRevision, latestRevision, latestDiagnostics } = await rejectedRepair(workspaces);
    const status = await callTaskVerification(harness.controller, { action: "status" });
    expect(latestRevision).not.toBe(firstRevision);
    expect(status).toContain(`definition_revision: ${latestRevision}`);
    expect(status).toContain('action "repair_definition"');
    expect(status).toContain("ACTIVE REJECTED DEFINITION BATCH");
    expect(status).toContain("Shipping reduces onHand");
    expect(status).toContain(latestDiagnostics);
    expect(status).not.toContain("Ship command changes two counters together");
    expect(status).not.toContain('Call record_requirement_audit with action "define"');

    harness.controller.restore();
    const restoredStatus = await callTaskVerification(harness.controller, { action: "status" });
    expect(restoredStatus).toContain(`definition_revision: ${latestRevision}`);
    expect(restoredStatus).toContain('action "repair_definition"');
    expect(restoredStatus).toContain("ACTIVE REJECTED DEFINITION BATCH");
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, staleRepair("00000000-0000-4000-8000-000000000000")),
    ).toContain("stale or unavailable");
  });

  it("preserves stable referenced-source identities when a follow-up extends the rejected batch", async () => {
    const { harness, latestRevision } = await rejectedRepair(workspaces);
    await sendAuditUserPrompt(harness, "Also preserve the exact event position.", 200);
    const status = await callTaskVerification(harness.controller, { action: "status" });

    expect(status).toContain("Also preserve the exact event position.");
    expect(status).toContain(`definition_revision: ${latestRevision}`);
    expect(status).toContain("ACTIVE REJECTED DEFINITION BATCH");
    expect(status).toContain("[Source 2 | kind=referenced_file");
    expect(status).toContain("S2-C2");
    expect(status).not.toContain("[Source 3 | kind=referenced_file");
    expect(status).not.toContain('Call record_requirement_audit with action "define"');
    harness.controller.restore();
    const restored = await callTaskVerification(harness.controller, { action: "status" });
    expect(restored).toContain(`definition_revision: ${latestRevision}`);
    expect(restored).toContain("[Source 2 | kind=referenced_file");
    expect(restored).not.toContain("[Source 3 | kind=referenced_file");
  });

  it("rejects keyed classification edits that do not target the selected diagnostic", async () => {
    const harness = await preparedRepairHarness(
      workspaces,
      ["Example payload.", "Example archive.", "Shipping reduces both onHand and the reservation."].join("\n"),
    );
    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [compoundFacetRequirement("S2-C3")],
      ignored_source_prompts: [
        { source_prompt_index: 1, reason: "Pure delegation to the referenced README specification" },
      ],
      ignored_source_clauses: [
        exampleClassification("S2-C1", "Payload example"),
        exampleClassification("S2-C2", "Archive example"),
      ],
    });
    await nextModelTurn(harness);
    const revision = revisionFrom(rejected);
    const offTargetUpsert = await callRequirementAudit(harness.controller, {
      action: "repair_definition",
      definition_revision: revision,
      ignored_source_clause_upserts: [exampleClassification("S2-C1", "Updated payload example")],
    });

    expect(offTargetUpsert).toContain("does not target the controller-selected diagnostic");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.ignored_source_clauses).toEqual([
      exampleClassification("S2-C1", "Payload example"),
      exampleClassification("S2-C2", "Archive example"),
    ]);
    await nextModelTurn(harness);
    const offTargetRemoval = await callRequirementAudit(harness.controller, {
      action: "repair_definition",
      definition_revision: revision,
      ignored_source_clause_removals: ["S2-C2"],
    });
    expect(offTargetRemoval).toContain("does not target the controller-selected diagnostic");
    expect(harness.controller.rejectedRequirementDefinitionDraft?.revision).toBe(revision);
    expect(harness.controller.rejectedRequirementDefinitionDraft?.input.ignored_source_clauses).toEqual([
      exampleClassification("S2-C1", "Payload example"),
      exampleClassification("S2-C2", "Archive example"),
    ]);
  });

  it("repairs the returned current indexes directly after a rejected split", async () => {
    const { harness, splitRevision } = await rejectedSplit(workspaces);
    await nextModelTurn(harness);
    expect(await callRequirementAudit(harness.controller, shiftedRepair(splitRevision))).toContain(
      "Defined 2 atomic requirement",
    );
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
  });
});

async function rejectedSplit(workspaces: string[]): Promise<{
  harness: RequirementAuditHarness;
  splitRevision: string;
}> {
  const harness = await preparedRepairHarness(workspaces, "Shipping reduces both onHand and the reservation.");
  const rejected = await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [compoundFacetRequirement("S2-C1")],
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
        replacements: [facetRequirement("onHand", "S2-C1-F1"), facetRequirement("invoice", "S2-C1-F2")],
      },
    ],
  });
  return { harness, splitRevision: revisionFrom(split) };
}

function shiftedRepair(definitionRevision: string) {
  return {
    action: "repair_definition" as const,
    definition_revision: definitionRevision,
    requirement_repairs: [{ requirement_index: 2, replacements: [facetRequirement("reservation", "S2-C1-F2")] }],
  };
}

async function preparedRepairHarness(workspaces: string[], source: string): Promise<RequirementAuditHarness> {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-repair-sequence-"));
  workspaces.push(workspace);
  await writeFile(join(workspace, "README.md"), `${source}\n`);
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
  activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
  await nextModelTurn(harness);
  return harness;
}

function compoundFacetRequirement(sourceClauseId: string) {
  return {
    type: "behavior" as const,
    text: "Shipping reduces both onHand and the reservation",
    acceptance_criterion: "Shipping reduces both onHand and the reservation by the shipped quantity",
    source_clause_ids: [sourceClauseId],
    source_facet_ids: [`${sourceClauseId}-F1`, `${sourceClauseId}-F2`],
  };
}

function facetRequirement(object: string, sourceFacetId: string) {
  return {
    type: "behavior" as const,
    text: `Shipping reduces ${object}`,
    acceptance_criterion: `Shipping reduces ${object} by the shipped quantity`,
    source_clause_ids: [sourceFacetId.replace(/-F\d+$/u, "")],
    source_facet_ids: [sourceFacetId],
  };
}

function exampleClassification(sourceClauseId: string, reason: string) {
  return { source_clause_id: sourceClauseId, classification: "example" as const, reason };
}

async function rejectedRepair(workspaces: string[]): Promise<{
  harness: RequirementAuditHarness;
  firstRevision: string;
  latestRevision: string;
  latestDiagnostics: string;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-repair-status-"));
  workspaces.push(workspace);
  await writeFile(
    join(workspace, "README.md"),
    "# Requirements\n\nShipping reduces both onHand and the reservation.\n",
  );
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
  activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
  await nextModelTurn(harness);
  const rejected = await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [requirement("Ship command changes two counters together")],
    ignored_source_prompts: [
      { source_prompt_index: 1, reason: "Pure delegation to the referenced README specification" },
    ],
    ignored_source_clauses: [],
  });
  const firstRevision = revisionFrom(rejected);
  await nextModelTurn(harness);
  const repaired = await callRequirementAudit(harness.controller, {
    action: "repair_definition",
    definition_revision: firstRevision,
    requirement_repairs: [
      {
        requirement_index: 1,
        replacements: [facetRequirement("onHand", "S2-C2-F1")],
      },
    ],
  });
  return {
    harness,
    firstRevision,
    latestRevision: revisionFrom(repaired),
    latestDiagnostics: repaired.split("\n\n")[0]!,
  };
}

function staleRepair(definitionRevision: string) {
  return {
    action: "repair_definition",
    definition_revision: definitionRevision,
    requirement_repairs: [{ requirement_index: 1, replacements: [requirement("Stale replacement")] }],
  };
}

function requirement(text: string) {
  return {
    type: "behavior" as const,
    text,
    acceptance_criterion: `${text} by the shipped quantity`,
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
