import { execFileSync } from "node:child_process";
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
  type RequirementAuditHarness,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement-source preparation boundaries", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("requires task declaration before preparing referenced sources", async () => {
    const { harness } = await setup(workspaces, "Implement README.md.", false);

    expect(await prepare(harness)).toContain("Declare the task before preparing referenced requirement sources");
  });

  it("reuses an unchanged frozen snapshot without changing its identity", async () => {
    const { harness } = await setup(workspaces, "Implement the behavior specified by README.md.");
    await prepare(harness);
    const references = structuredClone(harness.controller.currentState.requirementSourceRefs);
    const texts = [...harness.controller.requirementSourceTexts.entries()];
    await nextModelTurn(harness);

    const result = await prepare(harness);

    expect(result).toContain("(0 new, 1 reused)");
    expect(harness.controller.currentState.requirementSourceRefs).toEqual(references);
    expect([...harness.controller.requirementSourceTexts.entries()]).toEqual(texts);
  });

  it("fails closed when persisted metadata has lost its frozen source text", async () => {
    const { harness } = await setup(workspaces, "Implement the behavior specified by README.md.");
    await prepare(harness);
    harness.controller.requirementSourceTexts.clear();
    await nextModelTurn(harness);

    const result = await prepare(harness);

    expect(result).toContain("frozen snapshot for README.md is unavailable");
    expect(result).toContain("explicitly adopt the current changed file");
  });

  it("rejects adoption for a path that has not previously been frozen", async () => {
    const { harness } = await setup(workspaces, "Adopt the current changed README.md as the specification.");

    const result = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
      adopt_changed_paths: ["README.md"],
    });

    expect(result).toContain("adopt_changed_paths may only name an already frozen selected path: README.md");
  });

  it("rejects a combined direct prompt and source that cannot fit the definition prompt", async () => {
    const prompt = `Implement README.md exactly. ${"Direct requirement context. ".repeat(1_000)}`;
    const { harness } = await setup(workspaces, prompt, true, `# Requirements\n\n${"x".repeat(12_000)}\n`);

    const result = await prepare(harness);

    expect(result).toContain("rendered requirement-definition prompt exceeds");
    expect(harness.controller.currentState.requirementSourceRefs).toEqual([]);
  });

  it("distinguishes an unapproved changed source from an explicitly adopted one", async () => {
    const { harness, workspace } = await setup(workspaces, "Implement the behavior specified by README.md.");
    await prepare(harness);
    await writeFile(join(workspace, "README.md"), "# Requirements\n\nUse stable ordering.\n");

    await sendAuditUserPrompt(harness, "Continue without adopting the changed README.md.", 200);
    const staleGate = await mutationGate(harness);
    expect(staleGate?.reason).toContain("changed after preparation");

    await sendAuditUserPrompt(harness, "Adopt the current changed README.md as the specification.", 300);
    const adoptionGate = await mutationGate(harness);
    expect(adoptionGate?.reason).toContain("authorized adopting changed contents of README.md");
    expect(adoptionGate?.reason).toContain("adopt_changed_paths");
  });
});

async function setup(
  workspaces: string[],
  prompt: string,
  declareTask = true,
  content = "# Requirements\n\nPreserve deterministic output.\n",
): Promise<{ harness: RequirementAuditHarness; workspace: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-source-preparation-"));
  workspaces.push(workspace);
  await writeFile(join(workspace, "README.md"), content);
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["add", "README.md"], { cwd: workspace });
  const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
  await sendAuditUserPrompt(harness, prompt, 100);
  if (declareTask) {
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement the referenced specification",
    });
  }
  return { harness, workspace };
}

async function prepare(harness: RequirementAuditHarness): Promise<string> {
  return callRequirementAudit(harness.controller, {
    action: "prepare_definition",
    selected_paths: ["README.md"],
    ignored_paths: [],
  });
}

async function mutationGate(harness: RequirementAuditHarness) {
  return beforeAuditTool(harness.agent, "edit", {
    path: "src/index.ts",
    edits: [{ oldText: "old", newText: "new" }],
  });
}
