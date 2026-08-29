import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { collectProofWitnesses } from "../src/core/task-verification/requirement-proof-witnesses.ts";
import { isFocusedEvidence } from "../src/core/task-verification/taskverificationcontroller-methods/focused-requirement-evidence.ts";
import {
  formatFocusedSelectorContract,
  formatFocusedSelectorExample,
  formatRequirementBatchPrompt,
  formatRequirementProofPlan,
} from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import { validateRequirementVerdict } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-verdict-validation.ts";
import type { TaskRequirement, TaskVerificationEvidence } from "../src/core/task-verification/types.ts";
import {
  beforeAuditTool,
  createRequirementAuditHarness,
  recordAuditToolResult,
  withAuditProofWitnesses,
} from "./task-requirement-audit-test-harness.ts";

const requirement: TaskRequirement = {
  id: "R2",
  type: "behavior",
  text: "Return false for a tampered candidate whose bytes differ from the original",
  acceptanceCriterion: "isAuthentic returns false when candidate bytes differ from original bytes",
  sourcePromptIndexes: [1],
  proofPolicies: ["change_artifact_bytes"],
};

const multiPolicyRequirement: TaskRequirement = {
  id: "R3",
  type: "behavior",
  text: "Preserve state and the event log when an operation fails",
  acceptanceCriterion: "a failed operation leaves state and the event log unchanged",
  sourcePromptIndexes: [1],
  proofPolicies: ["preserve_state_on_failure", "preserve_log_on_failure"],
};

describe("focused selector contract", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("states that the selector needs the outcome and proof concepts", () => {
    const guidance = formatFocusedSelectorContract(requirement);

    expect(guidance).toContain("selector itself");
    expect(guidance).toContain(requirement.acceptanceCriterion);
    expect(guidance).toContain("changed candidate differs from the original");
    expect(guidance).toContain("shorter prefix is insufficient");
    expect(guidance).toContain("Use this exact safe case name and selector");
    expect(guidance).toContain("next test command");
    expect(guidance).toContain("Do not run the whole test file or suite first");
    expect(guidance).toContain(formatFocusedSelectorExample(requirement));
  });

  it("repeats the exact witness schema in the verdict batch prompt", () => {
    const prompt = formatRequirementBatchPrompt([requirement]);

    expect(prompt).toContain("Required same-run witness lines");
    expect(prompt).toContain(formatFocusedSelectorExample(requirement));
    expect(prompt).toContain('"originalBase64":"<base64>"');
    expect(prompt).toContain('"candidateBase64":"<base64>"');
    expect(prompt).toContain("standalone proof scripts");
  });

  it("rejects a proof-only prefix and accepts the full observable case name", () => {
    const controller = createRequirementAuditHarness().controller;
    controller.state.requirementAudit = {
      ...controller.state.requirementAudit,
      requirements: [requirement],
      requirementSetHash: "proof-set",
    };

    expect(isFocusedEvidence(controller, evidence("tampered candidate differs"), requirement)).toBe(false);
    expect(isFocusedEvidence(controller, evidence(formatFocusedSelectorExample(requirement)), requirement)).toBe(true);
  });

  it("directs missing witnesses back into the exact selected test", () => {
    const controller = createRequirementAuditHarness().controller;
    controller.state.requirementAudit = {
      ...controller.state.requirementAudit,
      requirements: [requirement],
      requirementSetHash: "proof-set",
    };
    const missingWitness = evidence("tampered candidate differs");
    delete missingWitness.proofWitnesses;
    controller.evidence.set(missingWitness.ref, missingWitness);

    const result = validateRequirementVerdict(controller, requirement, {
      passed: true,
      reason: "The selected invariant case passed.",
      evidence_refs: [missingWitness.ref],
    });

    expect(result).toContain("inside the exact named focused test case");
    expect(result).toContain(requirement.acceptanceCriterion);
    expect(result).toContain("shorter prefix is insufficient");
    expect(result).toContain("selector satisfying this contract");
    expect(result).toContain("originalBase64");
    expect(result).toContain("candidateBase64");
    expect(result).toContain("standalone proof script or separate command is invalid");
  });

  it("uses one exact selector and one run for every policy on a requirement", () => {
    const controller = createRequirementAuditHarness().controller;
    controller.state.requirementAudit = {
      ...controller.state.requirementAudit,
      requirements: [multiPolicyRequirement],
      requirementSetHash: "proof-set",
    };
    const selector = formatFocusedSelectorExample(multiPolicyRequirement);
    const proofPlan = formatRequirementProofPlan([multiPolicyRequirement]);
    const batchPrompt = formatRequirementBatchPrompt([multiPolicyRequirement]);

    expect(proofPlan).toContain(JSON.stringify(selector));
    expect(batchPrompt).toContain(JSON.stringify(selector));
    expect(proofPlan).toContain('"policy":"preserve_state_on_failure"');
    expect(proofPlan).toContain('"policy":"preserve_log_on_failure"');

    const bothWitnesses = multiPolicyEvidence(selector, ["preserve_state_on_failure", "preserve_log_on_failure"]);
    const oneWitness = multiPolicyEvidence(selector, ["preserve_state_on_failure"]);
    expect(isFocusedEvidence(controller, bothWitnesses, multiPolicyRequirement)).toBe(true);
    expect(isFocusedEvidence(controller, oneWitness, multiPolicyRequirement)).toBe(false);
  });

  it("blocks a broad test command until the exact proof selector is run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "p-focused-selector-contract-"));
    workspaces.push(workspace);
    const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
    harness.controller.state = {
      ...harness.controller.state,
      mutationRevision: 1,
      requirementAudit: {
        ...harness.controller.state.requirementAudit,
        status: "verifying",
        requirements: [requirement],
        requirementSetHash: "proof-set",
      },
    };
    const broad = await beforeAuditTool(harness.agent, "ctx_shell", { command: "node --test validator.test.js" });
    expect(broad).toMatchObject({ block: true });
    expect(broad?.reason).toContain(formatFocusedSelectorExample(requirement));

    const selector = formatFocusedSelectorExample(requirement);
    expect(
      await beforeAuditTool(harness.agent, "ctx_shell", {
        command: `node --test validator.test.js # --test-name-pattern="${selector}"`,
      }),
    ).toMatchObject({ block: true });
    for (const nonTestCommand of [
      "rg vitest package.json",
      "git grep vitest",
      "echo vitest",
      `node -e 'console.log("npm test")'`,
    ]) {
      expect(await beforeAuditTool(harness.agent, "ctx_shell", { command: nonTestCommand })).toBeUndefined();
    }
    expect(
      await beforeAuditTool(harness.agent, "ctx_shell", {
        command: "echo preparing; node --test validator.test.js",
      }),
    ).toMatchObject({ block: true });
    for (const wrappedBroadTest of [
      "bash -c 'node --test validator.test.js'",
      "bash -lc 'node --test validator.test.js'",
      "bash -c 'echo preparing; node --test validator.test.js'",
      "sh -xc 'npm test'",
      "timeout 60 node --test validator.test.js",
      "time -f '%e' node --test validator.test.js",
      "time --format '%e' npm test",
      "npm --silent test",
      "npm --prefix packages/coding-agent test",
      "pnpm --filter coding-agent test",
    ]) {
      expect(await beforeAuditTool(harness.agent, "ctx_shell", { command: wrappedBroadTest })).toMatchObject({
        block: true,
      });
    }
    const command = `node --test --test-name-pattern="${selector}" validator.test.js`;
    expect(await beforeAuditTool(harness.agent, "ctx_shell", { command })).toBeUndefined();
    expect(await beforeAuditTool(harness.agent, "ctx_shell", { command: `timeout 60 ${command}` })).toBeUndefined();
    expect(await beforeAuditTool(harness.agent, "ctx_shell", { command: `bash -lc '${command}'` })).toBeUndefined();
    await recordAuditToolResult(
      harness.agent,
      "ctx_shell",
      { command },
      {
        text: withAuditProofWitnesses("Tests 1 passed\nTests 0 failed", requirement),
      },
    );
    expect(
      await beforeAuditTool(harness.agent, "ctx_shell", { command: "node --test validator.test.js" }),
    ).toBeUndefined();
  });
});

