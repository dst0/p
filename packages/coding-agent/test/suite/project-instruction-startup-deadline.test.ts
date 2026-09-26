import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectInstructionCompiler } from "../../src/core/project-instructions/index.ts";
import { createSessionProjectInstructionController } from "../../src/core/project-instructions/session-controller.ts";
import {
  cleanupProjectInstructionModeWorkspaces,
  createProjectInstructionModeWorkspace,
} from "../project-instruction-delivery-fixture.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("project instruction startup deadline and bounded cold compilation", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
    cleanupProjectInstructionModeWorkspaces();
  });

  it("aborts a pending cold compiler request when the startup deadline expires and safely falls back to legacy delivery with mutating action allowed", async () => {
    const workspace = createProjectInstructionModeWorkspace({
      additionalInstructions: ["## Custom section\n\nEnsure custom section is preserved verbatim.\n"],
    });

    let observedSignal: AbortSignal | undefined;
    let abortEventFired = false;
    let pendingRequestCleanedUp = false;

    const hangingCompiler: ProjectInstructionCompiler = vi.fn(
      async (_request, compileOptions?: { signal?: AbortSignal }) => {
        observedSignal = compileOptions?.signal;
        return new Promise<never>((_, reject) => {
          if (compileOptions?.signal?.aborted) {
            abortEventFired = true;
            pendingRequestCleanedUp = true;
            reject(compileOptions.signal.reason ?? new Error("Operation aborted"));
            return;
          }
          compileOptions?.signal?.addEventListener(
            "abort",
            () => {
              abortEventFired = true;
              pendingRequestCleanedUp = true;
              reject(compileOptions.signal?.reason ?? new Error("Operation aborted"));
            },
            { once: true },
          );
        });
      },
    );

    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: (context) =>
        createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: hangingCompiler,
          startupDeadlineSeconds: 0.1,
        }),
      completionMode: "implicit",
      models: [{ id: "faux-1" }],
    });
    harnesses.push(harness);

    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(abortEventFired).toBe(true);
    expect(pendingRequestCleanedUp).toBe(true);

    const manifest = harness.session._projectInstructions?.state.current?.manifest;
    expect(manifest?.mode).toBe("fallback");
    expect(manifest?.compilerStatus).toBe("failed");
    expect(manifest?.compilerDiagnostic).toBe("project instruction compiler provider call failed");

    // Mutation tool write must be permitted without read_rules error
    const targetFile = join(harness.tempDir, "output.txt");
    harness.setResponses([
      fauxAssistantMessage([fauxToolCall("write", { path: targetFile, content: "hello world" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);

    await harness.session.prompt("Create output file");

    expect(existsSync(targetFile)).toBe(true);
    expect(readFileSync(targetFile, "utf8")).toBe("hello world");

    const fallbackNotice = harness.events.find((event) => event.type === "project_instructions_fallback");
    expect(fallbackNotice).toBeDefined();
    expect(fallbackNotice?.message).toContain("Compiled project rules unavailable");
    expect(fallbackNotice?.message).toContain("project instruction compiler provider call failed");

    const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
    expect(toolResults.length).toBe(1);
    expect(toolResults[0]?.isError).toBe(false);

    expect(harness.session.agent.state.systemPrompt).toContain("Custom section");
  });

  it("preserves compiled mode on fast cold compilation within deadline", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const fastCompiler: ProjectInstructionCompiler = vi.fn(async (request) => workspace.compiler(request));

    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: (context) =>
        createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: fastCompiler,
          startupDeadlineSeconds: 1,
        }),
      completionMode: "implicit",
      models: [{ id: "faux-1" }],
    });
    harnesses.push(harness);

    expect(fastCompiler).toHaveBeenCalledTimes(1);
    const manifest = harness.session._projectInstructions?.state.current?.manifest;
    expect(manifest?.mode).toBe("compiled");
    expect(manifest?.compilerStatus).toBe("success");
    expect(manifest?.compilerDiagnostic).toBeUndefined();
  });

  it("preserves compiled mode on warm cached startup without calling compiler", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const compilerIdentity = "warm-cache-test-identity";
    const compilerSpy = vi.fn<ProjectInstructionCompiler>(async (request, options) =>
      workspace.compiler(request, options),
    );
    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: async (context) => {
        const warmupController = await createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: workspace.compiler,
          compilerIdentity,
        });
        expect(warmupController.state.current?.manifest.mode).toBe("compiled");
        return createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: compilerSpy,
          compilerIdentity,
          startupDeadlineSeconds: 0.1,
        });
      },
      completionMode: "implicit",
      models: [{ id: "faux-1" }],
    });
    harnesses.push(harness);

    expect(compilerSpy).not.toHaveBeenCalled();
    const manifest = harness.session._projectInstructions?.state.current?.manifest;
    expect(manifest?.mode).toBe("compiled");
    expect(manifest?.compilerStatus).toBe("success");
  });

  it("allows slow cold compilation to finish in compiled mode when deadline override is 0", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    const slowCompiler: ProjectInstructionCompiler = vi.fn(
      async (request, compileOptions?: { signal?: AbortSignal }) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 150);
          compileOptions?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
        return workspace.compiler(request);
      },
    );

    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: (context) =>
        createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: slowCompiler,
          startupDeadlineSeconds: 0,
        }),
      completionMode: "implicit",
      models: [{ id: "faux-1" }],
    });
    harnesses.push(harness);

    expect(slowCompiler).toHaveBeenCalledTimes(1);
    const manifest = harness.session._projectInstructions?.state.current?.manifest;
    expect(manifest?.mode).toBe("compiled");
    expect(manifest?.compilerStatus).toBe("success");
  });

  it("preserves full configured compiler timeout during explicit /reload refresh after fallback", async () => {
    const workspace = createProjectInstructionModeWorkspace();
    let shouldFail = true;

    const recoverableCompiler: ProjectInstructionCompiler = vi.fn(
      async (request, compileOptions?: { signal?: AbortSignal }) => {
        if (shouldFail) {
          return new Promise<never>((_, reject) => {
            compileOptions?.signal?.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        return workspace.compiler(request);
      },
    );

    const harness = await createHarness({
      tempRoot: workspace.root,
      resourceLoader: workspace.resourceLoader,
      projectInstructions: (context) =>
        createSessionProjectInstructionController({
          ...context,
          cwd: workspace.root,
          compiler: recoverableCompiler,
          startupDeadlineSeconds: 0.1,
        }),
      completionMode: "implicit",
      models: [{ id: "faux-1" }],
    });
    harnesses.push(harness);

    expect(harness.session._projectInstructions?.state.current?.manifest.mode).toBe("fallback");

    shouldFail = false;
    await harness.session._projectInstructions?.refresh({ retryFailedCompilation: true });

    expect(harness.session._projectInstructions?.state.current?.manifest.mode).toBe("compiled");
    expect(harness.session._projectInstructions?.state.current?.manifest.compilerStatus).toBe("success");
  });
});
