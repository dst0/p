import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { TASK_VERIFICATION_STATE_CUSTOM_TYPE } from "../src/core/task-verification.ts";
import {
  activateRequirementDefinitionAfterEvidenceForTest,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("referenced requirement documents", () => {
  let workspace: string;
  let harness: RequirementAuditHarness;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "p-requirement-spec-"));
    await writeFile(
      join(workspace, "README.md"),
      [
        "# Durable log",
        "",
        "Export the log as deterministic newline-terminated JSONL.",
        "Any log truncation must throw ValidationError.",
        "",
      ].join("\n"),
    );
    git(workspace, "init", "-q");
    git(workspace, "add", "README.md");
    harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement the durable log described in README.md.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement the referenced durable log",
    });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("prepares an immutable referenced spec and permits mutation before its complete definition", async () => {
    const beforeRead = await beforeAuditTool(harness.agent, "edit", {
      path: "src/store.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    expect(beforeRead?.block).toBe(true);
    expect(beforeRead?.reason).toContain("README.md");
    expect(beforeRead?.reason).toContain("prepare_definition");

    const prepared = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    expect(prepared).toContain("Prepared 1 immutable requirement-source snapshot");
    expect(prepared).toContain("Implementation may proceed");
    expect(prepared).not.toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");
    expect(JSON.stringify(harness.controller.currentState)).not.toContain("Any log truncation");

    const afterRead = await beforeAuditTool(harness.agent, "edit", {
      path: "src/store.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    expect(afterRead?.block).not.toBe(true);

    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);
    const definition = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Export deterministic newline-terminated JSONL",
          acceptance_criterion: "The exported log is deterministic JSONL ending in a terminal newline",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C2"],
        },
        {
          type: "behavior",
          text: "The log rejects any truncation including removal of its exact final byte",
          acceptance_criterion:
            "Exact removal of the terminal newline final byte is one rejected instance of any log truncation and throws ValidationError",
          source_prompt_indexes: [],
          source_clause_ids: ["S2-C3"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [
        {
          source_clause_id: "S2-C1",
          classification: "informational",
          reason: "The heading labels the durable log requirements.",
        },
      ],
    });
    expect(definition).toContain("Defined 2 atomic requirement");
    expect(definition).toContain("remove exactly the final byte");
    expect(harness.controller.currentState.requirementAudit.requirements[1]?.proofPolicies).toEqual([
      "remove_exact_final_byte",
    ]);
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/store.ts",
          edits: [{ oldText: "old", newText: "new" }],
        })
      )?.block,
    ).not.toBe(true);
  });

  it("rejects a generic truncation definition when the source derives a terminal-byte boundary", async () => {
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);
    const definition = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Export deterministic newline-terminated JSONL",
          acceptance_criterion: "The exported log is deterministic JSONL ending in a terminal newline",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C2"],
        },
        {
          type: "behavior",
          text: "Truncated logs are rejected",
          acceptance_criterion: "A truncated event line throws ValidationError",
          source_prompt_indexes: [],
          source_clause_ids: ["S2-C3"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [
        {
          source_clause_id: "S2-C1",
          classification: "informational",
          reason: "The heading labels the durable log requirements.",
        },
      ],
    });

    expect(definition).toContain("terminal newline");
    expect(definition).toContain("final byte");
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
  });

  it("fails closed when a prepared source changes before definition", async () => {
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    await writeFile(join(workspace, "README.md"), "# Changed\n\nDifferent requirement.\n");
    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);
    const definition = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Reject final-byte truncation",
          acceptance_criterion: "Removing the final byte throws ValidationError",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C2", "S2-C3"],
        },
      ],
      ignored_source_prompts: [],
    });

    expect(definition).toContain("changed after preparation");
  });

  it("restores prepared source text only from its exact snapshot entry", async () => {
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    const restored = createRequirementAuditHarness(harness.sessionManager);

    expect(restored.controller.restoreError).toBeUndefined();
    expect([...restored.controller.requirementSourceTexts.values()].join("\n")).toContain(
      "Any log truncation must throw ValidationError.",
    );
    expect(JSON.stringify(restored.controller.currentState)).not.toContain("Any log truncation");
  });

  it("retains prepared sources while classifying new references from a later user prompt", async () => {
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    activateRequirementDefinitionAfterEvidenceForTest(harness.controller);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Export deterministic newline-terminated JSONL",
          acceptance_criterion: "The exported log is deterministic JSONL ending in a terminal newline",
          source_prompt_indexes: [1],
          source_clause_ids: ["S2-C2"],
        },
        {
          type: "behavior",
          text: "The log rejects any truncation including removal of its exact final byte",
          acceptance_criterion:
            "Exact removal of the terminal newline final byte is one rejected instance of any log truncation",
          source_prompt_indexes: [],
          source_clause_ids: ["S2-C3"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [
        {
          source_clause_id: "S2-C1",
          classification: "informational",
          reason: "The heading labels the durable log requirements.",
        },
      ],
    });
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/store.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    await writeFile(join(workspace, "DESIGN.md"), "# Design\n\nPreserve stable event ordering.\n");
    git(workspace, "add", "DESIGN.md");
    await sendAuditUserPrompt(harness, "Also follow DESIGN.md for stable event ordering.", 200);

    expect(harness.controller.currentState.requirementSourceRefs).toHaveLength(1);
    expect(harness.controller.requirementSourceTexts.size).toBe(1);
    const gate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/store.ts",
      edits: [{ oldText: "new", newText: "newer" }],
    });
    expect(gate?.block).toBe(true);
    expect(gate?.reason).toContain("README.md");
    expect(gate?.reason).toContain("DESIGN.md");
  });

  it("fails closed when persisted state points at a missing source snapshot", async () => {
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
    });
    const state = harness.controller.currentState;
    state.requirementSourceRefs![0]!.snapshotEntryId = "missing-snapshot-entry";
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, state);

    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.restoreError).toContain("missing or corrupt");
    expect(restored.controller.requirementSourceTexts.size).toBe(0);
  });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
