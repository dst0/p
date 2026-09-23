import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { initGitRepository, writeWorkspaceFile } from "./adaptive-verification-fixture.ts";
import { createHarness, type Harness } from "./harness.ts";

const BUGGY_MATH_TS = ["export function sub(a: number, b: number): number {", "  return a + b;", "}", ""].join("\n");

describe("record_task_verification: source_output_paths for a non-authoritative path", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("completes the fix without asking the user for source-output authorization", async () => {
    let providerCalls = 0;
    const harness = await createHarness({ taskVerificationMode: "evidence" });
    harnesses.push(harness);
    writeWorkspaceFile(harness.tempDir, "src/math.ts", BUGGY_MATH_TS);
    initGitRepository(harness.tempDir);

    harness.setResponses([
      () => {
        providerCalls++;
        // src/math.ts was never selected as an authoritative requirement source; the model
        // nonetheless declares it as a source output. This must not be gated behind explicit
        // user authorization, and the checklist must still be recorded.
        return fauxAssistantMessage(
          fauxToolCall("record_task_verification", {
            action: "record_completion_checklist",
            completion_checklist: ["sub(a, b) returns a minus b"],
            source_output_paths: ["src/math.ts"],
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("edit", {
            path: "src/math.ts",
            edits: [{ oldText: "  return a + b;", newText: "  return a - b;" }],
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("bash", {
            command:
              "node -e \"const fs=require('fs');const t=fs.readFileSync('src/math.ts','utf8');if(!t.includes('return a - b;'))process.exit(1);console.log('verified')\"",
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("record_task_verification", {
            action: "ready_to_finish",
            unresolved_failures: [],
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("finish_work", {
            status: "success",
            summary: "Fixed sub to subtract instead of add.",
            files_changed: ["src/math.ts"],
          }),
          { stopReason: "toolUse" },
        );
      },
    ]);

    await harness.session.prompt("Fix the bug in sub (it adds instead of subtracting).");

    const toolEnds = harness.eventsOfType("tool_execution_end");
    const checklistEnd = toolEnds.find((event) => event.toolName === "record_task_verification");
    expect(checklistEnd?.isError).toBe(false);
    const checklistText = JSON.stringify(checklistEnd?.result);
    expect(checklistText).not.toContain("requires explicit user authorization");
    expect(checklistText).not.toContain("[source-output:");
    expect(checklistText).toContain("Completion checklist recorded");

    expect(toolEnds.some((event) => event.toolName === "ask_user")).toBe(false);
    expect(harness.eventsOfType("agent_end")).toHaveLength(1);
    expect(
      harness.eventsOfType("completion_protocol").some((event) => event.event === "missing_finish_work_retry"),
    ).toBe(false);
    expect(providerCalls).toBe(5);
    expect(harness.getPendingResponseCount()).toBe(0);
  });
});
