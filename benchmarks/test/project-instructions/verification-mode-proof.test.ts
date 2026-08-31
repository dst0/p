import assert from "node:assert/strict";
import { test } from "node:test";
import { createBaseSystemModeProof, projectInstructionPreflightFailure } from "../../src/project-instructions/probe.ts";
import { projectRuntimeTaskVerificationProof } from "../../src/project-instructions/verification-sample-proof.ts";

const sourceHash = "a".repeat(64);
const compiledPrompt =
  '<project_instructions agents_sha256="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" input_sha256="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" mode="compiled">\nbody\n</project_instructions>';

function toolSurface(registered: string[], active = registered) {
  return {
    getAllTools: () => registered.map((name) => ({ name })),
    getActiveTools: () => [...active],
  };
}

test("startup proof persists requested and effective task-verification profiles", () => {
  const proof = createBaseSystemModeProof(
    {
      systemPrompt: compiledPrompt,
      systemPromptOptions: {
        projectInstructions: compiledPrompt,
        taskVerificationMode: "evidence",
      },
    },
    "compiled",
    sourceHash,
    undefined,
    "evidence",
    toolSurface(["record_task_verification"]),
  );
  assert.equal(proof.requestedTaskVerificationMode, "evidence");
  assert.equal(proof.effectiveTaskVerificationMode, "evidence");
  assert.deepEqual(proof.registeredVerificationTools, ["record_task_verification"]);
  assert.deepEqual(proof.activeVerificationTools, ["record_task_verification"]);
  assert.equal(proof.verificationToolSurfaceRegistered, true);
  assert.equal(proof.verificationToolSurfaceActive, true);
  assert.equal(projectInstructionPreflightFailure(proof), undefined);
});

test("startup proof fails closed when the effective profile collapses", () => {
  const proof = createBaseSystemModeProof(
    {
      systemPrompt: compiledPrompt,
      systemPromptOptions: {
        projectInstructions: compiledPrompt,
        taskVerificationMode: "audit",
      },
    },
    "compiled",
    sourceHash,
    undefined,
    "evidence",
    toolSurface(["record_requirement_audit", "record_task_verification"]),
  );
  assert.match(projectInstructionPreflightFailure(proof) ?? "", /task-verification profile/u);
});

test("startup proof rejects declarative evidence mode when audit remains registered or active", () => {
  for (const surface of [
    toolSurface(["record_requirement_audit", "record_task_verification"]),
    toolSurface(["record_task_verification"], ["record_requirement_audit", "record_task_verification"]),
    toolSurface(["record_task_verification"], []),
  ]) {
    const proof = createBaseSystemModeProof(
      {
        systemPrompt: compiledPrompt,
        systemPromptOptions: { projectInstructions: compiledPrompt, taskVerificationMode: "evidence" },
      },
      "compiled",
      sourceHash,
      undefined,
      "evidence",
      surface,
    );
    assert.match(projectInstructionPreflightFailure(proof) ?? "", /tool inventory|controller/u);
  }
});

test("startup proof distinguishes evidence, audit, and off tool surfaces", () => {
  const profiles = [
    ["evidence", ["record_task_verification"]],
    ["audit", ["record_requirement_audit", "record_task_verification"]],
    ["off", []],
  ] as const;
  for (const [mode, tools] of profiles) {
    const proof = createBaseSystemModeProof(
      {
        systemPrompt: compiledPrompt,
        systemPromptOptions: { projectInstructions: compiledPrompt, taskVerificationMode: mode },
      },
      "compiled",
      sourceHash,
      undefined,
      mode,
      toolSurface([...tools]),
    );
    assert.equal(projectInstructionPreflightFailure(proof), undefined, mode);
    assert.deepEqual(proof.registeredVerificationTools, tools, mode);
    assert.deepEqual(proof.activeVerificationTools, tools, mode);
    assert.equal(proof.verificationToolSurfaceRegistered, mode !== "off", mode);
    assert.equal(proof.verificationToolSurfaceActive, mode !== "off", mode);
  }
});

test("public sample verification proof is projected from captured runtime evidence", () => {
  const projected = projectRuntimeTaskVerificationProof({
    requestedTaskVerificationMode: "audit",
    baseSystemModeProofs: [
      {
        effectiveTaskVerificationMode: "audit",
        registeredVerificationTools: ["record_requirement_audit", "record_task_verification"],
        activeVerificationTools: ["record_requirement_audit", "record_task_verification"],
        verificationToolSurfaceRegistered: true,
        verificationToolSurfaceActive: true,
      },
    ],
  });
  assert.deepEqual(projected, {
    requested: "audit",
    effective: "audit",
    registeredTools: ["record_requirement_audit", "record_task_verification"],
    activeTools: ["record_requirement_audit", "record_task_verification"],
    toolSurfaceRegistered: true,
    toolSurfaceActive: true,
  });
});
