import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  auditContextError,
  definitionContextError,
} from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-context.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import { callTaskVerification } from "./task-requirement-audit-test-harness.ts";

describe("task verification audit context boundaries", () => {
  it("rejects baseline authorization before declaration, without paths, and for traversal paths", async () => {
    const controller = createTaskVerificationController(SessionManager.inMemory());

    await expect(
      callTaskVerification(controller, {
        action: "authorize_baseline_test",
        test_paths: ["test/parser.test.ts"],
      }),
    ).resolves.toContain("requires a declared task");
    await callTaskVerification(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Preserve selector and shell parsing boundaries",
    });
    await expect(
      callTaskVerification(controller, { action: "authorize_baseline_test", test_paths: [] }),
    ).resolves.toContain("requires test_paths");
    await expect(
      callTaskVerification(controller, {
        action: "authorize_baseline_test",
        test_paths: ["../test/parser.test.ts"],
      }),
    ).resolves.toContain("Only explicit repository-relative test files");
  });

  it("reports inactive audit and undeclared definition contexts precisely", () => {
    const controller = createTaskVerificationController(SessionManager.inMemory());

    expect(auditContextError(controller)).toContain("Requirement audit is not active");
    expect(definitionContextError(controller)).toBe("Declare the task before defining requirements.");
  });
});
