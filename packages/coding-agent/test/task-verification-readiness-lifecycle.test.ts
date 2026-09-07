import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("task-verification readiness lifecycle", () => {
  it("fails closed for each unavailable or unstable effect ledger", async () => {
    const harness = createWorkspaceHarness();
    await sendPrompt(harness, "Create result.txt containing the requested result.");
    await recordChecklist(harness, "result.txt contains the requested result line");
    expect(await ready(harness)).toContain("requires at least one successful effect");

    await recordWorkspaceEffect(harness);
    const stable = harness.controller.currentState;
    for (const [field, message] of [
      ["taskOwnedPathTrackingFailed", "could not identify the actual task-owned workspace paths"],
      ["effectTrackingFailed", "could not persist a metadata-only receipt"],
      ["taskOwnedPathOverflow", "workspace path ledger exceeded its bound"],
      ["externalEffectReceiptOverflow", "external-effect receipt ledger exceeded its bound"],
    ] as const) {
      harness.controller.state = { ...stable, [field]: true };
      expect(await ready(harness)).toContain(message);
    }

    harness.controller.state = {
      ...stable,
      taskOwnedPaths: [],
      taskOwnedPathBaselines: [],
    };
    expect(await ready(harness)).toContain("at least one recorded workspace or external effect");

    harness.controller.state = {
      ...stable,
      taskOwnedPaths: ["../outside.txt"],
      taskOwnedPathBaselines: [{ path: "../outside.txt", state: null }],
    };
    expect(await ready(harness)).toContain("could not hash the current task effect state");

    harness.controller.state = stable;
    harness.controller.activeMutationAttempts.add("in-flight-write");
    expect(await ready(harness)).toContain("workspace mutation calls are still in flight");
    harness.controller.activeMutationAttempts.clear();

    harness.controller.state = { ...stable, unverifiedTestPathOverflow: true };
    expect(await ready(harness)).toContain("Changed tests still need a direct successful broad test run");

    harness.controller.state = stable;
    expect(await ready(harness, ["known regression remains"])).toContain("cannot pass with unresolved_failures");
  });

  it("binds completion to the exact readiness token, effect hash, checklist, and latest verification", async () => {
    const harness = createWorkspaceHarness();
    await sendPrompt(harness, "Create result.txt containing the requested result.");
    await recordChecklist(harness, "result.txt contains the requested result line");
    await recordWorkspaceEffect(harness);
    await afterEvidenceTool(harness.agent, "read", { path: "result.txt" }, "requested result\n");

    expect(await ready(harness)).toContain("verification_token:");
    const completionReady = harness.controller.currentState;
    const token = completionReady.readiness?.token;
    expect(token).toBeTruthy();
    expect(harness.controller.completionGate("finish successfully", "wrong-token", ["result.txt"])?.reason).toContain(
      "exact verification_token",
    );
    expect(harness.controller.completionGate("finish successfully", token, ["other.txt"])?.reason).toContain(
      "files_changed must exactly match",
    );
    expect(harness.controller.completionGate("finish successfully", token, ["result.txt"])).toBeUndefined();

    harness.controller.state = {
      ...completionReady,
      taskOwnedPathBaselines: [{ path: "result.txt", state: "changed-after-readiness" }],
    };
    expect(harness.controller.publishGate("finish successfully")?.reason).toContain("task effect hash changed");
    expect(harness.controller.currentState.readiness?.status).toBe("pending");

    harness.controller.state = {
      ...completionReady,
      completionChecklist: {
        ...completionReady.completionChecklist!,
        criteria: ["result.txt contains a different requested result"],
      },
    };
    expect(harness.controller.publishGate("finish successfully")?.reason).toContain(
      "completion checklist changed after readiness",
    );

    harness.controller.state = completionReady;
    await afterEvidenceTool(
      harness.agent,
      "bash",
      { command: "npm test" },
      "Test Files 1 failed (1)\nTests 1 failed (1)",
      evidenceToolCall("bash", { command: "npm test" }),
      true,
    );
    expect(await ready(harness)).toContain(
      "ready_to_finish is blocked by verification commands whose latest execution still failed",
    );
    harness.controller.state = completionReady;
    expect(harness.controller.publishGate("finish successfully")?.reason).toContain(
      "rerun the latest failed verification successfully first",
    );
  });

  it("preserves persisted mutations in off mode and flags evidence-to-audit transitions", () => {
    const sessionManager = SessionManager.inMemory();
    const initial = createTaskVerificationController(sessionManager, "evidence");
    initial.state = {
      ...initial.state,
      mutationRevision: 1,
      taskOwnedPaths: ["result.txt"],
      taskOwnedPathBaselines: [{ path: "result.txt", state: null }],
    };
    initial.persistState();

    const disabled = createTaskVerificationController(sessionManager, "off");
    expect(disabled.currentState).toMatchObject({ mode: "off", mutationRevision: 1, taskOwnedPaths: ["result.txt"] });

    const audited = createTaskVerificationController(sessionManager, "audit");
    expect(audited.currentState.mode).toBe("audit");
    expect(audited.restoreError).toContain("mode changed from evidence to audit during an active mutating task");
  });

  it("rejects ambiguous declarations and unsupported evidence actions across task epochs", async () => {
    const empty = createWorkspaceHarness();
    expect(
      await callEvidenceVerification(empty.controller, {
        action: "record_completion_checklist",
        completion_checklist: ["The requested response contains the explanation"],
      }),
    ).toContain("requires a current substantive user prompt");
    expect(empty.controller.applyInput({ action: "unsupported" } as never).message).toContain(
      'accepts only "declare_task"',
    );

    await sendPrompt(empty, "Create result.txt containing the requested result.");
    expect(await declare(empty, "investigation", "Inspect the requested result")).toContain(
      "explicitly requires an effect",
    );
    expect(await declare(empty, "feature", " ")).toContain("requires task_kind and a concrete task_summary");
    await recordChecklist(empty, "result.txt contains the requested result line");
    await recordWorkspaceEffect(empty);
    expect(await declare(empty, "feature", "Replace the requested result")).toContain("after a successful effect");

    const responseOnly = createWorkspaceHarness();
    await sendPrompt(responseOnly, "Explain the current behavior in the response.");
    expect(await declare(responseOnly, "feature", "Change the implementation")).toContain(
      "response-only; declare it as investigation",
    );
    expect(await declare(responseOnly, "investigation", "Explain the current behavior")).toContain(
      "Task intent declared as investigation",
    );
    expect(
      await callEvidenceVerification(responseOnly.controller, {
        action: "record_completion_checklist",
        completion_checklist: ["The response explains the current behavior"],
        verification_scope: "response_only",
      }),
    ).toContain("Completion checklist recorded");
    expect(responseOnly.controller.completionGate("finish successfully", "unexpected-token", [])?.reason).toContain(
      "zero-effect response-only completion has no verification_token",
    );
    expect(responseOnly.controller.completionGate("finish successfully", undefined, ["result.txt"])?.reason).toContain(
      "files_changed must be empty",
    );
    expect(responseOnly.controller.completionGate("finish successfully", undefined, [])).toBeUndefined();
  });
});

