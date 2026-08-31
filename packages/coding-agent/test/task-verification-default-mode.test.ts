import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { TaskVerificationController } from "../src/core/task-verification.ts";

describe("task verification default mode", () => {
  it("defaults direct state construction to evidence mode", () => {
    expect(emptyState().mode).toBe("evidence");
  });

  it("defaults direct controller construction to evidence mode", () => {
    const controller = new TaskVerificationController(SessionManager.inMemory());

    expect(controller.mode).toBe("evidence");
    expect(controller.currentState.mode).toBe("evidence");
  });
});
