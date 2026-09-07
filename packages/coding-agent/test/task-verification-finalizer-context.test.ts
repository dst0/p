import type { BeforeToolCallContext } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { taskVerificationFinalizerBatchError } from "../src/core/task-verification/verified-completion-runtime.ts";

const runtime = { configuredMode: "audit" } as Parameters<typeof taskVerificationFinalizerBatchError>[0];

function context(name: string, args: Record<string, unknown>): BeforeToolCallContext {
  return {
    assistantMessage: {} as BeforeToolCallContext["assistantMessage"],
    toolCall: { type: "toolCall", id: `call-${name}`, name, arguments: args },
    args,
    context: {} as BeforeToolCallContext["context"],
  };
}

describe("task-verification finalizer batch context", () => {
  it("does not crash ordinary hook calls with a minimal legacy context", () => {
    expect(taskVerificationFinalizerBatchError(runtime, context("edit", { path: "src/file.ts" }))).toBeUndefined();
  });

  it("fails closed when a finalizer lacks its complete assistant turn", () => {
    expect(
      taskVerificationFinalizerBatchError(runtime, context("record_requirement_audit", { action: "verdict" })),
    ).toMatch(/complete assistant-turn context/u);
  });
});
