import { Agent, type AgentEvent } from "@dst0/p-agent-core";
import { SessionManager } from "../src/core/session-manager.ts";
import { computeStateUserRequirementsHash } from "../src/core/task-verification/requirement-audit-hashing.ts";
import type { TaskRequirement } from "../src/core/task-verification/types.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

export interface RequirementAuditHarness {
  agent: Agent;
  controller: TaskVerificationController;
  sessionManager: SessionManager;
  emit: (event: AgentEvent) => Promise<void>;
}

export function createRequirementAuditHarness(
  sessionManager: SessionManager = SessionManager.inMemory(),
): RequirementAuditHarness {
  const agent = new Agent();
  const controller = createTaskVerificationController(sessionManager);
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
    sessionManager,
    emit: async (event) => {
      if (!subscriber) throw new Error("verification subscriber was not installed");
      await subscriber(event, new AbortController().signal);
    },
  };
}

export async function nextModelTurn(harness: RequirementAuditHarness): Promise<void> {
  await harness.emit({ type: "turn_start" });
}

export async function sendAuditUserPrompt(
  harness: RequirementAuditHarness,
  text: string,
  timestamp: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const message = { role: "user" as const, content: text, metadata, timestamp };
  await nextModelTurn(harness);
  await harness.emit({ type: "message_start", message });
  await harness.emit({ type: "message_end", message });
}

export async function defineSingleDirectPromptRequirement(
  harness: RequirementAuditHarness,
  text: string,
  acceptanceCriterion: string,
): Promise<void> {
  return defineDirectPromptRequirements(harness, [{ text, acceptanceCriterion, sourcePromptIndex: 1 }]);
}

export async function defineDirectPromptRequirements(
  harness: RequirementAuditHarness,
  requirements: readonly { text: string; acceptanceCriterion: string; sourcePromptIndex: number }[],
): Promise<void> {
  if (!harness.controller.currentState.taskKind) {
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "docs",
      task_summary: requirements[0]?.text ?? "Verify the requested behavior",
    });
  }
  const result = await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: requirements.map((requirement) => ({
      type: "behavior",
      text: requirement.text,
      acceptance_criterion: requirement.acceptanceCriterion,
      source_prompt_indexes: [requirement.sourcePromptIndex],
    })),
    ignored_source_prompts: [],
  });
  if (!result.includes(`Defined ${requirements.length} atomic requirement`)) throw new Error(result);
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export async function callTaskVerification(
  controller: TaskVerificationController,
  params: Record<string, unknown>,
): Promise<string> {
  return resultText(
    await controller.toolDefinition.execute("verification-call", params as never, undefined, undefined, {} as never),
  );
}

export async function callRequirementAudit(
  controller: TaskVerificationController,
  params: Record<string, unknown>,
): Promise<string> {
  return resultText(
    await controller.requirementAuditToolDefinition.execute(
      "requirement-audit-call",
      params as never,
      undefined,
      undefined,
      {} as never,
    ),
  );
}

export function activateRequirementDefinitionAfterEvidenceForTest(controller: TaskVerificationController): void {
  const userRequirementsHash = computeStateUserRequirementsHash(controller.state);
  controller.state.final = {
    status: "passed",
    method: "focused_test",
    evidenceRefs: ["verification-evidence-test"],
    unresolvedFailures: [],
    verifiedMutationRevision: controller.state.mutationRevision,
  };
  controller.state.readiness = {
    status: "evidence_ready",
    acceptanceChecks: [{ criterion: "focused test evidence", evidenceRefs: ["verification-evidence-test"] }],
    verifiedMutationRevision: controller.state.mutationRevision,
    userRequirementsHash,
  };
  controller.state.requirementAudit = {
    status: "awaiting_definition",
    requirements: [],
    ignoredSourcePrompts: [],
    ignoredSourceClauses: [],
    nextRequirementIndex: 0,
    userRequirementsHash,
  };
  controller.persistState();
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { type: "toolCall" as const, id: `${name}-${Math.random()}`, name, arguments: args };
}

export async function recordAuditToolResult(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  options: { text?: string; isError?: boolean } = {},
): Promise<string> {
  const call = toolCall(name, args);
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    result: { content: [{ type: "text", text: options.text ?? "ok" }], details: undefined },
    isError: options.isError ?? false,
    context: {} as never,
  });
  return result?.content ? resultText({ content: result.content }) : "";
}

