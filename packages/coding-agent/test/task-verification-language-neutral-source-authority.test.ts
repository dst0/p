import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  afterEvidenceTool as afterTool,
  callEvidenceVerification,
  createEvidenceHarness as createHarness,
} from "./task-verification-evidence-test-harness.ts";

function createGitFixture(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  return cwd;
}

describe("language-neutral requirement-source authority", () => {
  it("does not treat a Russian output-path request as an unresolved authoritative source", async () => {
    const cwd = createGitFixture("p-russian-output-source-");
    const existingOutput = [
      "Event logs are newline-terminated JSONL.",
      "Import rejects removal of only the final LF byte.",
      "",
    ].join("\n");
    writeFileSync(join(cwd, "report.md"), existingOutput);
    execFileSync("git", ["add", "report.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Создай report.md с итоговым отчётом.", timestamp: 100 },
      });
      await afterTool(harness.agent, "read", { path: "report.md" }, existingOutput);

      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      expect(harness.controller.currentState.criticalProofDiscoveryFailures).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("adopts a referenced pre-existing source only through explicit model selection", async () => {
    const cwd = createGitFixture("p-russian-observed-source-");
    const specification = [
      "Event logs are newline-terminated JSONL.",
      "Import rejects removal of only the final LF byte.",
      "",
    ].join("\n");
    writeFileSync(join(cwd, "SPEC.md"), specification);
    execFileSync("git", ["add", "SPEC.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Реализуй требования из SPEC.md.", timestamp: 100 },
      });
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);

      await afterTool(harness.agent, "read", { path: "SPEC.md" }, specification);
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["Event log preserves the requested records"],
        }),
      ).toContain("append");

      expect(harness.controller.currentState.criticalProofObligations).toEqual([
        expect.objectContaining({ sourcePath: "SPEC.md", artifactDomain: "event-log" }),
      ]);
      expect(harness.controller.currentState.criticalProofDiscoveryFailures).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("uses explicit model selection for non-English de-authorization and reauthorization", async () => {
    const cwd = createGitFixture("p-russian-source-lifecycle-");
    const specification = [
      "Event logs are newline-terminated JSONL.",
      "Import rejects removal of only the final LF byte.",
      "",
    ].join("\n");
    writeFileSync(join(cwd, "SPEC.md"), specification);
    execFileSync("git", ["add", "SPEC.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Реализуй требования из SPEC.md.", timestamp: 100 },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        authoritative_source_paths: ["SPEC.md"],
        completion_checklist: [
          "Event log rejects inputs missing exactly the terminal LF byte after newline-terminated serialization",
        ],
      });
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(1);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          deauthorized_source_paths: ["SPEC.md"],
          completion_checklist: [
            "Event log rejects inputs missing exactly the terminal LF byte after newline-terminated serialization",
          ],
        }),
      ).toContain("requires a later direct user prompt");

      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "SPEC.md больше не является источником требований.", timestamp: 200 },
      });
      unlinkSync(join(cwd, "SPEC.md"));
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          deauthorized_source_paths: ["SPEC.md"],
          completion_checklist: ["Implementation preserves the requested behavior"],
        }),
      ).toContain("recorded");
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);

      writeFileSync(join(cwd, "SPEC.md"), specification);
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Снова используй SPEC.md как требования.", timestamp: 300 },
      });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          authoritative_source_paths: ["SPEC.md"],
          completion_checklist: ["Implementation preserves the requested behavior"],
        }),
      ).toContain("append");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("retains zero-domain source identity so a later instruction can de-authorize it", async () => {
    const cwd = createGitFixture("p-zero-domain-source-");
    writeFileSync(join(cwd, "GUIDE.md"), "Preserve stable user-visible behavior.\n");
    execFileSync("git", ["add", "GUIDE.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Выполни GUIDE.md.", timestamp: 100 },
      });
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        authoritative_source_paths: ["GUIDE.md"],
        completion_checklist: ["User-visible behavior remains stable"],
      });
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      expect(harness.controller.currentState.criticalProofSourceSelections).toEqual([
        {
          sourcePath: "GUIDE.md",
          selectedAtPromptId: expect.any(String),
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      ]);

      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "GUIDE.md больше не является источником требований.", timestamp: 200 },
      });
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          deauthorized_source_paths: ["GUIDE.md"],
          completion_checklist: ["User-visible behavior remains stable"],
        }),
      ).toContain("recorded");
      expect(harness.controller.currentState.criticalProofSourceSelections).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
