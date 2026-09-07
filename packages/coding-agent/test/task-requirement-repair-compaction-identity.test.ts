import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createToolResultStub } from "../src/core/compaction/compaction/token-counting.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  activateRequirementDefinitionAfterEvidenceForTest,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement repair compaction identity", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("keeps the selected diagnostic and frozen source clause self-identifying after compaction", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "p-repair-compaction-identity-"));
    workspaces.push(workspace);
    await writeFile(join(workspace, "README.md"), "Implement alpha.\nImplement beta.\nImplement gamma.\n");
    git(workspace, "init", "-q");
    git(workspace, "add", "README.md");
    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement every requirement in README.md.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement every requirement in README.md",
    });
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);

    const result = await harness.controller.requirementAuditToolDefinition.execute(
      "missing-beta-definition",
      {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Implement alpha",
            acceptance_criterion: "Alpha is implemented",
            source_clause_ids: ["S2-C1"],
          },
        ],
        ignored_source_prompts: [{ source_prompt_index: 1, reason: "Delegates the requirements to README.md" }],
        ignored_source_clauses: [],
      },
      undefined,
      undefined,
      {} as never,
    );
    const source = harness.controller.currentState.requirementSourceRefs?.[0];
    const directFeedback = result.content[0]?.type === "text" ? result.content[0].text : "";
    const compactedRepair = compactedSummary(
      "missing-beta-definition",
      "record_requirement_audit",
      result.content,
      result.details,
    );

    expect(source).toBeDefined();
    for (const output of [directFeedback, compactedRepair]) {
      assertClauseIdentity(output, source!.id, "S2-C2", "Implement beta.");
    }

    await nextModelTurn(harness);
    const offTarget = await harness.controller.requirementAuditToolDefinition.execute(
      "off-target-prompt-classification",
      {
        action: "repair_definition",
        definition_revision: revisionFrom(directFeedback),
        ignored_source_prompt_upserts: [{ source_prompt_index: 1, reason: "Changed delegation reason" }],
      },
      undefined,
      undefined,
      {} as never,
    );
    const offTargetFeedback = offTarget.content[0]?.type === "text" ? offTarget.content[0].text : "";
    assertClauseIdentity(offTargetFeedback, source!.id, "S2-C2", "Implement beta.");
    expect(offTargetFeedback).toContain(`definition_revision: ${revisionFrom(directFeedback)}`);

    await nextModelTurn(harness);
    const repair = await harness.controller.requirementAuditToolDefinition.execute(
      "add-beta-requirement",
      {
        action: "repair_definition",
        definition_revision: revisionFrom(directFeedback),
        requirement_addition: {
          type: "behavior",
          text: "Implement beta",
          acceptance_criterion: "Beta is implemented",
          source_clause_ids: ["S2-C2"],
        },
      },
      undefined,
      undefined,
      {} as never,
    );
    const directRepair = repair.content[0]?.type === "text" ? repair.content[0].text : "";
    const compactedNextRepair = compactedSummary(
      "add-beta-requirement",
      "record_requirement_audit",
      repair.content,
      repair.details,
    );
    for (const output of [directRepair, compactedNextRepair]) {
      assertClauseIdentity(output, source!.id, "S2-C3", "Implement gamma.");
    }

    harness.controller.restore();
    const status = await harness.controller.toolDefinition.execute(
      "restored-repair-status",
      { action: "status" },
      undefined,
      undefined,
      {} as never,
    );
    const compactedStatus = compactedSummary(
      "restored-repair-status",
      "record_task_verification",
      status.content,
      status.details,
    );
    assertClauseIdentity(compactedStatus, source!.id, "S2-C3", "Implement gamma.");
    expect(compactedStatus).not.toContain('"source_prompt_index":3');
  });
});

function assertClauseIdentity(output: string, sourceId: string, clauseId: string, clauseText: string): void {
  expect(output).toContain(`"target_key":"source_clause:${clauseId}"`);
  expect(output).toContain('"diagnostic_index":1');
  expect(output).toContain(`unclassified source_clause_ids: ${clauseId}`);
  expect(output).toContain(`"source_id":${JSON.stringify(sourceId)}`);
  expect(output).toContain('"source_prompt_index":2');
  expect(output).toContain('"source_kind":"referenced_file"');
  expect(output).toContain('"source_path":"README.md"');
  expect(output).toContain(`"source_clause_id":${JSON.stringify(clauseId)}`);
  expect(output).toContain(`"clause_text":${JSON.stringify(clauseText)}`);
}

function revisionFrom(output: string): string {
  const revision = output.match(/definition_revision: ([0-9a-f-]+)/u)?.[1];
  if (!revision) throw new Error(`Missing definition revision in: ${output}`);
  return revision;
}

function compactedSummary(
  toolCallId: string,
  toolName: string,
  content: ToolResultMessage["content"],
  details: unknown,
): string {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId,
    toolName,
    content,
    isError: false,
    details,
    timestamp: 1_700_000_000_000,
  };
  return createToolResultStub(message, 0, 4_000).stub.rawPointer.summary;
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