function evidence(selector: string): TaskVerificationEvidence {
  const proofWitnesses = collectProofWitnesses(
    [
      {
        type: "text",
        text: `P_PROOF_V1 ${JSON.stringify({
          requirementId: "R2",
          policy: "change_artifact_bytes",
          facts: {
            originalBase64: Buffer.from("authentic").toString("base64"),
            candidateBase64: Buffer.from("tampered!").toString("base64"),
          },
        })}`,
      },
    ],
    [requirement],
    "proof-set",
    0,
  );
  return {
    version: 2,
    taskId: "task",
    ref: "verification-evidence-1",
    toolCallId: "bash-1",
    toolName: "bash",
    descriptor: `node --test --test-name-pattern="${selector}" validator.test.js`,
    outputSummary: "Tests 1 passed\nTests 0 failed",
    proofWitnesses,
    isError: false,
    mutationRevision: 0,
    timestamp: "2026-08-25T00:00:00.000Z",
  };
}

function multiPolicyEvidence(
  selector: string,
  policies: Array<"preserve_state_on_failure" | "preserve_log_on_failure">,
): TaskVerificationEvidence {
  const proofWitnesses = collectProofWitnesses(
    policies.map((policy) => ({
      type: "text" as const,
      text: `P_PROOF_V1 ${JSON.stringify({
        requirementId: "R3",
        policy,
        facts: {
          beforeBase64: Buffer.from("unchanged").toString("base64"),
          afterFailureBase64: Buffer.from("unchanged").toString("base64"),
          failedOutcome: "threw",
        },
      })}`,
    })),
    [multiPolicyRequirement],
    "proof-set",
    0,
  );
  return {
    ...evidence(selector),
    proofWitnesses,
  };
}
