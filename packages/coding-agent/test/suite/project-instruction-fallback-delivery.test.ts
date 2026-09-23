import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AssistantMessage, type Context, fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInstructionCompiler } from "../../src/core/project-instructions/index.ts";
import { createSessionProjectInstructionController } from "../../src/core/project-instructions/session-controller.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "../project-instruction-delivery-fixture.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const LEGACY_SENTINEL = "LEGACY_FALLBACK_SENTINEL";
const SENTINEL_SECTION = `## Release notes\n\nKeep ${LEGACY_SENTINEL} release notes verbatim.\n`;
const SECURITY_RULE = "Always protect credentials before edits.";
const FALLBACK_BLOCK_TEXT = /Do not mutate|restart in legacy|mode legacy before mutating|project_rule_routes/u;

type ProjectInstructionWorkspace = ReturnType<typeof createProjectInstructionModeWorkspace>;
type ProviderView = { systemPrompt: string; messagesText: string };

/** A compiler whose provider endpoint can go down and come back, like a local compiler model server. */
function switchableCompiler(workspace: ProjectInstructionWorkspace, endpoint: { up: boolean }) {
  return vi.fn<ProjectInstructionCompiler>(async (request) => {
    if (!endpoint.up) throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
    return workspace.compiler(request);
  });
}

/** Supplemental rule sources are re-read on every refresh, so this changes the compiler input hash. */
function writeSupplementalRule(workspace: ProjectInstructionWorkspace, text: string): void {
  mkdirSync(join(workspace.root, ".pdev", "rules"), { recursive: true });
  writeFileSync(join(workspace.root, ".pdev", "rules", "late.md"), `## Late rule\n\n${text}\n`);
}

function recordProviderView(views: ProviderView[], response: AssistantMessage | (() => AssistantMessage)) {
  return (context: Context): AssistantMessage => {
    const messagesText = context.messages.map((message) => getMessageText(message)).join("\n");
    views.push({ systemPrompt: context.systemPrompt ?? "", messagesText });
    return typeof response === "function" ? response() : response;
  };
}

function writeCall(path: string, content: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall("write", { path, content })], { stopReason: "toolUse" });
}

function toolResults(harness: Harness): Array<{ toolName: string; isError: boolean; text: string }> {
  return harness.session.messages.flatMap((message) =>
    message.role === "toolResult"
      ? [{ toolName: message.toolName, isError: message.isError, text: getMessageText(message) }]
      : [],
  );
}

function fallbackNotices(harness: Harness): string[] {
  return harness.events.flatMap((event) => (event.type === "project_instructions_fallback" ? [event.message] : []));
}

function restoredNotices(harness: Harness): string[] {
  return harness.eventsOfType("project_instructions_restored").map((event) => event.message);
}

const RESTORED_NOTICE = "Compiled project rules restored; read_rules gates apply again.";

