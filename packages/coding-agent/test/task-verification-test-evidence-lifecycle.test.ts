import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE } from "../src/core/task-verification.ts";
import {
  auditEvidenceHandle,
  callTaskVerification,
  createRequirementAuditHarness,
  recordAuditToolResult,
  recordProductionMutationForTest,
} from "./task-requirement-audit-test-harness.ts";

const temporaryWorkspaces: string[] = [];

afterEach(() => {
  for (const workspace of temporaryWorkspaces.splice(0)) rmSync(workspace, { force: true, recursive: true });
});

function createWorkspace(scripts?: Record<string, string>): string {
  const workspace = mkdtempSync(join(tmpdir(), "p-test-evidence-"));
  temporaryWorkspaces.push(workspace);
  writeFileSync(join(workspace, "package.json"), `${JSON.stringify(scripts ? { scripts } : {})}\n`);
  return workspace;
}

function createWorkspaceWithoutManifest(): string {
  const workspace = mkdtempSync(join(tmpdir(), "p-test-evidence-"));
  temporaryWorkspaces.push(workspace);
  return workspace;
}

async function createMutatedFeature(workspace?: string) {
  const harness = createRequirementAuditHarness(
    workspace === undefined ? undefined : SessionManager.inMemory(workspace),
  );
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Implement and verify the requested behavior",
  });
  await recordProductionMutationForTest(harness);
  return harness;
}

async function passingNodeEvidence(harness: ReturnType<typeof createRequirementAuditHarness>): Promise<string> {
  return auditEvidenceHandle(
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "node --test test/behavior.test.ts" },
      { text: "ℹ pass 3\nℹ fail 0" },
    ),
  );
}

