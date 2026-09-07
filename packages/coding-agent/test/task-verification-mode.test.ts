import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentEvent, type ResolvedToolEffect, resolveToolEffect } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";
import {
  callEvidenceVerification as callVerification,
  evidenceHandle,
} from "./task-verification-evidence-test-harness.ts";

function createHarness(mode: "evidence" | "audit" | "off", cwd?: string) {
  const agent = new Agent();
  const controller = createTaskVerificationController(SessionManager.inMemory(cwd), mode);
  let subscriber: Parameters<Agent["subscribe"]>[0] | undefined;
  const originalSubscribe = agent.subscribe.bind(agent);
  agent.subscribe = (listener: Parameters<Agent["subscribe"]>[0]) => {
    subscriber = listener;
    return originalSubscribe(listener);
  };
  controller.install(agent);
  return {
    agent,
    controller,
    emit: async (event: AgentEvent) => {
      if (!subscriber) throw new Error("verification subscriber was not installed");
      await subscriber(event, new AbortController().signal);
    },
  };
}

function effectForTool(name: string): ResolvedToolEffect {
  if (name === "write" || name === "edit") {
    return resolveToolEffect({ kind: "workspace_write", risk: "normal" }, "builtin");
  }
  if (name === "bash") {
    return resolveToolEffect({ kind: "unknown", risk: "high" }, "builtin");
  }
  return resolveToolEffect({ kind: "read", risk: "normal" }, "builtin");
}

async function sendUserPrompt(harness: ReturnType<typeof createHarness>, text: string): Promise<void> {
  const message = { role: "user" as const, content: text, timestamp: 100 };
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message });
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { type: "toolCall" as const, id: `${name}-${Math.random()}`, name, arguments: args };
}

async function beforeTool(agent: Agent, name: string, args: Record<string, unknown>, call = toolCall(name, args)) {
  return agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect: effectForTool(name),
    context: {} as never,
  });
}

