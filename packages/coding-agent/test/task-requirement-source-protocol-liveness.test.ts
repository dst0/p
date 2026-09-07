import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  MAX_REQUIREMENT_SOURCE_BYTES,
  MAX_REQUIREMENT_SOURCE_CANDIDATES,
  prepareReferencedRequirementSources,
  referencedRequirementCandidateCatalog,
  referencedRequirementCandidates,
} from "../src/core/task-verification/referenced-requirement-sources.ts";
import {
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  type RequirementAuditHarness,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("referenced requirement-source protocol liveness", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("automatically declares a task before applying the preparation gate", async () => {
    const { harness } = await setup(workspaces, "Implement the behavior specified by README.md.");

    const gate = await beforeAuditTool(harness.agent, "edit", {
      path: "src/index.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });

    expect(harness.controller.currentState.taskKind).toBeDefined();
    expect(gate?.block).toBe(true);
    expect(gate?.reason).toContain("prepare_definition");
    expect(await prepare(harness, ["README.md"])).toMatch(/Prepared 1 .*immutable requirement-source snapshot/iu);
  });

  it("still requires the direct-prompt definition when every referenced candidate is ignored", async () => {
    const { harness } = await setup(workspaces, "Implement the change; README.md is background only.", true);

    const prepared = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: [],
      ignored_paths: [{ path: "README.md", reason: "The user identified this document as background only." }],
    });

    expect(prepared).toContain("no requirement source was selected");
    expect(prepared).toContain("Complete the requirement definition before implementation");
    expect(harness.controller.currentState.requirementSourceRefs).toEqual([]);
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/index.ts",
          edits: [{ oldText: "old", newText: "new" }],
        })
      )?.block,
    ).toBe(true);
  });

  it("rejects a model-authored ignore reason for an authoritative source", async () => {
    const { harness } = await setup(workspaces, "Implement the behavior specified by README.md.", true);

    const rejected = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: [],
      ignored_paths: [{ path: "README.md", reason: "This file is not relevant to the implementation." }],
    });

    expect(rejected).toMatch(/authoritative|direct user/iu);
    expect(harness.controller.currentState.requirementSourceRefs).toEqual([]);
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "src/index.ts",
          edits: [{ oldText: "old", newText: "new" }],
        })
      )?.block,
    ).toBe(true);
  });

  it("cannot discard a frozen source until the user explicitly de-authorizes it", async () => {
    const { harness } = await setup(workspaces, "Use notes.md as the implementation input.", true);
    await writeFile(join(harness.sessionManager.getCwd(), "notes.md"), "Preserve deterministic output.\n");
    git(harness.sessionManager.getCwd(), "add", "notes.md");
    await prepare(harness, ["notes.md"]);
    await nextModelTurn(harness);
    const frozenReferences = structuredClone(harness.controller.currentState.requirementSourceRefs);
    const frozenTexts = [...harness.controller.requirementSourceTexts.entries()];

    const rejected = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: [],
      ignored_paths: [{ path: "notes.md", reason: "No longer needed." }],
    });
    expect(rejected).toMatch(/direct user|de-authoriz/iu);
    expect(harness.controller.currentState.requirementSourceRefs).toEqual(frozenReferences);
    expect([...harness.controller.requirementSourceTexts.entries()]).toEqual(frozenTexts);

    await sendAuditUserPrompt(
      harness,
      "Stop using notes.md as a requirement source; it is no longer authoritative.",
      200,
    );
    const deauthorized = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: [],
      ignored_paths: [{ path: "notes.md", reason: "The user removed it from the requirement set." }],
    });
    expect(deauthorized).toContain("no requirement source was selected");
    expect(harness.controller.currentState.requirementSourceRefs).toEqual([]);
    expect([...harness.controller.requirementSourceTexts]).toEqual([]);
  });

  it("keeps an output-only path non-authoritative while requiring the direct-prompt definition", async () => {
    const { harness } = await setup(workspaces, "Implement the change and write the summary to finish_notes.md.", true);

    const prepared = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: [],
      ignored_paths: [{ path: "finish_notes.md", reason: "This is the requested output file." }],
    });

    expect(prepared).toContain("no requirement source was selected");
    expect(harness.controller.currentState.requirementSourceRefs).toEqual([]);
    expect(
      (
        await beforeAuditTool(harness.agent, "edit", {
          path: "finish_notes.md",
          edits: [{ oldText: "old", newText: "new" }],
        })
      )?.block,
    ).toBe(true);
  });

  it("preserves frozen snapshots across a later status clarification", async () => {
    const { harness } = await setup(workspaces, "Implement the behavior specified by README.md.", true);
    await prepare(harness, ["README.md"]);
    const frozenReferences = structuredClone(harness.controller.currentState.requirementSourceRefs);
    const frozenTexts = [...harness.controller.requirementSourceTexts.entries()];

    await sendAuditUserPrompt(
      harness,
      "Status clarification only: retain the existing frozen requirements and report current progress.",
      200,
    );

    expect(harness.controller.currentState.requirementSourceRefs).toEqual(frozenReferences);
    expect([...harness.controller.requirementSourceTexts.entries()]).toEqual(frozenTexts);
  });

  it("preserves reusable source order when selected paths are reordered", async () => {
    const { harness, workspace } = await setup(workspaces, "Implement README.md and SPEC.md requirements.", true);
    await writeFile(join(workspace, "SPEC.md"), "Preserve stable ordering.\n");
    git(workspace, "add", "SPEC.md");
    await prepare(harness, ["README.md", "SPEC.md"]);
    const original = harness.controller.currentState.requirementSourceRefs?.map((source) => source.path);
    await nextModelTurn(harness);
    await prepare(harness, ["SPEC.md", "README.md"]);
    expect(harness.controller.currentState.requirementSourceRefs?.map((source) => source.path)).toEqual(original);
  });

  it("requires explicit user confirmation before adopting changed source bytes", async () => {
    const { harness, workspace } = await setup(
      workspaces,
      "Implement the behavior specified by README.md.",
      true,
      "# Requirements\n\nPreserve deterministic output.\n",
    );
    await prepare(harness, ["README.md"]);
    const frozenReference = structuredClone(harness.controller.currentState.requirementSourceRefs?.[0]);
    const frozenText = [...harness.controller.requirementSourceTexts.values()][0];
    await writeFile(join(workspace, "README.md"), "# Requirements\n\nPreserve stable ordering.\n");

    await sendAuditUserPrompt(harness, "Continue, but do not adopt the changed README.md.", 200);
    const rejected = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
      adopt_changed_paths: ["README.md"],
    });
    expect(rejected).toMatch(/explicit|confirm/iu);
    expect(harness.controller.currentState.requirementSourceRefs?.[0]).toEqual(frozenReference);
    expect([...harness.controller.requirementSourceTexts.values()][0]).toBe(frozenText);

    await sendAuditUserPrompt(harness, "Adopt the changed README.md as the current specification.", 300);
    const adopted = await callRequirementAudit(harness.controller, {
      action: "prepare_definition",
      selected_paths: ["README.md"],
      ignored_paths: [],
      adopt_changed_paths: ["README.md"],
    });
    expect(adopted).toMatch(/Prepared 1 .*immutable requirement-source snapshot/iu);
    expect(harness.controller.currentState.requirementSourceRefs?.[0]?.sha256).not.toBe(frozenReference?.sha256);
    expect([...harness.controller.requirementSourceTexts.values()][0]).toContain("Preserve stable ordering");
  });

  it("restores a UTF-8 BOM snapshot with byte identity", async () => {
    const content = "\uFEFF# Requirements\n\nPreserve deterministic output.\n";
    const { harness } = await setup(workspaces, "Implement the behavior specified by README.md.", true, content);
    await prepare(harness, ["README.md"]);
    const reference = harness.controller.currentState.requirementSourceRefs?.[0];

    expect(reference?.byteLength).toBe(Buffer.byteLength(content));
    expect(reference?.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.restoreError).toBeUndefined();
    expect([...restored.controller.requirementSourceTexts.values()][0]).toBe(content);
  });

  it("rejects an oversized unreadable source from metadata before reading bytes", async () => {
    const content = "x".repeat(MAX_REQUIREMENT_SOURCE_BYTES + 1);
    const { harness, workspace } = await setup(
      workspaces,
      "Implement the behavior specified by README.md.",
      true,
      content,
    );
    const sourcePath = join(workspace, "README.md");
    await chmod(sourcePath, 0o000);
    let result: string;
    try {
      result = await prepare(harness, ["README.md"]);
    } finally {
      await chmod(sourcePath, 0o600);
    }

    expect(result).toContain(`exceeds the ${MAX_REQUIREMENT_SOURCE_BYTES}-byte requirement-source limit`);
    expect(result).not.toContain("Cannot inspect requirement source");
  });
});

