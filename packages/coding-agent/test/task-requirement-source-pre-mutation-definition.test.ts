import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  auditEvidenceHandle,
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
    const status = await callTaskVerification(harness.controller, { action: "status" });
    expect(status).not.toContain("define and obtain one accepted complete requirement set");
    expect(status).not.toContain("before implementation");
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
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/index.test.ts" },
        { text: "focused implementation tests passed" },
      ),
    );
    await nextModelTurn(harness);
    const readiness = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "Output remains deterministic", evidence_refs: [evidenceRef] }],
      unresolved_failures: [],
    });
    expect(readiness).toContain("Evidence readiness passed");
    expect(readiness).toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");
    await nextModelTurn(harness);
    const evidenceReadyGate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "true", newText: "false" }],
    });
    expect(evidenceReadyGate?.block).toBe(true);
    expect(evidenceReadyGate?.reason).toContain("accepted complete requirement definition");
    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Preserve deterministic output",
          acceptance_criterion: "Output remains deterministic",
          source_prompt_indexes: [],
          source_clause_ids: ["S2-C2"],
        },
      ],
      ignored_source_prompts: [
        { source_prompt_index: 1, reason: "Pure delegation to the referenced README specification" },
      ],
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

    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/index.ts",
          edits: [{ oldText: "true", newText: "false" }],
        })
      )?.block,
    ).not.toBe(true);
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "true", newText: "false" }],
    });
    expect(harness.controller.currentState.readiness?.status).toBe("pending");
    expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
  });

  it("defers the combined source and direct requirements without dropping the direct requirement", async () => {
    workspace = await mkdtemp(join(tmpdir(), "p-mixed-requirement-definition-"));
    await writeFile(join(workspace, "README.md"), "# Requirements\n\nPreserve deterministic output.\n");
    git(workspace, "init", "-q");
    git(workspace, "add", "README.md");
    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement the behavior specified by README.md and reject empty input.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement README.md and reject empty input.",
    });
    const prepared = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    expect(prepared).toContain("Implementation may proceed");
    expect(prepared).not.toContain("DEFINE AUTHORITATIVE USER REQUIREMENTS");

    const gate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    expect(gate?.block).not.toBe(true);
    await recordAuditToolResult(harness.agent, "write", {
      path: "src/index.ts",
      content: "export const implemented = true;\n",
    });
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/index.test.ts" },
        { text: "focused source and empty-input tests passed" },
      ),
    );

    await nextModelTurn(harness);
    const readiness = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        { criterion: "README behavior and empty-input rejection both pass", evidence_refs: [evidenceRef] },
      ],
      unresolved_failures: [],
    });
    expect(readiness).toContain("DEFINE AUTHORITATIVE USER REQUIREMENTS");
    expect(readiness).toContain("S2-C2");
    expect(readiness).toContain("reject empty input");
    await nextModelTurn(harness);
    const defined = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Preserve deterministic output",
          acceptance_criterion: "Output remains deterministic",
          source_clause_ids: ["S2-C2"],
        },
        {
          type: "behavior",
          text: "Reject empty input",
          acceptance_criterion: "Empty input is rejected",
          source_prompt_indexes: [1],
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
    expect(defined).toContain("Defined 2 atomic requirement");
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/index.ts",
          edits: [{ oldText: "old", newText: "new" }],
        })
      )?.block,
    ).not.toBe(true);
  });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
