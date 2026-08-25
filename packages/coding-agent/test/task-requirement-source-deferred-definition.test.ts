import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  activateRequirementDefinitionAfterEvidenceForTest,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("deferred referenced-source requirement definition", () => {
  let workspace: string | undefined;

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("allows implementation after freezing a selected source and defers definition until completion", async () => {
    workspace = await mkdtemp(join(tmpdir(), "p-deferred-requirement-definition-"));
    await writeFile(join(workspace, "README.md"), "# Requirements\n\nPreserve deterministic output.\n");
    git(workspace, "init", "-q");
    git(workspace, "add", "README.md");
    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement the behavior specified by README.md.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement the behavior specified by README.md.",
    });

    const prepared = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });

    expect(prepared).toContain("Implementation may proceed");
    expect(prepared).not.toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
    await nextModelTurn(harness);
    expect(
      await callRequirementAudit(harness.controller, {
        action: "define",
        requirements: [
          {
            type: "behavior",
            text: "Preserve deterministic output",
            acceptance_criterion: "Output remains deterministic",
            source_clause_ids: ["S2-C2"],
          },
        ],
        ignored_source_prompts: [
          { source_prompt_index: 1, reason: "Pure delegation to the referenced README specification" },
        ],
        ignored_source_clauses: [],
      }),
    ).toContain("Complete record_task_verification");
    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/index.ts",
          edits: [{ oldText: "old", newText: "new" }],
        })
      )?.block,
    ).not.toBe(true);

    await recordAuditToolResult(harness.agent, "write", {
      path: "src/index.ts",
      content: "export const implemented = true;\n",
    });
    await writeFile(join(workspace, "README.md"), "# Requirements\n\nPreserve stable output.\n");
    const changedSourceGate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "true", newText: "false" }],
    });
    expect(changedSourceGate?.block).toBe(true);
    expect(changedSourceGate?.reason).toContain("changed after preparation");

    await writeFile(join(workspace, "README.md"), "# Requirements\n\nPreserve deterministic output.\n");
    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);
    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Preserve deterministic output",
          acceptance_criterion: "Output remains deterministic",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C2"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [
        {
          source_clause_id: "S2-C1",
          classification: "informational",
          reason: "The heading labels the requirements section.",
        },
      ],
    });
    expect(defined).toContain("Defined 1 atomic requirement");
    expect(harness.controller.currentState.requirementAudit.status).toBe("verifying");
  });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
