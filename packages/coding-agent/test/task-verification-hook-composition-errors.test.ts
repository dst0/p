import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import { callTaskVerification } from "./task-requirement-audit-test-harness.ts";

describe("task verification hook composition errors", () => {
  it("releases test mutation reservations when an earlier before hook throws", async () => {
    const priorError = new Error("prior hook failed");
    const controller = createTaskVerificationController(SessionManager.inMemory());
    let reservationObserved = false;
    const agent = new Agent();
    agent.beforeToolCall = async () => {
      reservationObserved = controller.testMutationReservations.has("edit-throw");
      throw priorError;
    };
    controller.install(agent);
    await prepareTestEdit(controller);

    await expect(agent.beforeToolCall?.(beforeContext("edit-throw"), new AbortController().signal)).rejects.toBe(
      priorError,
    );
    expect(reservationObserved).toBe(true);
    expect(controller.testMutationReservations.has("edit-throw")).toBe(false);
  });

  it("releases test mutation reservations when an earlier before hook blocks", async () => {
    const controller = createTaskVerificationController(SessionManager.inMemory());
    let reservationObserved = false;
    const agent = new Agent();
    agent.beforeToolCall = async () => {
      reservationObserved = controller.testMutationReservations.has("edit-block");
      return { block: true, reason: "blocked by prior hook" };
    };
    controller.install(agent);
    await prepareTestEdit(controller);

    await expect(agent.beforeToolCall?.(beforeContext("edit-block"), new AbortController().signal)).resolves.toEqual({
      block: true,
      reason: "blocked by prior hook",
    });
    expect(reservationObserved).toBe(true);
    expect(controller.testMutationReservations.has("edit-block")).toBe(false);
  });

  it("preserves an earlier after-hook error when controller settlement succeeds", async () => {
    const priorError = new Error("prior result hook failed");
    const agent = new Agent();
    agent.afterToolCall = async () => {
      throw priorError;
    };
    const controller = createTaskVerificationController(SessionManager.inMemory());
    controller.install(agent);

    await expect(agent.afterToolCall?.(afterContext(), new AbortController().signal)).rejects.toBe(priorError);
    expect(priorError.cause).toBeUndefined();
  });

  it("preserves the earlier after-hook error and attaches the controller error as its cause", async () => {
    const priorError = new Error("prior result hook failed");
    const controllerError = new Error("verification settlement failed");
    const agent = new Agent();
    agent.afterToolCall = async () => {
      throw priorError;
    };
    const controller = createTaskVerificationController(SessionManager.inMemory());
    controller.afterToolCall = async () => {
      throw controllerError;
    };
    controller.install(agent);

    await expect(agent.afterToolCall?.(afterContext(), new AbortController().signal)).rejects.toBe(priorError);
    expect(priorError.cause).toBe(controllerError);
  });
});

function beforeContext(id: string) {
  const args = { edits: [{ newText: "new", oldText: "old" }], path: "test/parser.test.ts" };
  return {
    assistantMessage: {} as never,
    args,
    context: {} as never,
    toolCall: { arguments: args, id, name: "edit", type: "toolCall" as const },
  };
}

async function prepareTestEdit(controller: TaskVerificationController): Promise<void> {
  await callTaskVerification(controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Exercise hook composition across test edits",
  });
}

function afterContext() {
  return {
    args: { path: "README.md" },
    assistantMessage: {} as never,
    context: {} as never,
    isError: false,
    result: { content: [{ text: "read", type: "text" as const }], details: undefined },
    toolCall: { arguments: { path: "README.md" }, id: "read-after", name: "read", type: "toolCall" as const },
  };
}
