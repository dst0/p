import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentEvent, type ResolvedToolEffect, resolveToolEffect } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

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

function evidenceHandle(text: string): string {
  const match = text.match(/Verification evidence handle: (verification-evidence-\d+)/u);
  if (!match) throw new Error(`Missing evidence handle in: ${text}`);
  return match[1];
}

async function callVerification(
  controller: TaskVerificationController,
  params: Record<string, unknown>,
): Promise<string> {
  const result = await controller.toolDefinition.execute(
    "verification-call",
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
    const harness = createHarness("evidence", cwd);
    try {
      await sendUserPrompt(
        harness,
        "Implement the behavior described by SPEC.md, then run the focused tests and typecheck.",
      );

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
        acceptance_checks: [
          {
            criterion: "The requested implementation and checks completed successfully",
            evidence_refs: [testEvidence, typecheckEvidence],
          },
        ],
        unresolved_failures: [],
        files_changed: ["src/feature.ts"],
      });

      expect(ready).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.status).toBe("completion_ready");
      expect(harness.controller.currentState.requirementAudit.status).toBe("pending");
      const token = harness.controller.currentState.readiness?.token;
      expect(token).toBeTruthy();
      expect(
        (
          await beforeTool(harness.agent, "finish_work", {
            status: "success",
            verification_token: token,
            files_changed: ["src/feature.ts"],
          })
        )?.block,
      ).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("requires the free-text completion checklist to cover multiple explicit guarantees", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-task-verification-checklist-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    mkdirSync(join(cwd, "src"));
    const harness = createHarness("evidence", cwd);
    try {
      await sendUserPrompt(harness, "Implement exact atomic behavior that rejects stale input.");
      const writeArgs = { path: "src/feature.ts", content: "export {};\n" };
      const writeCall = toolCall("write", writeArgs);
      expect((await beforeTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, writeArgs.path), writeArgs.content);
      await afterTool(harness.agent, "write", writeArgs, "wrote file", writeCall);
      const exactEvidence = evidenceHandle(
        await afterTool(harness.agent, "bash", { command: "node verify-exact-output.js" }, "exact output passed"),
      );
      const atomicEvidence = evidenceHandle(
        await afterTool(harness.agent, "bash", { command: "node verify-atomicity.js" }, "atomicity passed"),
      );
      const staleEvidence = evidenceHandle(
        await afterTool(
          harness.agent,
          "bash",
          { command: "node verify-stale-input.js" },
          "stale input rejection passed",
        ),
      );
      const completeEvidence = evidenceHandle(
        await afterTool(harness.agent, "bash", { command: "node verify-complete-output.js" }, "complete output passed"),
      );

      const incomplete = await callVerification(harness.controller, {
        action: "ready_to_finish",
        acceptance_checks: [{ criterion: "Feature works", evidence_refs: [exactEvidence] }],
        unresolved_failures: [],
      });
      expect(incomplete).toContain("at least 4 distinct acceptance_checks");
      expect(harness.controller.currentState.readiness?.status ?? "pending").toBe("pending");
      expect(
        (
          await beforeTool(harness.agent, "finish_work", {
            status: "success",
            files_changed: ["src/feature.ts"],
          })
        )?.block,
      ).toBe(true);

      const ready = await callVerification(harness.controller, {
        action: "ready_to_finish",
        acceptance_checks: [
          { criterion: "Exact behavior", evidence_refs: [exactEvidence] },
          { criterion: "Atomic behavior", evidence_refs: [atomicEvidence] },
          { criterion: "Stale input is rejected", evidence_refs: [staleEvidence] },
          { criterion: "Requested output is complete", evidence_refs: [completeEvidence] },
        ],
        unresolved_failures: [],
      });
      expect(ready).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.status).toBe("completion_ready");
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
