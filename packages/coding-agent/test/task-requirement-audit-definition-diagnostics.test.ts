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

describe("requirement definition diagnostics", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("reports independent atomicity, semantic, polarity, and source-coverage defects in one response", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "p-requirement-definition-diagnostics-"));
    workspaces.push(workspace);
    await writeFile(
      join(workspace, "SPEC.md"),
      [
        "Replay rejects malformed and truncated logs.",
        "Preserve the event log on failed writes.",
        "Reject invalid access tokens.",
        "Write a completion marker.",
        "",
      ].join("\n"),
    );
    git(workspace, "init", "-q");
    git(workspace, "add", "SPEC.md");

    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    await sendAuditUserPrompt(harness, "Implement every requirement in SPEC.md.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement every requirement in SPEC.md.",
    });
    expect(
      await callRequirementAudit(harness.controller, {
        action: "prepare_definition",
        selected_paths: ["SPEC.md"],
        ignored_paths: [],
      }),
    ).toContain("Prepared 1 immutable requirement-source snapshot");
    await nextModelTurn(harness);

    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "constraint",
          text: "Replay rejects invalid logs",
          acceptance_criterion: "Replay rejects malformed and truncated logs",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "behavior",
          text: "Delete every cached archive",
          acceptance_criterion: "No cached archive remains on disk",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C2"],
        },
        {
          type: "behavior",
          text: "Accept invalid access tokens",
          acceptance_criterion: "The service allows invalid access tokens",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C3"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    const orderedDiagnostics = [
      "Requirement 1 is compound",
      "Requirement 2: Source clause S2-C2 does not semantically support the mapped requirement",
      "Requirement 3: Source clause S2-C3 has behavioral polarity that the mapped requirement reverses",
      "unclassified source_clause_ids: S2-C4",
    ];
    expect(rejected).toContain("Requirement definition has 4 deterministic validation errors:");
    for (const diagnostic of orderedDiagnostics) expect(rejected).toContain(diagnostic);
    expect(orderedDiagnostics.map((diagnostic) => rejected.indexOf(diagnostic))).toEqual(
      [...orderedDiagnostics].map((diagnostic) => rejected.indexOf(diagnostic)).sort((left, right) => left - right),
    );
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
    expect(harness.controller.currentState.requirementAudit.requirements).toEqual([]);
  });

  it("leaves serialized controller state and the persisted branch byte-for-byte unchanged after rejection", async () => {
    const harness = await preparedHarness(workspaces, [
      "Replay rejects malformed and truncated logs.",
      "Reject invalid access tokens.",
    ]);
    const stateBefore = JSON.stringify(harness.controller.currentState);
    const branchBefore = JSON.stringify(harness.sessionManager.getBranch());

    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "constraint",
          text: "Replay rejects invalid logs",
          acceptance_criterion: "Replay rejects malformed and truncated logs",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "behavior",
          text: "Accept invalid access tokens",
          acceptance_criterion: "The service allows invalid access tokens",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C2"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(rejected).toContain("Requirement 1 is compound");
    expect(rejected).toContain("Source clause S2-C2 has behavioral polarity");
    expect(JSON.stringify(harness.controller.currentState)).toBe(stateBefore);
    expect(JSON.stringify(harness.sessionManager.getBranch())).toBe(branchBefore);

    await nextModelTurn(harness);
    const accepted = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "constraint",
          text: "Replay rejects malformed logs",
          acceptance_criterion: "Replay rejects a malformed log",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "constraint",
          text: "Replay rejects truncated logs",
          acceptance_criterion: "Replay rejects a truncated log",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "behavior",
          text: "Reject invalid access tokens",
          acceptance_criterion: "The service rejects invalid access tokens",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C2"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });
    expect(accepted).toContain("Defined 3 atomic requirement(s)");
    expect(harness.controller.currentState.requirementAudit.status).toBe("verifying");
    expect(harness.controller.currentState.requirementAudit.requirementSetHash).toBeTypeOf("string");
    expect(harness.controller.currentState.requirementAudit.userRequirementsHash).toBeTypeOf("string");
  });

  it("suppresses dependent semantic noise for malformed items while retaining independent diagnostics", async () => {
    const harness = await preparedHarness(workspaces, [
      "Preserve the event log on failed writes.",
      "Reject invalid access tokens.",
      "Write a completion marker.",
    ]);

    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "constraint",
          text: "   ",
          acceptance_criterion: "   ",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "behavior",
          text: "Accept invalid access tokens",
          acceptance_criterion: "The service allows invalid access tokens",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C2"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    expect(rejected).toContain("Requirement 1 needs concrete text and acceptance_criterion");
    expect(rejected).toContain("Source clause S2-C2 has behavioral polarity");
    expect(rejected).not.toContain("Source clause S2-C1 does not semantically support");
    expect(rejected).not.toContain("Source clause S2-C1 has uncovered normative concepts");
    expect(rejected).not.toContain("unclassified source_clause_ids: S2-C1");
    expect(rejected).toContain("unclassified source_clause_ids: S2-C3");
  });

  it("keeps same-clause semantic defects attributable to each invalid requirement", async () => {
    const harness = await preparedHarness(workspaces, ["Reject invalid access tokens."]);

    const rejected = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "Accept invalid access tokens",
          acceptance_criterion: "The service allows invalid access tokens",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
        {
          type: "behavior",
          text: "Create an unrelated archive",
          acceptance_criterion: "The unrelated archive exists",
          source_prompt_indexes: [1, 2],
          source_clause_ids: ["S2-C1"],
        },
      ],
      ignored_source_prompts: [],
      ignored_source_clauses: [],
    });

    const polarity = "Source clause S2-C1 has behavioral polarity that the mapped requirement reverses";
    expect(rejected).toContain(`Requirement 1: ${polarity}`);
    expect(rejected).toContain(
      "Requirement 2: Source clause S2-C1 does not semantically support the mapped requirement",
    );
  });
});

async function preparedHarness(workspaces: string[], lines: string[]) {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-definition-diagnostics-"));
  workspaces.push(workspace);
  await writeFile(join(workspace, "SPEC.md"), [...lines, ""].join("\n"));
  git(workspace, "init", "-q");
  git(workspace, "add", "SPEC.md");
  const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
  await sendAuditUserPrompt(harness, "Implement every requirement in SPEC.md.", 100);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Implement every requirement in SPEC.md.",
  });
  expect(
    await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["SPEC.md"],
      ignored_paths: [],
    }),
  ).toContain("Prepared 1 immutable requirement-source snapshot");
  await nextModelTurn(harness);
  return harness;
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