function createWorkspaceHarness() {
  const cwd = mkdtempSync(join(tmpdir(), "p-readiness-lifecycle-"));
  temporaryDirectories.push(cwd);
  return { ...createEvidenceHarness(cwd), cwd };
}

async function sendPrompt(harness: ReturnType<typeof createWorkspaceHarness>, content: string): Promise<void> {
  await harness.emit({ type: "turn_start" });
  await harness.emit({
    type: "message_end",
    message: { role: "user", content, timestamp: Date.now() },
  });
}

async function recordChecklist(harness: ReturnType<typeof createWorkspaceHarness>, criterion: string): Promise<void> {
  expect(
    await callEvidenceVerification(harness.controller, {
      action: "record_completion_checklist",
      completion_checklist: [criterion],
    }),
  ).toContain("Completion checklist recorded");
}

async function recordWorkspaceEffect(harness: ReturnType<typeof createWorkspaceHarness>): Promise<void> {
  const args = { path: "result.txt", content: "requested result\n" };
  const call = evidenceToolCall("write", args);
  expect(await beforeEvidenceTool(harness.agent, "write", args, call)).toBeUndefined();
  writeFileSync(join(harness.cwd, args.path), args.content);
  await afterEvidenceTool(harness.agent, "write", args, "wrote result.txt", call);
  expect(harness.controller.currentState).toMatchObject({
    mutationRevision: 1,
    taskOwnedPaths: ["result.txt"],
  });
}

async function ready(
  harness: ReturnType<typeof createWorkspaceHarness>,
  unresolvedFailures: string[] = [],
): Promise<string> {
  return callEvidenceVerification(harness.controller, {
    action: "ready_to_finish",
    unresolved_failures: unresolvedFailures,
  });
}

async function declare(
  harness: ReturnType<typeof createWorkspaceHarness>,
  taskKind: "feature" | "investigation",
  taskSummary: string,
): Promise<string> {
  return callEvidenceVerification(harness.controller, {
    action: "declare_task",
    task_kind: taskKind,
    task_summary: taskSummary,
  });
}
