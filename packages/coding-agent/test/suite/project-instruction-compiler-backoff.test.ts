import { type AssistantMessage, type Context, fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_INSTRUCTION_COMPILER_SYSTEM_PROMPT } from "../../src/core/project-instructions/model-compiler-prompt.ts";
import { createSessionProjectInstructionController } from "../../src/core/project-instructions/session-controller.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "../project-instruction-delivery-fixture.ts";
import { createHarness, type Harness } from "./harness.ts";

/** Documented default: a failed compile for one compiler identity is reused for five minutes. */
const DOCUMENTED_BACKOFF_MS = 5 * 60_000;

type ProviderCall = "compiler" | "task";

/** Scripted provider response that records whether the production model compiler or the task turn called it. */
function providerStep(calls: ProviderCall[], response: AssistantMessage) {
  return (context: Context): AssistantMessage => {
    calls.push(context.systemPrompt === PROJECT_INSTRUCTION_COMPILER_SYSTEM_PROMPT ? "compiler" : "task");
    return response;
  };
}

/** Every provider request, including an unscripted one that would find an empty queue, must be a recorded call. */
function expectProviderCalls(harness: Harness, calls: ProviderCall[], expected: ProviderCall[]): void {
  expect(calls).toEqual(expected);
  expect(harness.faux.state.callCount).toBe(expected.length);
}

const unreachableCompilerEndpoint = () =>
  fauxAssistantMessage("", { stopReason: "error", errorMessage: "connect ECONNREFUSED 127.0.0.1:8080" });
const validCompilerEnvelope = () => fauxAssistantMessage('{"alwaysOn":[]}');

describe("project instruction compiler failure backoff with the default model compiler", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
    cleanupProjectInstructionModeWorkspaces();
  });

  /** No custom compiler: the session uses the production model compiler and its default backoff. */
  async function createDefaultCompilerHarness(calls: ProviderCall[]): Promise<Harness> {
    const workspace = createProjectInstructionModeWorkspace();
    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      completionMode: "implicit",
      projectInstructions: (context) => {
        context.faux.setResponses([providerStep(calls, unreachableCompilerEndpoint())]);
        return createSessionProjectInstructionController({ ...context, cwd: workspace.root });
      },
    });
    harnesses.push(harness);
    return harness;
  }

  it("skips the compiler on automatic refreshes inside the backoff while /reload makes a real attempt", async () => {
    const calls: ProviderCall[] = [];
    const harness = await createDefaultCompilerHarness(calls);
    const controller = harness.session._projectInstructions;
    expectProviderCalls(harness, calls, ["compiler"]);
    expect(controller.state.current?.manifest).toMatchObject({
      mode: "fallback",
      compilerDiagnostic: "project instruction compiler provider call failed",
    });

    // Automatic refreshes (tool hooks, model switches, resource discovery) reuse the cached failure.
    await controller.refresh();
    expectProviderCalls(harness, calls, ["compiler"]);

    // An explicit reload inside the same window is the user's retry and reaches the compiler endpoint.
    harness.setResponses([providerStep(calls, unreachableCompilerEndpoint())]);
    await harness.session.reload();
    expectProviderCalls(harness, calls, ["compiler", "compiler"]);
    expect(controller.state.current?.manifest.mode).toBe("fallback");

    // The failed reload restarts the window for automatic refreshes, which retry only after it expires.
    const failedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(failedAt + DOCUMENTED_BACKOFF_MS - 10_000);
    await controller.refresh();
    expectProviderCalls(harness, calls, ["compiler", "compiler"]);
    vi.spyOn(Date, "now").mockReturnValue(failedAt + DOCUMENTED_BACKOFF_MS + 10_000);
    harness.setResponses([providerStep(calls, validCompilerEnvelope())]);
    await controller.refresh();
    expectProviderCalls(harness, calls, ["compiler", "compiler", "compiler"]);
    expect(controller.state.current?.manifest.mode).toBe("compiled");
  });

  it("recovers compiled delivery through /reload inside the backoff and announces the restore once", async () => {
    const calls: ProviderCall[] = [];
    const harness = await createDefaultCompilerHarness(calls);
    const notices = () =>
      harness.events.flatMap((event) => (event.type.startsWith("project_instructions_") ? [event.type] : []));
    harness.setResponses([providerStep(calls, fauxAssistantMessage("degraded"))]);
    await harness.session.prompt("inspect the project");
    expect(notices()).toEqual(["project_instructions_fallback"]);

    harness.setResponses([providerStep(calls, validCompilerEnvelope())]);
    await harness.session.reload();
    expectProviderCalls(harness, calls, ["compiler", "task", "compiler"]);
    expect(harness.session._projectInstructions.state.current?.manifest.mode).toBe("compiled");

    const systemPrompts: string[] = [];
    const recordTask = (context: Context) => {
      systemPrompts.push(context.systemPrompt ?? "");
      return providerStep(calls, fauxAssistantMessage("compiled"))(context);
    };
    harness.setResponses([recordTask, recordTask]);
    await harness.session.prompt("edit security credentials");
    await harness.session.prompt("continue");

    expect(harness.eventsOfType("project_instructions_restored").map((event) => event.message)).toEqual([
      "Compiled project rules restored; read_rules gates apply again.",
    ]);
    expect(notices()).toEqual(["project_instructions_fallback", "project_instructions_restored"]);
    expect(systemPrompts.map((prompt) => prompt.includes('mode="compiled"'))).toEqual([true, true]);
    expectProviderCalls(harness, calls, ["compiler", "task", "compiler", "task", "task"]);
  });
});
