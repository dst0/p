import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { isExplicitRequirementSourceDeauthorization } from "../src/core/task-verification/requirement-source-authority.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("referenced requirement-source authority lifecycle", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("preserves frozen sources when the model redeclares the task", async () => {
    const harness = await setup(workspaces, "Implement the behavior specified by README.md.");
    await prepare(harness, ["README.md"], []);
    const references = structuredClone(harness.controller.currentState.requirementSourceRefs);
    const texts = [...harness.controller.requirementSourceTexts.entries()];
    await nextModelTurn(harness);

    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement the behavior specified by README.md",
    });

    expect(harness.controller.currentState.requirementSourceRefs).toEqual(references);
    expect([...harness.controller.requirementSourceTexts.entries()]).toEqual(texts);
  });

  it("invalidates a stored ignore when a later prompt authorizes the same source", async () => {
    const harness = await setup(workspaces, "Implement the change; README.md is background only.");
    await prepare(harness, [], [{ path: "README.md", reason: "The user called it background only." }]);

    await sendAuditUserPrompt(harness, "Actually follow README.md as the authoritative specification.", 200);
    const gate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });

    expect(gate?.block).toBe(true);
    expect(gate?.reason).toContain("prepare_definition");
  });

  it("selects an authoritative source while ignoring an output-only path", async () => {
    const harness = await setup(
      workspaces,
      "Implement the behavior per README.md and write the summary to finish_notes.md.",
    );

    const result = await prepare(
      harness,
      ["README.md"],
      [{ path: "finish_notes.md", reason: "This is the requested output path." }],
    );

    expect(result).toMatch(/Prepared 1 .*immutable requirement-source snapshot/iu);
    expect(harness.controller.currentState.requirementSourceRefs?.map((reference) => reference.path)).toEqual([
      "README.md",
    ]);
  });

  it("does not confuse file preservation with source de-authorization", () => {
    expect(
      isExplicitRequirementSourceDeauthorization(
        "Do not modify README.md; implement the behavior described in README.md.",
        "README.md",
      ),
    ).toBe(false);
    expect(
      isExplicitRequirementSourceDeauthorization("Stop using README.md as a requirement source.", "README.md"),
    ).toBe(true);
  });
});

async function setup(workspaces: string[], prompt: string): Promise<RequirementAuditHarness> {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-source-authority-"));
  workspaces.push(workspace);
  await writeFile(join(workspace, "README.md"), "# Requirements\n\nPreserve deterministic output.\n");
  git(workspace, "init", "-q");
  git(workspace, "add", "README.md");
  const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
  await sendAuditUserPrompt(harness, prompt, 100);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: prompt,
  });
  return harness;
}

async function prepare(
  harness: RequirementAuditHarness,
  selectedPaths: string[],
  ignoredPaths: Array<{ path: string; reason: string }>,
): Promise<string> {
  return callRequirementAudit(harness.controller, {
    action: "prepare_definition",
    selected_paths: selectedPaths,
    ignored_paths: ignoredPaths,
  });
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