export async function recordProductionMutationForTest(harness: RequirementAuditHarness): Promise<void> {
  await recordAuditToolResult(harness.agent, "write", {
    path: "src/inventory.ts",
    content: "export const inventory = true;\n",
  });
}

export function auditEvidenceHandle(text: string): string {
  const match = text.match(/Verification evidence handle: (verification-evidence-\d+)/u);
  if (!match) throw new Error(`Missing evidence handle in: ${text}`);
  return match[1];
}

export function auditVerificationToken(text: string): string {
  const match = text.match(/verification_token: ([0-9a-f-]+)/u);
  if (!match) throw new Error(`Missing verification token in: ${text}`);
  return match[1];
}

export function withAuditProofWitnesses(output: string, requirement: TaskRequirement): string {
  const proofLines = (requirement.proofPolicies ?? []).map(
    (policy) => `P_PROOF_V1 ${JSON.stringify({ requirementId: requirement.id, policy, facts: proofFacts(policy) })}`,
  );
  return [output, ...proofLines].join("\n");
}

function proofFacts(policy: NonNullable<TaskRequirement["proofPolicies"]>[number]): Record<string, unknown> {
  if (policy === "preserve_state_on_failure" || policy === "preserve_log_on_failure") {
    const snapshot = Buffer.from("unchanged snapshot").toString("base64");
    return { beforeBase64: snapshot, afterFailureBase64: snapshot, failedOutcome: "threw" };
  }
  if (policy === "preserve_version_on_failure" || policy === "preserve_position_on_failure") {
    return {
      before: 4,
      afterFailure: 4,
      afterSuccess: 5,
      failedOutcome: "threw",
      successOutcome: "succeeded",
    };
  }
  if (policy === "preserve_command_identity_on_failure") {
    return {
      failedIdentity: "same-command-id",
      retryIdentity: "same-command-id",
      failedOutcome: "threw",
      retryOutcome: "succeeded",
    };
  }
  const original = Buffer.from("artifact\n");
  const candidate = policy === "remove_exact_final_byte" ? original.subarray(0, -1) : Buffer.from("changed\n");
  return {
    originalBase64: original.toString("base64"),
    candidateBase64: candidate.toString("base64"),
    outcome: "threw",
  };
}

export async function completeSingleRequirementAudit(
  controller: TaskVerificationController,
  evidenceRef: string,
): Promise<string> {
  await callRequirementAudit(controller, {
    action: "define",
    requirements: [
      {
        type: "behavior",
        text: controller.currentState.taskSummary ?? "Complete the requested behavior",
        acceptance_criterion: "The requested behavior is proven by current evidence",
        source_prompt_indexes: [1],
      },
    ],
    ignored_source_prompts: [],
  });
  const verdict = await callRequirementAudit(controller, {
    action: "verdict",
    verdicts: [
      {
        requirement_id: "R1",
        passed: true,
        reason: "Focused current-revision evidence proves the requested behavior.",
        evidence_refs: [evidenceRef],
      },
    ],
  });
  return auditVerificationToken(verdict);
}

export async function beforeAuditTool(agent: Agent, name: string, args: Record<string, unknown>) {
  const call = toolCall(name, args);
  return agent.beforeToolCall?.({ assistantMessage: {} as never, toolCall: call, args, context: {} as never });
}

export async function reachAuditEvidenceReady(
  harness: RequirementAuditHarness,
): Promise<{ evidenceRef: string; text: string }> {
  await sendAuditUserPrompt(harness, "Add a completion gate backed by focused verification.", 100);
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Add a completion gate backed by focused verification",
  });
  await recordAuditToolResult(harness.agent, "edit", {
    path: "src/gate.ts",
    edits: [{ oldText: "old", newText: "new" }],
  });
  const evidenceRef = auditEvidenceHandle(
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "vitest --run test/gate.test.ts" },
      { text: "focused gate tests passed" },
    ),
  );
  const text = await callTaskVerification(harness.controller, {
    action: "ready_to_finish",
    acceptance_checks: [{ criterion: "The completion gate is enforced", evidence_refs: [evidenceRef] }],
    unresolved_failures: [],
  });
  return { evidenceRef, text };
}
