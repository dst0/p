import { Agent, type AgentEvent, type ResolvedToolEffect, resolveToolEffect } from "@dst0/p-agent-core";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

export function evidenceToolCall(name: string, args: Record<string, unknown>) {
  return { type: "toolCall" as const, id: `${name}-${Math.random()}`, name, arguments: args };
}

export function createEvidenceHarness(cwd: string, sessionManager = SessionManager.inMemory(cwd)) {
  const agent = new Agent();
  const controller = createTaskVerificationController(sessionManager, "evidence");
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
    sessionManager,
  };
}

export async function callEvidenceVerification(
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

export async function beforeEvidenceTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  call = evidenceToolCall(name, args),
  effect = evidenceEffectForTool(name),
) {
  return agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    context: {} as never,
  });
}

export async function afterEvidenceTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  text: string,
  call = evidenceToolCall(name, args),
  isError = false,
  effect = evidenceEffectForTool(name),
): Promise<string> {
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    result: { content: [{ type: "text", text }], details: undefined },
    isError,
    context: {} as never,
  });
  return (
    result?.content
      ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

export function evidenceHandle(text: string): string {
  const match = text.match(/Verification evidence handle: (verification-evidence-\d+)/u);
  if (!match) throw new Error(`Missing evidence handle in: ${text}`);
  return match[1];
}

function evidenceEffectForTool(name: string): ResolvedToolEffect {
  return resolveToolEffect(
    name === "write" || name === "edit"
      ? { kind: "workspace_write", risk: "normal" }
      : name === "bash"
        ? { kind: "unknown", risk: "high" }
        : { kind: "read", risk: "normal" },
    "builtin",
  );
}
