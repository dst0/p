import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../../src/index.ts";
import {
  type AdaptiveHarness,
  createAdaptiveHarness,
  initGitRepository,
  tools,
  writeWorkspaceFile,
} from "./adaptive-verification-fixture.ts";

/**
 * The effect backstop must not depend on a bounded workspace snapshot: repositories with thousands of ignored
 * files (virtualenvs, caches) and edits outside the working directory still escalate code changes.
 */
const OVERSIZED = 5_200;
const extraRoots: string[] = [];

function fillIgnoredDirectory(root: string, directory: string): void {
  mkdirSync(join(root, directory), { recursive: true });
  for (let index = 0; index < OVERSIZED; index++) writeFileSync(join(root, directory, `f${index}.py`), "x = 1\n");
}

const workspaceWriter: ExtensionFactory = (p) => {
  p.registerTool({
    name: "remote_patch",
    label: "remote_patch",
    description: "Patch a file through an external editor service",
    promptSnippet: "remote_patch(path, content): patch a file",
    effect: { kind: "workspace_write", risk: "normal" },
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
      writeFileSync(join(context.cwd, params.path), params.content);
      return { content: [{ type: "text", text: `patched ${params.path}` }], details: {} };
    },
  });
};

describe("adaptive verification: backstop beyond bounded snapshots", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
    for (const root of extraRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function setup(ignoredDirectory?: string, options: Parameters<typeof createAdaptiveHarness>[0] = {}) {
    const adaptive = await createAdaptiveHarness(options);
    harnesses.push(adaptive);
    const root = adaptive.harness.tempDir;
    writeWorkspaceFile(root, "src/a.js", "export const value = 1;\n");
    if (ignoredDirectory) {
      writeWorkspaceFile(root, ".gitignore", `${ignoredDirectory}/\n`);
      fillIgnoredDirectory(root, ignoredDirectory);
    }
    initGitRepository(root);
    return adaptive;
  }

  function status(adaptive: AdaptiveHarness) {
    return adaptive.harness.session.getVerificationTierStatus();
  }

  it("escalates an edit in a repository whose ignored .venv holds 5,200 files", async () => {
    const adaptive = await setup(".venv");
    adaptive.respond(
      tools(fauxToolCall("write", { path: "src/a.js", content: "export const value = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    expect(status(adaptive)).toMatchObject({ tier: "strict", reason: "effect_source", trigger: "src/a.js" });
    const state = adaptive.harness.session._taskVerificationRuntime?.controller.state;
    expect(state?.taskOwnedPaths).toEqual(["src/a.js"]);
    expect(state?.taskOwnedPathTrackingFailed ?? false).toBe(false);
  });

  it("escalates a shell edit of source even when the workspace snapshot is unbounded", async () => {
    const adaptive = await setup("bulk");
    adaptive.respond(
      tools(fauxToolCall("bash", { command: "perl -pi -e 's/value = 1/value = 2/' src/a.js" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited src/a.js." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    expect(readFileSync(join(adaptive.harness.tempDir, "src/a.js"), "utf8")).toContain("value = 2");
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.taskOwnedPathTrackingFailed).toBe(true);
    expect(status(adaptive)).toMatchObject({ tier: "strict", reason: "effect_source", trigger: "src/a.js" });
  });

  it("escalates conservatively when a detected shell mutation cannot be tracked to a path", async () => {
    const adaptive = await setup("bulk");
    adaptive.respond(
      tools(fauxToolCall("bash", { command: "echo note >> NOTES.md" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Appended a note." })),
    );

    await adaptive.harness.session.prompt("Look at NOTES.md.");

    expect(status(adaptive)).toMatchObject({ tier: "strict", reason: "effect_untracked", trigger: "bash" });
  });

  it("keeps a direct docs edit LIGHT because its exact path is known", async () => {
    const adaptive = await setup("bulk");
    adaptive.respond(
      tools(fauxToolCall("write", { path: "NOTES.md", content: "note\n" })),
      fauxAssistantMessage("Wrote NOTES.md."),
    );

    await adaptive.harness.session.prompt("Document the setup steps in NOTES.md");

    expect(status(adaptive)?.tier).toBe("light");
    expect(adaptive.requests).toHaveLength(2);
  });

  it("escalates an edit of source outside the working directory, such as a sibling worktree", async () => {
    const adaptive = await setup();
    const sibling = mkdtempSync(join(tmpdir(), "p-sibling-worktree-"));
    extraRoots.push(sibling);
    const target = join(sibling, "src", "b.ts");
    mkdirSync(join(sibling, "src"));
    adaptive.respond(
      tools(fauxToolCall("write", { path: target, content: "export const b = 2;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Edited the sibling worktree." })),
    );

    await adaptive.harness.session.prompt("Look at the sibling worktree.");

    expect(readFileSync(target, "utf8")).toContain("b = 2");
    expect(status(adaptive)).toMatchObject({ tier: "strict", reason: "effect_source" });
    expect(status(adaptive)?.trigger?.endsWith("/src/b.ts")).toBe(true);
  });

  it("observes an extension tool that declares a workspace write", async () => {
    const adaptive = await setup(undefined, { extensionFactories: [workspaceWriter] });
    adaptive.respond(
      tools(fauxToolCall("remote_patch", { path: "src/a.js", content: "export const value = 3;\n" })),
      tools(fauxToolCall("finish_work", { status: "partial", summary: "Patched src/a.js." })),
    );

    await adaptive.harness.session.prompt("Look at src/a.js.");

    expect(status(adaptive)).toMatchObject({ tier: "strict", reason: "effect_source", trigger: "src/a.js" });
    expect(adaptive.harness.session._taskVerificationRuntime?.controller.state.taskOwnedPaths).toEqual(["src/a.js"]);
  });
});
