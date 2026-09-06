import { describe, expect, it } from "vitest";
import { focusedTestInvocation } from "../src/core/task-verification/taskverificationcontroller-methods/test-command-invocation.ts";
import {
  testInvocationCovers,
  testInvocationSelection,
} from "../src/core/task-verification/taskverificationcontroller-methods/test-invocation-selection.ts";
import {
  auditEvidenceHandle,
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
  recordProductionMutationForTest,
} from "./task-requirement-audit-test-harness.ts";

async function createMutatedFeature(summary: string) {
  const harness = createRequirementAuditHarness();
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: summary,
  });
  await recordProductionMutationForTest(harness);
  return harness;
}

async function readiness(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  evidenceRefs: string[],
): Promise<string> {
  return callTaskVerification(harness.controller, {
    action: "ready_to_finish",
    acceptance_checks: [{ criterion: "The requested behavior is verified", evidence_refs: evidenceRefs }],
    unresolved_failures: [],
  });
}

describe("failed verification supersession", () => {
  it("recognizes a safe test-directory glob as covering a focused test file", () => {
    const focused = focusedTestInvocation(
      "cd /workspace && node ../../node_modules/vitest/dist/cli.js --run test/edge-cases.test.ts",
    );
    const suite = focusedTestInvocation("cd /workspace && node --import tsx --test test/*.test.ts");

    expect(focused).toBeDefined();
    expect(suite).toBeDefined();
    expect(testInvocationSelection(suite!)).toMatchObject({ pathGlobs: ["test/*.test.ts"], vacuous: false });
    expect(testInvocationCovers(suite!, focused!)).toBe(true);
  });

  it("does not let a bare-name Cargo filter cover a full Rust test file", () => {
    const fullFile = focusedTestInvocation("cargo test tests/integration.rs");
    const filtered = focusedTestInvocation("cargo test tests/integration.rs specific_test");

    expect(fullFile).toBeDefined();
    expect(filtered).toBeDefined();
    expect(testInvocationSelection(filtered!)).toMatchObject({ testNames: ["specific_test"] });
    expect(testInvocationCovers(filtered!, fullFile!)).toBe(false);
  });

  it("does not classify a failed test-runner discovery command as failed verification", async () => {
    const harness = await createMutatedFeature("Implement and verify the parser behavior");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: 'find node_modules/vitest -name "cli.js" -print -quit' },
      { isError: true, text: "" },
    );
    const passingTest = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/parser.test.ts" },
        { text: "ℹ pass 3\nℹ fail 0" },
      ),
    );

    expect(await readiness(harness, [passingTest])).toContain("Evidence readiness passed");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: 'find node_modules/vitest -name "cli.js" -print -quit' },
      { isError: true, text: "" },
    );
    expect(harness.controller.currentState.readiness?.status).toBe("evidence_ready");
    expect(harness.controller.latestFailedVerificationEvidence()).toEqual([]);
  });

  it("accepts a later passing glob suite that covers an earlier failed focused launch", async () => {
    const harness = await createMutatedFeature("Implement and verify all inventory edge cases");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      {
        command: "cd /workspace && node ../../node_modules/vitest/dist/cli.js --run test/edge-cases.test.ts",
      },
      { isError: true, text: "Error: Cannot find module '../../node_modules/vitest/dist/cli.js'" },
    );
    const suiteEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "cd /workspace && node --import tsx --test test/*.test.ts" },
        { text: "ℹ pass 7\nℹ fail 0" },
      ),
    );
    const finalEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/persistence.test.ts" },
        { text: "ℹ pass 2\nℹ fail 0" },
      ),
    );

    expect(await readiness(harness, [suiteEvidence, finalEvidence])).toContain("Evidence readiness passed");
  });

  it("keeps a real focused failure when only an unrelated focused test later passes", async () => {
    const harness = await createMutatedFeature("Implement inventory persistence and edge-case behavior");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "node --test test/edge-cases.test.ts" },
      { isError: true, text: "ℹ pass 1\nℹ fail 1" },
    );
    const unrelatedEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/persistence.test.ts" },
        { text: "ℹ pass 2\nℹ fail 0" },
      ),
    );

    const result = await readiness(harness, [unrelatedEvidence]);
    expect(result).toContain("latest execution still failed");
    expect(result).toContain("node --test test/edge-cases.test.ts");
  });

  it("does not let a name-filtered glob clear a full-file failure", async () => {
    const harness = await createMutatedFeature("Implement every edge-case behavior");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "node --test test/edge-cases.test.ts" },
      { isError: true, text: "ℹ pass 1\nℹ fail 1" },
    );
    const filteredEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test --test-name-pattern=unrelated test/*.test.ts" },
        { text: "ℹ pass 1\nℹ fail 0" },
      ),
    );

    const result = await readiness(harness, [filteredEvidence]);
    expect(result).toContain("latest execution still failed");
    expect(result).toContain("node --test test/edge-cases.test.ts");
  });

  it("does not let a zero-pass exact rerun clear a genuine failure", async () => {
    const harness = await createMutatedFeature("Implement every edge-case behavior");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "node --test test/edge-cases.test.ts" },
      { isError: true, text: "ℹ pass 0\nℹ fail 1" },
    );
    const vacuousEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/edge-cases.test.ts" },
        { text: "ℹ pass 0\nℹ fail 0\nℹ skipped 1" },
      ),
    );
    const finalEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/persistence.test.ts" },
        { text: "ℹ pass 2\nℹ fail 0" },
      ),
    );

    expect(await readiness(harness, [vacuousEvidence, finalEvidence])).toContain("latest execution still failed");
  });

  it("does not let a broad test in another language clear a Node test failure", async () => {
    const harness = await createMutatedFeature("Implement polyglot inventory behavior");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "node --test test/edge-cases.test.ts" },
      { isError: true, text: "ℹ pass 0\nℹ fail 1" },
    );
    const pythonEvidence = auditEvidenceHandle(
      await recordAuditToolResult(harness.agent, "bash", { command: "pytest" }, { text: "1 passed in 0.05s" }),
    );
    const finalEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node --test test/persistence.test.ts" },
        { text: "ℹ pass 2\nℹ fail 0" },
      ),
    );

    expect(await readiness(harness, [pythonEvidence, finalEvidence])).toContain("latest execution still failed");
  });

  it("does not match relative test paths across different working directories", async () => {
    const harness = await createMutatedFeature("Implement both package edge-case behaviors");
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "cd packages/pkg-a && node --test test/edge-cases.test.ts" },
      { isError: true, text: "ℹ pass 0\nℹ fail 1" },
    );
    const otherPackageSuite = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "cd packages/pkg-b && node --test test/*.test.ts" },
        { text: "ℹ pass 5\nℹ fail 0" },
      ),
    );
    const finalEvidence = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "cd packages/pkg-b && node --test test/persistence.test.ts" },
        { text: "ℹ pass 2\nℹ fail 0" },
      ),
    );

    expect(await readiness(harness, [otherPackageSuite, finalEvidence])).toContain("latest execution still failed");
  });
});
