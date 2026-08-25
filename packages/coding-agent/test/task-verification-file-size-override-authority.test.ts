import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { userFileSizeOverrideIsAuthorized } from "../src/core/task-verification/user-file-size-override.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  callTaskVerification,
  createRequirementAuditHarness,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

async function declaredHarness(userPrompt: string) {
  const sessionManager = SessionManager.inMemory();
  const harness = createRequirementAuditHarness(sessionManager);
  await sendAuditUserPrompt(harness, userPrompt, 1);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "docs",
    task_summary: "Generate source while respecting user authority",
  });
  return { harness, sessionManager };
}

describe("task verification file-size override authority", () => {
  it("does not treat a negated override as authorization after restore", async () => {
    const { sessionManager } = await declaredHarness("Do not ignore the file-size limit.");
    const restored = createTaskVerificationController(sessionManager);

    expect(userFileSizeOverrideIsAuthorized(restored.state, restored.latestUserPrompt)).toBe(false);
  });

  it("lets a later user revocation supersede an earlier grant after restore", async () => {
    const { harness, sessionManager } = await declaredHarness("Explicitly ignore the file-size limit.");
    await sendAuditUserPrompt(harness, "Revoke the file-size override and enforce the normal limit.", 2);
    const restored = createTaskVerificationController(sessionManager);

    expect(userFileSizeOverrideIsAuthorized(restored.state, restored.latestUserPrompt)).toBe(false);
  });

  it("lets a later explicit grant supersede an earlier revocation", async () => {
    const { harness, sessionManager } = await declaredHarness("Enforce the normal file-size limit.");
    await sendAuditUserPrompt(harness, "Explicitly ignore the file-size limit for this task.", 2);
    const restored = createTaskVerificationController(sessionManager);

    expect(userFileSizeOverrideIsAuthorized(restored.state, restored.latestUserPrompt)).toBe(true);
  });
});
