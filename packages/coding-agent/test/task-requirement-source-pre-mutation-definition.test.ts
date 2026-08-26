import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("referenced-source pre-mutation requirement definition", () => {
  let workspace: string | undefined;

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("requires an accepted complete definition after freezing and before implementation", async () => {
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

    expect(prepared).toContain("Complete the requirement definition before implementation");
    expect(prepared).toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
    const blockedBeforeDefinition = await beforeAuditTool(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    expect(blockedBeforeDefinition?.block).toBe(true);
    expect(blockedBeforeDefinition?.reason).toContain("accepted complete requirement definition");

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
    expect(defined).toContain("Defined 1 atomic requirement(s) before production mutation");
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
    expect(harness.controller.currentState.mutationRevision).toBe(1);
    expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
    expect(harness.controller.currentState.requirementAudit.requirements).toHaveLength(1);
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.text).toBe(
      "Preserve deterministic output",
    );
  });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