describe("test evidence lifecycle", () => {
  it.each([
    ["npm run test:unit", 'npm error Missing script: "test:unit"'],
    ["pnpm run test:unit", "ERR_PNPM_NO_SCRIPT Missing script: test:unit"],
    ["yarn run test:unit", 'error Command "test:unit" not found.'],
    ["bun run test:unit", 'error: Script not found "test:unit"'],
  ])("does not persist an unlaunchable package script as an implementation test failure: %s", async (command, text) => {
    const harness = await createMutatedFeature(createWorkspace());
    await recordAuditToolResult(harness.agent, "bash", { command }, { isError: true, text });
    await passingNodeEvidence(harness);

    expect(harness.controller.latestFailedVerificationEvidence()).toEqual([]);
  });

  it("guides the agent to an applicable declared script without suggesting a configuration mutation", async () => {
    const harness = await createMutatedFeature(createWorkspace());
    const result = await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: 'npm error Missing script: "test:unit"' },
    );

    expect(result).toContain("no tests ran");
    expect(result).toContain("Inspect the active package's declared scripts");
    expect(result).toContain("do not add a script alias solely to clear verification");
  });

  it("keeps a genuine assertion failure even when its output mentions a missing script", async () => {
    const harness = await createMutatedFeature(createWorkspace());
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: 'npm error Missing script: "test:unit"\nAssertionError: expected true\n1 test failed' },
    );
    await recordAuditToolResult(harness.agent, "bash", { command: "pytest" }, { text: "3 passed in 0.05s" });

    expect(harness.controller.latestFailedVerificationEvidence().map((evidence) => evidence.descriptor)).toEqual([
      "npm run test:unit",
    ]);
  });

  it.each([
    "TypeError: boom",
    "SyntaxError: bad token",
    "AggregateError: multiple failures",
    "URIError: malformed URI",
    "ERR_MODULE_NOT_FOUND",
    "Command timed out",
    "deadline exceeded",
    "Process terminated by SIGTERM",
    "Process crashed with SIGSEGV",
    "Process closed on SIGPIPE",
  ])("keeps an independent failure when output also contains a missing-script diagnostic: %s", async (failure) => {
    const harness = await createMutatedFeature(createWorkspace());
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: `npm error Missing script: "test:unit"\n${failure}` },
    );

    expect(harness.controller.latestFailedVerificationEvidence().map((evidence) => evidence.descriptor)).toEqual([
      "npm run test:unit",
    ]);
  });

  it.each([
    ["missing package.json", () => createWorkspaceWithoutManifest()],
    [
      "invalid package.json",
      () => {
        const workspace = createWorkspace();
        writeFileSync(join(workspace, "package.json"), "{invalid\n");
        return workspace;
      },
    ],
  ])("fails closed when script absence cannot be proved from %s", async (_label, workspaceFactory) => {
    const harness = await createMutatedFeature(workspaceFactory());
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: 'npm error Missing script: "test:unit"' },
    );

    expect(harness.controller.latestFailedVerificationEvidence().map((evidence) => evidence.descriptor)).toEqual([
      "npm run test:unit",
    ]);
  });

  it("resolves a literal cd before checking the package manifest", async () => {
    const workspace = createWorkspace({ "test:unit": "vitest --run" });
    const packageDirectory = join(workspace, "packages", "app");
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "package.json"), "{}\n");
    const harness = await createMutatedFeature(workspace);
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "cd packages/app && npm run test:unit" },
      { isError: true, text: 'npm error Missing script: "test:unit"' },
    );

    expect(harness.controller.latestFailedVerificationEvidence()).toEqual([]);
  });

  it("does not treat bun's native test runner as a missing package script", async () => {
    const harness = await createMutatedFeature(createWorkspace());
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "bun test" },
      { isError: true, text: 'error: Script not found "test"' },
    );

    expect(harness.controller.latestFailedVerificationEvidence().map((evidence) => evidence.descriptor)).toEqual([
      "bun test",
    ]);
  });

  it("keeps an ordinary nonzero test failure blocking", async () => {
    const harness = await createMutatedFeature();
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: "Tests: 1 failed, 2 passed" },
    );
    await recordAuditToolResult(harness.agent, "bash", { command: "pytest" }, { text: "3 passed in 0.05s" });

    expect(harness.controller.latestFailedVerificationEvidence().map((evidence) => evidence.descriptor)).toEqual([
      "npm run test:unit",
    ]);
  });

  it("does not accept an unlaunchable script as successful semantic evidence", async () => {
    const harness = await createMutatedFeature(createWorkspace());
    const launchFailure = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "npm run test:unit" },
        { isError: true, text: 'npm error Missing script: "test:unit"' },
      ),
    );

    const result = await callTaskVerification(harness.controller, {
      action: "record_final",
      final_method: "focused_test",
      final_status: "passed",
      expected_behavior: "The behavior passes its tests",
      observed_behavior: "The requested script did not launch",
      evidence_refs: [launchFailure],
      unresolved_failures: [],
    });
    expect(result).toContain("failed evidence");
  });

  it("uses a positive test footer beyond the persisted display summary", async () => {
    const harness = await createMutatedFeature();
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: "Tests: 1 failed" },
    );
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm test" },
      { text: `${"passing test details\n".repeat(40)}Tests: 45 passed` },
    );

    expect(harness.controller.latestFailedVerificationEvidence()).toEqual([]);
    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.latestFailedVerificationEvidence()).toEqual([]);
    expect([...restored.controller.evidence.values()].at(-1)?.testOutcome).toBe("passed");
  });

  it("restores legacy evidence that predates structured test outcome fields", async () => {
    const harness = await createMutatedFeature();
    const evidenceRef = await passingNodeEvidence(harness);
    const legacyEvidence = { ...harness.controller.evidence.get(evidenceRef)! };
    delete legacyEvidence.testOutcome;
    delete legacyEvidence.verificationFailureKind;
    harness.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, legacyEvidence);

    const restored = createRequirementAuditHarness(harness.sessionManager);
    expect(restored.controller.evidence.get(evidenceRef)?.testOutcome).toBeUndefined();
    expect(restored.controller.latestFailedVerificationEvidence()).toEqual([]);
  });

  it("does not treat a long mixed-result footer as a passing suite", async () => {
    const harness = await createMutatedFeature();
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm run test:unit" },
      { isError: true, text: "Tests: 1 failed" },
    );
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command: "npm test" },
      { text: `${"test details\n".repeat(50)}Tests: 45 passed\nTests: 1 failed` },
    );
    await recordAuditToolResult(harness.agent, "bash", { command: "pytest" }, { text: "3 passed in 0.05s" });

    expect(harness.controller.latestFailedVerificationEvidence().map((evidence) => evidence.descriptor)).toEqual([
      "npm run test:unit",
    ]);
  });
});
