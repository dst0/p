import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceCriticalProofRequirement } from "../src/core/task-verification/evidence-critical-proof.ts";
import { formatFocusedSelectorExample } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const EXACT_LOG_CONTRACT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must reject removal of only the final LF byte.",
  "",
].join("\n");

describe("evidence-mode critical proof lifecycle", () => {
  it("discovers critical proof before mutation and permits only monotonic checklist augmentation", async () => {
    const cwd = createRepository({ "FORMAT.md": EXACT_LOG_CONTRACT });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Implement the store according to FORMAT.md.", 100);
      const obligation = harness.controller.currentState.criticalProofObligations?.[0];
      if (!obligation) throw new Error("missing exact-byte obligation");
      const criterion = evidenceCriticalProofRequirement(obligation).acceptanceCriterion;
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["Store returns the configured payload unchanged"],
        }),
      ).toContain("append");
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["Store returns the configured payload unchanged", criterion],
        }),
      ).toContain("Completion checklist recorded");
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: [criterion],
        }),
      ).toContain("Keep every existing completion criterion");

      const writeArgs = { path: "src/store.ts", content: "export {};\n" };
      const writeCall = evidenceToolCall("write", writeArgs);
      expect((await beforeEvidenceTool(harness.agent, "write", writeArgs, writeCall))?.block).not.toBe(true);
      writeFileSync(join(cwd, "src/store.ts"), writeArgs.content);
      await afterEvidenceTool(harness.agent, "write", writeArgs, "wrote file", writeCall);
      const requirement = evidenceCriticalProofRequirement(obligation);
      const selector = formatFocusedSelectorExample(requirement);
      const shortenedCommand = "vitest --run test/store.test.ts -t 'reject exact final byte truncation'";
      const shortenedGate = await beforeEvidenceTool(harness.agent, "bash", { command: shortenedCommand });
      expect(shortenedGate).toMatchObject({ block: true });
      expect(shortenedGate?.reason).toContain(selector);
      const focusedArgs = { command: `vitest --run test/store.test.ts -t '${selector}'` };
      const focusedCall = evidenceToolCall("bash", focusedArgs);
      expect(await beforeEvidenceTool(harness.agent, "bash", focusedArgs, focusedCall)).toBeUndefined();
      const baseEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", { command: "node verify-store.js" }, "verified"),
      );
      const proofEvidence = evidenceHandle(
        await afterEvidenceTool(
          harness.agent,
          "bash",
          focusedArgs,
          `Tests 1 passed (1)\n${proofFrame(obligation.id)}`,
          focusedCall,
        ),
      );
      const broadArgs = { command: "npm test" };
      const broadCall = evidenceToolCall("bash", broadArgs);
      expect(await beforeEvidenceTool(harness.agent, "bash", broadArgs, broadCall)).toBeUndefined();
      const broadEvidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", broadArgs, "Tests 2 passed (2)", broadCall),
      );
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          unresolved_failures: [],
        }),
      ).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.acceptanceChecks).toEqual([
        {
          criterion: "Store returns the configured payload unchanged",
          evidenceRefs: [baseEvidence, proofEvidence, broadEvidence],
        },
        {
          criterion,
          evidenceRefs: [baseEvidence, proofEvidence, broadEvidence],
        },
      ]);
      expect(harness.controller.formatNextRequirement()).toContain(criterion);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not create runtime-test debt for requested documentation output", async () => {
    const cwd = createRepository({ "README.md": EXACT_LOG_CONTRACT });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Create README.md documentation with an installation section.", 100);
      await afterEvidenceTool(harness.agent, "read", { path: "README.md" }, EXACT_LOG_CONTRACT);
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: ["README.md contains a clear installation section"],
      });
      const args = { path: "README.md", content: "# Install\n\nRun npm install.\n" };
      const call = evidenceToolCall("write", args);
      await beforeEvidenceTool(harness.agent, "write", args, call);
      writeFileSync(join(cwd, "README.md"), args.content);
      await afterEvidenceTool(harness.agent, "write", args, "wrote README", call);
      const evidence = evidenceHandle(
        await afterEvidenceTool(harness.agent, "read", { path: "README.md" }, args.content),
      );
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          unresolved_failures: [],
        }),
      ).toContain("verification_token:");
      expect(harness.controller.currentState.readiness?.acceptanceChecks[0]?.evidenceRefs).toEqual([evidence]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects broad evidence for an unrelated high-risk checklist invariant", async () => {
    const cwd = createRepository({ "README.md": "# Fixture\n" });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Implement atomic batch rejection.", 100);
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: ["Atomic rejected batches leave all records unchanged"],
      });
      const args = { path: "src/store.ts", content: "export {};\n" };
      const call = evidenceToolCall("write", args);
      await beforeEvidenceTool(harness.agent, "write", args, call);
      writeFileSync(join(cwd, "src/store.ts"), args.content);
      await afterEvidenceTool(harness.agent, "write", args, "wrote store", call);
      evidenceHandle(await afterEvidenceTool(harness.agent, "bash", { command: "npm test" }, "Tests 42 passed"));
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          unresolved_failures: [],
        }),
      ).toContain("requires a relevant focused passing test");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not let an exact artifact assertion replace a critical P_PROOF witness", async () => {
    const cwd = createRepository({ "FORMAT.md": EXACT_LOG_CONTRACT });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Create status.txt while implementing the FORMAT.md contract.", 100);
      await afterEvidenceTool(harness.agent, "read", { path: "FORMAT.md" }, EXACT_LOG_CONTRACT);
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        authoritative_source_paths: ["FORMAT.md"],
        completion_checklist: [
          'status.txt has exact bytes with a terminal newline; exact_file_bytes("status.txt","ready\\n")',
        ],
      });
      const obligation = harness.controller.currentState.criticalProofObligations?.[0];
      if (!obligation) throw new Error("missing exact-byte obligation");
      const criticalCriterion = evidenceCriticalProofRequirement(obligation).acceptanceCriterion;
      const artifactCriterion =
        'status.txt has exact bytes with a terminal newline; exact_file_bytes("status.txt","ready\\n")';
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [artifactCriterion, criticalCriterion],
      });
      const args = { path: "status.txt", content: "ready\n" };
      const call = evidenceToolCall("write", args);
      await beforeEvidenceTool(harness.agent, "write", args, call);
      writeFileSync(join(cwd, "status.txt"), args.content);
      await afterEvidenceTool(harness.agent, "write", args, "wrote status", call);
      evidenceHandle(
        await afterEvidenceTool(harness.agent, "bash", { command: "diff <(printf 'ready\\n') status.txt" }, ""),
      );
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "ready_to_finish",
          unresolved_failures: [],
        }),
      ).toContain("same-run P_PROOF_V1 exact-byte witness");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ignores failed reads and removes explicitly deauthorized source obligations", async () => {
    const cwd = createRepository({ "SPEC.md": EXACT_LOG_CONTRACT });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Implement the persistence contract from SPEC.md.", 100);
      const original = harness.controller.currentState.criticalProofObligations;
      expect(original).toHaveLength(1);
      await afterEvidenceTool(harness.agent, "read", { path: "SPEC.md" }, "read failed", undefined, true);
      expect(harness.controller.currentState.criticalProofObligations).toEqual(original);
      await afterEvidenceTool(harness.agent, "semantic_search", { path: "SPEC.md" }, "first output chunk only");
      expect(harness.controller.currentState.criticalProofObligations).toEqual(original);
      await sendPrompt(harness, "Do not use SPEC.md as a requirement source.", 101);
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      expect(harness.controller.currentState.completionChecklist).toBeUndefined();
      await sendPrompt(harness, "Also preserve deterministic API output.", 102);
      await afterEvidenceTool(harness.agent, "read", { path: "SPEC.md" }, EXACT_LOG_CONTRACT);
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      await sendPrompt(harness, "Use SPEC.md again as the authoritative requirement source.", 103);
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("bounds five discovered sources without persisting unrestorable state", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`SPEC-${index + 1}.md`, EXACT_LOG_CONTRACT]),
    );
    const cwd = createRepository(files);
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, `Implement the contracts from ${Object.keys(files).join(", ")}.`, 100);
      for (const path of Object.keys(files)) {
        await afterEvidenceTool(harness.agent, "read", { path }, EXACT_LOG_CONTRACT);
      }
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(4);
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBe(true);
      const restored = createTaskVerificationController(harness.sessionManager, "evidence");
      expect(restored.restoreError).toBeUndefined();
      expect(
        (await beforeEvidenceTool(harness.agent, "write", { path: "src/store.ts", content: "export {};\n" }))?.reason,
      ).toContain("More than four distinct critical proof boundaries");
      await sendPrompt(harness, "Do not use SPEC-5.md as a requirement source.", 101);
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBeUndefined();
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(4);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(files: Readonly<Record<string, string>>): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-evidence-critical-proof-"));
  mkdirSync(join(cwd, "src"));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd });
  execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
    cwd,
  });
  return cwd;
}

async function sendPrompt(harness: ReturnType<typeof createEvidenceHarness>, content: string, timestamp: number) {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}

function proofFrame(requirementId: string): string {
  return `P_PROOF_V1 ${JSON.stringify({
    requirementId,
    policy: "remove_exact_final_byte",
    facts: {
      originalBase64: Buffer.from("x\n").toString("base64"),
      candidateBase64: Buffer.from("x").toString("base64"),
      outcome: "threw",
    },
  })}`;
}