describe("compiled project instructions degrade to legacy delivery when compilation is unavailable", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
    cleanupProjectInstructionModeWorkspaces();
  });

  async function createCompiledHarness(workspace: ProjectInstructionWorkspace, compiler?: ProjectInstructionCompiler) {
    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: compiler
        ? (context) => createSessionProjectInstructionController({ ...context, cwd: workspace.root, compiler })
        : undefined,
      completionMode: "implicit",
      models: [{ id: "faux-1" }, { id: "faux-2" }],
    });
    harnesses.push(harness);
    return harness;
  }

  async function promptForText(harness: Harness, text: string): Promise<ProviderView> {
    const views: ProviderView[] = [];
    harness.setResponses([recordProviderView(views, fauxAssistantMessage("ok"))]);
    await harness.session.prompt(text);
    return views[0]!;
  }

  it("injects AGENTS.md as legacy context and lets the session edit files when the compiler is unreachable", async () => {
    const workspace = createProjectInstructionModeWorkspace({ additionalInstructions: [SENTINEL_SECTION] });
    const compiler = switchableCompiler(workspace, { up: false });
    const harness = await createCompiledHarness(workspace, compiler);
    expect(harness.session._projectInstructions.state.current?.manifest.mode).toBe("fallback");
    const target = join(harness.tempDir, "auth.ts");
    const views: ProviderView[] = [];
    harness.setResponses([
      recordProviderView(views, writeCall(target, "export {};\n")),
      recordProviderView(views, fauxAssistantMessage("done")),
    ]);

    await harness.session.prompt("edit security credentials");

    expect(toolResults(harness)).toEqual([
      { toolName: "write", isError: false, text: expect.stringContaining("Successfully wrote") },
    ]);
    expect(readFileSync(target, "utf8")).toBe("export {};\n");
    expect(views).toHaveLength(2);
    for (const view of views) {
      expect(view.systemPrompt).toContain(`<project_instructions path="${workspace.agentsPath}">`);
      expect(view.systemPrompt).toContain(LEGACY_SENTINEL);
      expect(view.systemPrompt).not.toContain("<project_instructions agents_sha256=");
      // The legacy per-turn rule selection reaches the model as hidden turn context, not only the system prompt.
      expect(view.messagesText).toContain("<project_rules>");
      expect(view.messagesText).toContain(SECURITY_RULE);
      expect(`${view.systemPrompt}\n${view.messagesText}`).not.toMatch(FALLBACK_BLOCK_TEXT);
    }
    expect(fallbackNotices(harness)).toEqual([
      "Compiled project rules unavailable (project instruction compiler failed); using legacy AGENTS.md/CLAUDE.md instructions until a /reload compiles them.",
    ]);
    // Degraded turns do not retry the unreachable compiler inline before mutating tool calls.
    expect(compiler).toHaveBeenCalledOnce();
    await promptForText(harness, "anything else?");
    expect([fallbackNotices(harness).length, restoredNotices(harness)]).toEqual([1, []]);
  });

  it("keeps the compiled read_rules gate unchanged when compilation succeeds", async () => {
    const workspace = createProjectInstructionModeWorkspace({ additionalInstructions: [SENTINEL_SECTION] });
    const harness = await createCompiledHarness(workspace, workspace.compiler);
    const target = join(harness.tempDir, "auth.ts");
    const views: ProviderView[] = [];
    harness.setResponses([recordProviderView(views, writeCall(target, "export {};\n")), fauxAssistantMessage("x")]);

    await harness.session.prompt("edit security credentials");

    expect(toolResults(harness)).toEqual([
      { toolName: "write", isError: true, text: expect.stringContaining("Call read_rules") },
    ]);
    expect(existsSync(target)).toBe(false);
    expect(views[0]?.systemPrompt).toContain('mode="compiled"');
    expect(views[0]?.systemPrompt).not.toContain("<project_context>");
    expect(views[0]?.messagesText).toContain("<project_rule_routes");
    expect([...fallbackNotices(harness), ...restoredNotices(harness)]).toEqual([]);
  });

  it("resumes compiled gating and history filtering after a later reload compiles successfully", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const endpoint = { up: false };
    const harness = await createCompiledHarness(workspace, switchableCompiler(workspace, endpoint));
    const degradedTarget = join(harness.tempDir, "degraded.ts");
    harness.setResponses([writeCall(degradedTarget, "legacy\n"), fauxAssistantMessage("done")]);
    await harness.session.prompt("edit security credentials");
    expect(readFileSync(degradedTarget, "utf8")).toBe("legacy\n");

    endpoint.up = true;
    await harness.session.reload();
    expect(harness.session._projectInstructions.state.current?.manifest.mode).toBe("compiled");
    expect(harness.session.systemPrompt).toContain('mode="compiled"');
    expect(harness.session.systemPrompt).not.toContain("<project_context>");

    const compiledTarget = join(harness.tempDir, "auth.ts");
    const views: ProviderView[] = [];
    harness.setResponses([recordProviderView(views, writeCall(compiledTarget, "x\n")), fauxAssistantMessage("x")]);
    await harness.session.prompt("edit security credentials");

    expect(toolResults(harness).at(-1)).toMatchObject({ toolName: "write", isError: true });
    expect(toolResults(harness).at(-1)?.text).toContain("Call read_rules");
    expect(existsSync(compiledTarget)).toBe(false);
    expect(views[0]?.messagesText).toContain("<project_rule_routes");
    // The degraded turn's legacy <project_rules> block is removed from compiled-delivery history.
    expect(views[0]?.messagesText).not.toContain("<project_rules>");
    expect(fallbackNotices(harness)).toHaveLength(1);
    expect(restoredNotices(harness)).toEqual([RESTORED_NOTICE]);
  });

  it("announces each entry into fallback once, including after a reload that still cannot compile", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const endpoint = { up: true };
    const harness = await createCompiledHarness(workspace, switchableCompiler(workspace, endpoint));
    const noticeCounts: string[] = [];
    const recordNotices = () =>
      noticeCounts.push(`${fallbackNotices(harness).length}/${restoredNotices(harness).length}`);
    const reloadAndPrompt = async (text: string) => {
      await harness.session.reload();
      await promptForText(harness, text);
      recordNotices();
    };

    await promptForText(harness, "compiled start");
    recordNotices();
    endpoint.up = false;
    writeSupplementalRule(workspace, "Never skip the first late rule.");
    await reloadAndPrompt("first fallback");
    await promptForText(harness, "still first fallback");
    recordNotices();
    await reloadAndPrompt("reload still failing");
    endpoint.up = true;
    await reloadAndPrompt("recovered");
    endpoint.up = false;
    writeSupplementalRule(workspace, "Never skip the second late rule.");
    await reloadAndPrompt("second fallback");

    // fallback/restored notice counts: one per entry into fallback, re-announced after a failing reload.
    expect(noticeCounts).toEqual(["0/0", "1/0", "1/0", "2/0", "2/1", "3/1"]);
  });

  it("does not strand a compiled run when a mid-run refresh falls back, then recovers at a later turn", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const endpoint = { up: true };
    const harness = await createCompiledHarness(workspace, switchableCompiler(workspace, endpoint));
    const target = join(harness.tempDir, "auth.ts");
    const views: ProviderView[] = [];
    harness.setResponses([
      writeCall(target, "blocked\n"),
      () => {
        endpoint.up = false;
        writeSupplementalRule(workspace, `Always keep ${LEGACY_SENTINEL} credentials rotated.`);
        return writeCall(target, "mid-run\n");
      },
      () => {
        // Mid-run tool activation rebuilds the base prompt (now legacy) while the run keeps its compiled prompt.
        harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
        return fauxAssistantMessage([fauxToolCall("read", { path: target })], { stopReason: "toolUse" });
      },
      recordProviderView(views, fauxAssistantMessage("done")),
    ]);

    await harness.session.prompt("edit security credentials");

    // The first write stages the compiled batch; once sources change and cannot compile, compiled routes can never
    // be satisfied, so the next write proceeds instead of stranding the run behind an unreadable batch.
    expect(toolResults(harness).map((result) => [result.isError, result.text.slice(0, 16)])).toEqual([
      [true, "Call read_rules "],
      [false, "Successfully wro"],
      [false, "mid-run\n"],
    ]);
    expect(readFileSync(target, "utf8")).toBe("mid-run\n");
    // Model-visible history keeps the run's compiled context until the next user turn applies the new delivery.
    expect(views[0]?.messagesText).toContain("<project_rule_routes");
    expect(fallbackNotices(harness)).toEqual([]);

    const degraded = await promptForText(harness, "rotate credentials again");
    expect(degraded.systemPrompt).toContain("<project_context>");
    expect(degraded.systemPrompt).not.toContain("<project_instructions agents_sha256=");
    expect(degraded.messagesText).toContain(`Always keep ${LEGACY_SENTINEL} credentials rotated.`);
    expect(degraded.messagesText).not.toContain("<project_rule_routes");
    expect(fallbackNotices(harness)).toHaveLength(1);

    // A same-identity model switch recompiles without changing the input hash or rebuilding the prompt; the next
    // user turn applies compiled delivery with a fresh gate instead of the stale pre-fallback batch.
    endpoint.up = true;
    const fallbackInputHash = harness.session._projectInstructions.state.current?.manifest.inputHash;
    await harness.session.setModel(harness.getModel("faux-2")!);
    const recovered = harness.session._projectInstructions.state.current?.manifest;
    expect([recovered?.mode, recovered?.inputHash]).toEqual(["compiled", fallbackInputHash]);
    expect(harness.session.systemPrompt).toContain("<project_context>");
    const gated: ProviderView[] = [];
    const compiledTarget = join(harness.tempDir, "keys.ts");
    harness.setResponses([recordProviderView(gated, writeCall(compiledTarget, "x\n")), fauxAssistantMessage("x")]);
    await harness.session.prompt("edit security credentials");
    expect(gated[0]?.systemPrompt).toContain('mode="compiled"');
    expect(gated[0]?.systemPrompt).not.toContain("<project_context>");
    expect(toolResults(harness).at(-1)?.text).toMatch(/^Call read_rules/u);
    expect(existsSync(compiledTarget)).toBe(false);
    expect(restoredNotices(harness)).toEqual([RESTORED_NOTICE]);
    endpoint.up = false;
    writeSupplementalRule(workspace, "Never skip the final late rule.");
    await harness.session.setModel(harness.getModel("faux-1")!);
    await promptForText(harness, "after the second outage");
    expect(fallbackNotices(harness)).toHaveLength(2);
  });

  it("announces the fallback without a diagnostic when an SDK session has no compiler at all", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const harness = await createCompiledHarness(workspace);
    const first = join(harness.tempDir, "first.txt");
    harness.setResponses([writeCall(first, "first\n"), fauxAssistantMessage("done")]);

    // The default SDK controller has no compiler; the pre-mutation refresh yields an "unavailable" fallback.
    await harness.session.prompt("create first.txt");
    expect(readFileSync(first, "utf8")).toBe("first\n");
    expect(harness.session._projectInstructions.state.current?.manifest).toMatchObject({
      mode: "fallback",
      compilerStatus: "unavailable",
    });

    const view = await promptForText(harness, "continue");
    expect(fallbackNotices(harness)).toEqual([
      "Compiled project rules unavailable; using legacy AGENTS.md/CLAUDE.md instructions until a /reload compiles them.",
    ]);
    expect(view.systemPrompt).toContain(`<project_instructions path="${workspace.agentsPath}">`);
  });
});
