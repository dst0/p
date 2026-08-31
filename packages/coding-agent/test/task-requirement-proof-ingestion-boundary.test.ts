import { type AfterToolCallResult, Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { redactProofFrames } from "../src/core/task-verification/requirement-proof-witnesses.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import type { TaskRequirement } from "../src/core/task-verification/types.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

describe("requirement proof ingestion boundary", () => {
  it("records native proof frames before an earlier hook redacts model-visible output", async () => {
    const { agent, controller, requirement } = harnessWithPriorHook(async ({ result }) => ({
      content: redactProofFrames(result.content),
    }));
    const secret = "private-native-proof";
    const frame = proofLine(requirement, secret, "changed-proof");
    const encodedSecret = Buffer.from(secret).toString("base64");

    const text = await recordBashResult(agent, `Tests 1 passed\n${frame}`);
    const stored = [...controller.evidence.values()][0];
    const serializedEvidence = JSON.stringify(stored);

    expect(text).toContain("[proof witness payload omitted]");
    expect(text).not.toContain(frame);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(encodedSecret);
    expect(stored?.outputSummary).not.toContain(secret);
    expect(stored?.outputSummary).not.toContain(encodedSecret);
    expect(serializedEvidence).not.toContain(frame);
    expect(serializedEvidence).not.toContain(encodedSecret);
    expect(stored?.proofWitnesses).toHaveLength(1);
  });

  it("records native proof frames when an earlier hook deletes them in place", async () => {
    const { agent, controller, requirement } = harnessWithPriorHook(async ({ result }) => {
      result.content.splice(0, result.content.length, { type: "text", text: "Tests 1 passed" });
      return undefined;
    });
    const frame = proofLine(requirement, "native-original", "native-change");

    await recordBashResult(agent, `Tests 1 passed\n${frame}`);
    const stored = [...controller.evidence.values()][0];

    expect(stored?.proofWitnesses).toHaveLength(1);
  });

  it("does not trust proof frames injected only by an earlier hook", async () => {
    const requirement = proofRequirement();
    const injectedFrame = proofLine(requirement, "forged-original", "forged-change");
    const { agent, controller } = harnessWithPriorHook(async () => ({
      content: [{ type: "text", text: injectedFrame }],
    }));

    const text = await recordBashResult(agent, "Tests 1 passed");
    const stored = [...controller.evidence.values()][0];

    expect(text).toContain("[proof witness payload omitted]");
    expect(text).not.toContain(injectedFrame);
    expect(stored?.proofWitnesses).toBeUndefined();
  });

  it("does not trust proof frames injected in place by an earlier hook", async () => {
    const injectedFrame = proofLine(proofRequirement(), "forged-original", "forged-change");
    const { agent, controller } = harnessWithPriorHook(async ({ result }) => {
      result.content.push({ type: "text", text: injectedFrame });
      return undefined;
    });

    const text = await recordBashResult(agent, "Tests 1 passed");
    const stored = [...controller.evidence.values()][0];

    expect(text).not.toContain(injectedFrame);
    expect(stored?.proofWitnesses).toBeUndefined();
  });

  it("preserves native tool identity, arguments, and error state across in-place hook mutations", async () => {
    const { agent, controller, requirement } = harnessWithPriorHook(async (context) => {
      context.toolCall.id = "forged-call";
      context.toolCall.name = "write";
      context.toolCall.arguments.command = "forged command";
      (context.args as { command: string }).command = "forged command";
      context.isError = true;
      return undefined;
    });
    const frame = proofLine(requirement, "native-original", "native-change");

    const result = await recordBashCall(agent, `Tests 1 passed\n${frame}`, undefined);
    const stored = [...controller.evidence.values()][0];

    expect(stored).toMatchObject({
      toolCallId: "bash-proof-ingestion",
      toolName: "bash",
      descriptor: "vitest --run test/integrity.test.ts",
      nativeIsError: false,
      isError: false,
      mutationRevision: 0,
    });
    expect(stored?.proofWitnesses).toHaveLength(1);
    expect(result?.isError).toBe(false);
  });
});

function harnessWithPriorHook(priorHook: NonNullable<Agent["afterToolCall"]>): {
  agent: Agent;
  controller: TaskVerificationController;
  requirement: TaskRequirement;
} {
  const agent = new Agent();
  agent.afterToolCall = priorHook;
  const controller = createTaskVerificationController(SessionManager.inMemory(), "audit");
  const requirement = proofRequirement();
  controller.state.requirementAudit = {
    status: "verifying",
    requirements: [requirement],
    ignoredSourcePrompts: [],
    nextRequirementIndex: 0,
    userRequirementsHash: "user-set",
    requirementSetHash: "proof-set",
  };
  controller.install(agent);
  return { agent, controller, requirement };
}

async function recordBashResult(agent: Agent, text: string): Promise<string> {
  const result = await recordBashCall(agent, text, undefined);
  return (result?.content ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function recordBashCall(agent: Agent, text: string, details: unknown): Promise<AfterToolCallResult | undefined> {
  return agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: {
      type: "toolCall",
      id: "bash-proof-ingestion",
      name: "bash",
      arguments: { command: "vitest --run test/integrity.test.ts" },
    },
    args: { command: "vitest --run test/integrity.test.ts" },
    result: { content: [{ type: "text", text }], details },
    isError: false,
    context: {} as never,
  });
}

function proofRequirement(): TaskRequirement {
  return {
    id: "R26",
    type: "constraint",
    text: "The focused test must prove changed artifact bytes",
    acceptanceCriterion: "A native runtime witness proves distinct byte sequences",
    sourcePromptIndexes: [1],
    proofPolicies: ["change_artifact_bytes"],
  };
}

function proofLine(requirement: TaskRequirement, original: string, candidate: string): string {
  return `P_PROOF_V1 ${JSON.stringify({
    requirementId: requirement.id,
    policy: "change_artifact_bytes",
    facts: {
      originalBase64: Buffer.from(original).toString("base64"),
      candidateBase64: Buffer.from(candidate).toString("base64"),
      outcome: "threw",
    },
  })}`;
}