describe("referenced requirement-source candidate extraction", () => {
  it("extracts explicit local document paths and excludes URL paths", () => {
    expect(
      referencedRequirementCandidates([
        {
          id: "user-1",
          text: "Reference https://example.test/REMOTE.md. LOCAL.md contains the acceptance criteria.",
        },
      ]),
    ).toEqual([{ path: "LOCAL.md", referencedByPromptIds: ["user-1"] }]);
  });

  it("bounds candidate extraction and reports overflow separately", () => {
    const paths = Array.from({ length: MAX_REQUIREMENT_SOURCE_CANDIDATES + 6 }, (_, index) => `spec-${index}.md`);
    const catalog = referencedRequirementCandidateCatalog([{ id: "user-1", text: paths.join(" ") }]);
    expect(catalog.overflow).toBe(true);
    expect(catalog.candidates).toHaveLength(MAX_REQUIREMENT_SOURCE_CANDIDATES);
    expect(catalog.candidates.map((candidate) => candidate.path)).toEqual(
      paths.slice(0, MAX_REQUIREMENT_SOURCE_CANDIDATES),
    );
    expect(prepareReferencedRequirementSources(".", [{ id: "user-1", text: paths.join(" ") }], [], [])).toContain(
      "More than 8 requirement-source candidates were referenced",
    );
  });
});
async function setup(
  workspaces: string[],
  prompt: string,
  declareTask = false,
  content = "# Requirements\n\nPreserve deterministic output.\n",
): Promise<{ harness: RequirementAuditHarness; workspace: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "p-requirement-source-liveness-"));
  workspaces.push(workspace);
  await writeFile(join(workspace, "README.md"), content);
  git(workspace, "init", "-q");
  git(workspace, "add", "README.md");
  const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
  await sendAuditUserPrompt(harness, prompt, 100);
  if (declareTask) {
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: prompt,
    });
  }
  return { harness, workspace };
}

async function prepare(harness: RequirementAuditHarness, selectedPaths: string[]): Promise<string> {
  return callRequirementAudit(harness.controller, {
    action: "prepare_definition",
    selected_paths: selectedPaths,
    ignored_paths: [],
  });
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
