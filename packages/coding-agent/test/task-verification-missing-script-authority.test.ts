import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
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
  const workspace = mkdtempSync(join(tmpdir(), "p-missing-script-authority-"));
  temporaryWorkspaces.push(workspace);
  writeFileSync(join(workspace, "package.json"), `${JSON.stringify(scripts ? { scripts } : {})}\n`);
  return workspace;
}

async function createMutatedFeature(workspace: string) {
  const harness = createRequirementAuditHarness(SessionManager.inMemory(workspace));
  await callTaskVerification(harness.controller, {
    action: "declare_task",
    task_kind: "feature",
    task_summary: "Implement and verify the requested behavior",
  });
  await recordProductionMutationForTest(harness);
  return harness;
}

async function recordMissingScript(workspace: string, command: string, text: string, isError = true) {
  const harness = await createMutatedFeature(workspace);
  const evidenceRef = auditEvidenceHandle(
    await recordAuditToolResult(harness.agent, "bash", { command }, { isError, text }),
  );
  return { evidence: harness.controller.evidence.get(evidenceRef)!, harness };
}

describe("missing package script authority", () => {
  it("keeps a declared script failure even when the diagnostic cleanly claims it is missing", async () => {
    const { harness } = await recordMissingScript(
      createWorkspace({ "test:unit": "vitest --run" }),
      "npm run test:unit",
      'npm error Missing script: "test:unit"',
    );

    expect(harness.controller.latestFailedVerificationEvidence()).toHaveLength(1);
  });

  it("keeps a failure when the diagnostic names a different script", async () => {
    const { harness } = await recordMissingScript(
      createWorkspace(),
      "npm run test:unit",
      'npm error Missing script: "test:other"',
    );

    expect(harness.controller.latestFailedVerificationEvidence()).toHaveLength(1);
  });

  it("does not trust a relative executable whose basename resembles a package manager", async () => {
    const { harness } = await recordMissingScript(
      createWorkspace(),
      "./npm run test:unit",
      'npm error Missing script: "test:unit"',
    );

    expect(harness.controller.latestFailedVerificationEvidence()).toHaveLength(1);
  });

  it("forces a zero-exit missing-script result to remain unconfirmed and failed evidence", async () => {
    const { evidence } = await recordMissingScript(
      createWorkspace(),
      "npm run test:unit",
      'npm error Missing script: "test:unit"',
      false,
    );

    expect(evidence.isError).toBe(true);
    expect(evidence.testOutcome).toBe("unconfirmed");
    expect(evidence.verificationFailureKind).toBe("missing_test_script");
  });

  it("does not accept a stale positive footer after a zero-exit missing-script diagnostic", async () => {
    const { evidence, harness } = await recordMissingScript(
      createWorkspace(),
      "npm run test:unit",
      'npm error Missing script: "test:unit"\nTests: 45 passed',
      false,
    );

    expect(evidence.isError).toBe(true);
    expect(evidence.testOutcome).toBe("unconfirmed");
    expect(harness.controller.latestFailedVerificationEvidence()).toHaveLength(1);
  });

  it("uses the selected literal-cd manifest rather than the root manifest", async () => {
    const workspace = createWorkspace();
    const child = join(workspace, "packages", "app");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, "package.json"), '{"scripts":{"test:unit":"vitest --run"}}\n');
    const { harness } = await recordMissingScript(
      workspace,
      "cd packages/app && npm run test:unit",
      'npm error Missing script: "test:unit"',
    );

    expect(harness.controller.latestFailedVerificationEvidence()).toHaveLength(1);
  });

  it.each(["npm run test:unit --workspace app", "npm run test:unit -- --changed"])(
    "fails closed for unmodeled package-manager arguments: %s",
    async (command) => {
      const workspace = createWorkspace();
      const child = join(workspace, "app");
      mkdirSync(child);
      writeFileSync(join(child, "package.json"), '{"scripts":{"test:unit":"vitest --run"}}\n');
      const { harness } = await recordMissingScript(workspace, command, 'npm error Missing script: "test:unit"');

      expect(harness.controller.latestFailedVerificationEvidence()).toHaveLength(1);
    },
  );
});
