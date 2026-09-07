import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { captureStdout, createAssistantMessage, createRuntimeHost } from "./print-mode-test-support.ts";

afterEach(() => vi.restoreAllMocks());

describe("noninteractive terminal failure status", () => {
  it.each(["error", "aborted"] as const)("returns failure in JSON mode for a terminal %s", async (stopReason) => {
    const message = createAssistantMessage({ stopReason, errorMessage: "budget_exhausted: Request limit reached" });
    const expectedMessage = structuredClone(message);
    const runtime = createRuntimeHost(message, { promptAgentEnds: [[message]] });
    const stdout = captureStdout();

    const code = await runPrintMode(runtime as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "json",
      initialMessage: "Continue validating the release artifact",
    });

    expect(code).toBe(1);
    expect(JSON.parse(stdout.text())).toEqual({ type: "agent_end", messages: [expectedMessage], willRetry: false });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("accepts a successful final response even when it consumed the final allowed request", async () => {
    const message = createAssistantMessage({ text: "The artifact matches the expected package metadata." });
    const runtime = createRuntimeHost(message, { promptAgentEnds: [[message]] });
    captureStdout();
    expect(
      await runPrintMode(runtime as unknown as Parameters<typeof runPrintMode>[0], {
        mode: "json",
        initialMessage: "Verify the final package metadata",
      }),
    ).toBe(0);
  });
});