async function afterTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  text: string,
  call = toolCall(name, args),
): Promise<string> {
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect: effectForTool(name),
    result: { content: [{ type: "text", text }], details: undefined },
    isError: false,
    context: {} as never,
  });
  return (
    result?.content
      ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

async function callRequirementAudit(
  controller: TaskVerificationController,
  params: Record<string, unknown>,
): Promise<string> {
  const result = await controller.requirementAuditToolDefinition.execute(
    "requirement-audit-call",
    params as never,
    undefined,
    undefined,
    {} as never,
  );
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

describe("task verification modes", () => {
  it("lets evidence mode reach direct readiness without semantic definition or audit", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-task-verification-mode-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    execFileSync("git", ["config", "gc.auto", "0"], { cwd });
    execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "SPEC.md"), "# Contract\n\nReturn parsed records in canonical order.\n");
    execFileSync("git", ["add", "SPEC.md"], { cwd });
    const harness = createHarness("evidence", cwd);
    try {
      await sendUserPrompt(
        harness,
        "Implement the behavior described by SPEC.md, then run the focused tests and typecheck.",
      );
      expect(
        await callVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["Feature returns parsed records in the canonical order specified by SPEC.md"],
        }),
      ).toContain("Completion checklist recorded");

      const writeArgs = { path: "src/feature.ts", content: "export {};\n" };
      const writeCall = toolCall("write", writeArgs);
      expect((await beforeTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, writeArgs.path), writeArgs.content);
      await afterTool(harness.agent, "write", writeArgs, "wrote file", writeCall);

      expect(harness.controller.currentState.taskKind).toBeUndefined();
      expect(harness.controller.currentState.requirementAudit.requirements).toEqual([]);
      expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
      expect(
        await callRequirementAudit(harness.controller, {
          action: "define",
          requirements: [{ text: "Implement every requirement from SPEC.md", source_prompt_indexes: [0] }],
        }),
      ).toMatch(/^Requirement audit is available only when task verification mode is audit\.$/u);
      expect(harness.controller.currentState.requirementAudit.requirements).toEqual([]);

      const testEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          { command: "vitest --run test/feature.test.ts" },
          "Test Files 1 passed (1)\nTests 1 passed (1)",
        ),
      );
      const typecheckEvidence = evidenceHandle(
        await afterTool(harness.agent, "bash", { command: "npm run typecheck" }, "typecheck passed"),
      );
      const ready = await callVerification(harness.controller, {
        action: "ready_to_finish",
        unresolved_failures: [],
      });
      expect(harness.controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toEqual([
        testEvidence,
        typecheckEvidence,
      ]);
      expect(ready).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.status).toBe("completion_ready");
      expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
      const token = harness.controller.currentState.readiness?.token;
      expect(token).toBeTruthy();
      const finish = await beforeTool(harness.agent, "finish_work", {
        status: "success",
        verification_token: token,
        files_changed: ["src/feature.ts"],
      });
      expect(finish?.block).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps the one free-text completion checklist stable while evidence is refreshed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-task-verification-checklist-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    mkdirSync(join(cwd, "src"));
    const harness = createHarness("evidence", cwd);
    try {
      await sendUserPrompt(harness, "Implement exact atomic behavior that rejects stale input.");
      const checklist = [
        "Parser returns the canonical normalized value for valid input",
        "Atomic rejected batches leave all records unchanged",
        "Stale input is rejected",
        "Generated report contains every requested result section",
      ];
      expect(
        await callVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: checklist,
        }),
      ).toContain("Completion checklist recorded");
      const writeArgs = { path: "src/feature.ts", content: "export {};\n" };
      const writeCall = toolCall("write", writeArgs);
      expect((await beforeTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, writeArgs.path), writeArgs.content);
      await afterTool(harness.agent, "write", writeArgs, "wrote file", writeCall);
      const exactEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          { command: "vitest --run test/feature.test.ts -t 'returns canonical normalized value for valid input'" },
          "Tests 1 passed (1)",
        ),
      );
      const incomplete = await callVerification(harness.controller, {
        action: "ready_to_finish",
        unresolved_failures: [],
      });
      expect(incomplete).toContain("Atomic rejected batches leave all records unchanged");
      expect(incomplete).not.toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.status ?? "pending").toBe("pending");
      expect(harness.controller.currentState.completionChecklist?.criteria).toEqual(checklist);
      const blockedFinish = await beforeTool(harness.agent, "finish_work", {
        status: "success",
        files_changed: ["src/feature.ts"],
      });
      expect(blockedFinish?.block).toBe(true);
      const atomicEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          { command: "vitest --run test/feature.test.ts -t 'atomic rejected batches leave all records unchanged'" },
          "Tests 1 passed (1)",
        ),
      );
      const staleEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          { command: "vitest --run test/feature.test.ts -t 'rejects stale input'" },
          "Tests 1 passed (1)",
        ),
      );
      const completeEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          {
            command: "vitest --run test/feature.test.ts -t 'generated report contains every requested result section'",
          },
          "Tests 1 passed (1)",
        ),
      );

      const ready = await callVerification(harness.controller, {
        action: "ready_to_finish",
        unresolved_failures: [],
      });
      expect(ready).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.status).toBe("completion_ready");
      expect(harness.controller.currentState.completionChecklist?.criteria).toEqual(checklist);
      expect(harness.controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toEqual([
        exactEvidence,
        atomicEvidence,
        staleEvidence,
        completeEvidence,
      ]);
      expect(
        (
          await beforeTool(harness.agent, "finish_work", {
            status: "success",
            verification_token: harness.controller.currentState.readiness?.token,
            files_changed: ["src/feature.ts"],
          })
        )?.block,
      ).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("keeps audit mode baseline and semantic gates unchanged", async () => {
    const harness = createHarness("audit");
    await callVerification(harness.controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix daemon recovery",
    });

    const blocked = await beforeTool(harness.agent, "edit", { path: "src/daemon.ts", edits: [] });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("baseline");
  });

  it("installs no verification hooks in off mode", () => {
    const harness = createHarness("off");

    expect(harness.controller.mode).toBe("off");
    expect(harness.agent.beforeToolCall).toBeUndefined();
    expect(harness.agent.afterToolCall).toBeUndefined();
  });
});
