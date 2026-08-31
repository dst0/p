import type { AgentMessage } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { getTaskVerificationCompletionPayload } from "../src/core/task-verification/verified-completion.ts";
import { createVerifiedCompletionResult } from "./terminal-completion-test-support.ts";

describe("task-verification completion payload trust", () => {
  it("requires an explicit native non-error result", () => {
    const valid = createVerifiedCompletionResult("Verified summary");
    const omitted = { ...valid } as AgentMessage & { isError?: boolean };
    delete omitted.isError;
    const nullFlag = { ...valid, isError: null } as unknown as AgentMessage;

    expect(getTaskVerificationCompletionPayload([valid])?.summary).toBe("Verified summary");
    expect(getTaskVerificationCompletionPayload([omitted])).toBeUndefined();
    expect(getTaskVerificationCompletionPayload([nullFlag])).toBeUndefined();
    expect(getTaskVerificationCompletionPayload([{ ...valid, isError: true }])).toBeUndefined();
  });

  it("accepts only a terminal current marker", () => {
    const marker = createVerifiedCompletionResult("stale");
    const laterMessage: AgentMessage = { role: "user", content: "later", timestamp: Date.now() };

    expect(getTaskVerificationCompletionPayload([marker, laterMessage])).toBeUndefined();
    expect(
      getTaskVerificationCompletionPayload([
        marker,
        createVerifiedCompletionResult("current", "record_task_verification"),
      ]),
    ).toBeUndefined();
  });
});
