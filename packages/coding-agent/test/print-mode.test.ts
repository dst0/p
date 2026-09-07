import { afterEach, describe, expect, it, vi } from "vitest";
import { getTextModeFinalOutput, runPrintMode } from "../src/modes/print-mode.ts";
import {
  captureStdout,
  createAssistantMessage,
  createFinishWorkResult,
  createProviderLengthContinuationMessage,
  createRuntimeHost,
  createToolResult,
} from "./print-mode-test-support.ts";
import { createVerifiedCompletionResult } from "./terminal-completion-test-support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runPrintMode", () => {
  it("uses finish_work result as text-mode final output", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "ignored" }),
      createFinishWorkResult({ status: "success", summary: "summary", result: "result text" }),
    ]);

    expect(output).toEqual({ text: "summary", exitCode: 0 });
  });

  it("falls back to finish_work summary and returns non-zero for failed status", () => {
    const output = getTextModeFinalOutput([
      createFinishWorkResult({ status: "failed", summary: "blocked by missing dependency" }),
    ]);

    expect(output).toEqual({ text: "blocked by missing dependency", exitCode: 1 });
  });

  it("uses the reserved verified audit marker instead of arbitrary tool-result text", () => {
    const output = getTextModeFinalOutput([createVerifiedCompletionResult("Verified final summary")]);

    expect(output).toEqual({ text: "Verified final summary", exitCode: 0 });
  });

  it("does not let a stale verified marker hide a later terminal error", () => {
    const output = getTextModeFinalOutput([
      createVerifiedCompletionResult("stale success"),
      createAssistantMessage({ stopReason: "error", errorMessage: "later provider failure" }),
    ]);

    expect(output).toEqual({ error: "later provider failure", exitCode: 1 });
  });

  it("concatenates every assistant segment in a length-continued response exactly once", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "segment one, ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ text: "segment two, ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ text: "and tail" }),
    ]);

    expect(output).toEqual({ text: "segment one, segment two, and tail", exitCode: 0 });
  });

  it("prints the complete agent_end response when compacted session state has lost early segments", async () => {
    const response = [
      createAssistantMessage({ text: "early ", stopReason: "length" }),
      createAssistantMessage({ text: "middle ", stopReason: "length" }),
      createAssistantMessage({ text: "tail" }),
    ];
    const runtimeHost = createRuntimeHost(response[2]!, {
      stateMessages: [response[2]!],
      promptAgentEnds: [response],
    });
    const stdout = captureStdout();

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Produce a long response",
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe("early middle tail\n");
  });

  it("prints only the latest agent_end response after multiple prompts", async () => {
    const firstResponse = [createAssistantMessage({ text: "first response" })];
    const secondResponse = [
      createAssistantMessage({ text: "second ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ text: "response" }),
    ];
    const runtimeHost = createRuntimeHost(secondResponse[2]!, {
      stateMessages: [...firstResponse, secondResponse[2]!],
      promptAgentEnds: [firstResponse, secondResponse],
    });
    const stdout = captureStdout();

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "First prompt",
      messages: ["Second prompt"],
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe("second response\n");
  });

  it("prints useful partial text and reports a following terminal error", async () => {
    const response = [
      createAssistantMessage({ text: "useful partial ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ stopReason: "error", errorMessage: "provider failed after continuation" }),
    ];
    const runtimeHost = createRuntimeHost(response[2]!, {
      stateMessages: [response[2]!],
      promptAgentEnds: [response],
    });
    const stdout = captureStdout();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Produce a long response",
    });

    expect(exitCode).toBe(1);
    expect(stdout.text()).toBe("useful partial \n");
    expect(errorSpy).toHaveBeenCalledWith("provider failed after continuation");
  });

  it("preserves every public marker-free length segment before a terminal error", () => {
    const diagnostic = "provider failed after public continuation";
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "first partial ", stopReason: "length" }),
      createAssistantMessage({ text: "second partial ", stopReason: "length" }),
      createAssistantMessage({ text: diagnostic, stopReason: "error", errorMessage: diagnostic }),
    ]);

    expect(output).toEqual({
      text: "first partial second partial ",
      error: diagnostic,
      exitCode: 1,
    });
  });

  it("prints useful partial text and reports a following terminal abort", async () => {
    const response = [
      createAssistantMessage({ text: "useful before abort ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ stopReason: "aborted", errorMessage: "request cancelled" }),
    ];
    const runtimeHost = createRuntimeHost(response[2]!, {
      promptAgentEnds: [response],
    });
    const stdout = captureStdout();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Produce a long response",
    });

    expect(exitCode).toBe(1);
    expect(stdout.text()).toBe("useful before abort \n");
    expect(errorSpy).toHaveBeenCalledWith("request cancelled");
  });

  it("keeps last-assistant-only fallback when no agent_end response was captured", async () => {
    const earlier = createAssistantMessage({ text: "earlier response" });
    const latest = createAssistantMessage({ text: "latest response" });
    const runtimeHost = createRuntimeHost(latest, { stateMessages: [earlier, latest] });
    const stdout = captureStdout();

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe("latest response\n");
  });

  it("does not duplicate a synthetic terminal diagnostic after useful partial text", async () => {
    const response = [
      createAssistantMessage({ text: "useful partial ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({
        text: "provider failed after continuation",
        stopReason: "error",
        errorMessage: "provider failed after continuation",
      }),
    ];
    const runtimeHost = createRuntimeHost(response[2]!, {
      promptAgentEnds: [response],
    });
    const stdout = captureStdout();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Produce a long response",
    });

    expect(exitCode).toBe(1);
    expect(stdout.text()).toBe("useful partial \n");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("provider failed after continuation");
  });

  it("excludes commentary from normal tool turns before the final length-continuation chain", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({
        text: "Inspecting first. ",
        stopReason: "toolUse",
        toolCall: { id: "tool-1", name: "read", arguments: { path: "README.md" } },
      }),
      createToolResult(),
      createAssistantMessage({ text: "continued segment ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ text: "and final tail" }),
    ]);

    expect(output).toEqual({ text: "continued segment and final tail", exitCode: 0 });
  });

  it("keeps ordinary tool-run output scoped to the final assistant response", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({
        text: "Inspecting first. ",
        stopReason: "toolUse",
        toolCall: { id: "tool-1", name: "read", arguments: { path: "README.md" } },
      }),
      createToolResult(),
      createAssistantMessage({ text: "Done" }),
    ]);

    expect(output).toEqual({ text: "Done", exitCode: 0 });
  });

  it("stops a length chain when a continued response executes a tool", () => {
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "Inspecting before the tool. ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({
        stopReason: "toolUse",
        toolCall: { id: "tool-1", name: "read", arguments: { path: "README.md" } },
      }),
      createToolResult(),
      createAssistantMessage({ text: "Done" }),
    ]);

    expect(output).toEqual({ text: "Done", exitCode: 0 });
  });

  it("preserves adjacent length output before a terminal exhaustion error", () => {
    const diagnostic = "provider length continuation exhausted";
    const output = getTextModeFinalOutput([
      createAssistantMessage({ text: "first segment ", stopReason: "length" }),
      createProviderLengthContinuationMessage(),
      createAssistantMessage({ text: "last partial segment", stopReason: "length" }),
      createAssistantMessage({ text: diagnostic, stopReason: "error", errorMessage: diagnostic }),
    ]);

    expect(output).toEqual({
      text: "first segment last partial segment",
      error: diagnostic,
      exitCode: 1,
    });
  });

  it("uses the final successful agent_end after a retryable intermediate error", async () => {
    const intermediateError = createAssistantMessage({
      stopReason: "error",
      errorMessage: "temporary provider failure",
    });
    const finalResponse = createAssistantMessage({ text: "recovered response" });
    const runtimeHost = createRuntimeHost(finalResponse, {
      promptAgentEndBatches: [
        [
          { type: "agent_end", messages: [intermediateError], willRetry: true },
          { type: "agent_end", messages: [finalResponse], willRetry: false },
        ],
      ],
    });
    const stdout = captureStdout();

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Retry if needed",
    });

    expect(exitCode).toBe(0);
    expect(stdout.text()).toBe("recovered response\n");
  });
});
