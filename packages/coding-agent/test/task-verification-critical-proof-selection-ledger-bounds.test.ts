import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeRequirementSourceCandidateCatalog,
  referencedRequirementCandidateCatalog,
  referencedRequirementCandidates,
} from "../src/core/task-verification/referenced-requirement-sources.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
} from "./task-verification-evidence-test-harness.ts";

const SOURCE_PATHS = Array.from({ length: 9 }, (_, index) => `SPEC-${index + 1}.md`);

describe("critical-proof selection ledger bounds", () => {
  it("returns eight candidates plus an explicit overflow signal", () => {
    const catalog = referencedRequirementCandidateCatalog([
      {
        id: "user-1",
        text: `参照ファイル: ${SOURCE_PATHS.join(", ")}`,
      },
    ]);
    expect(catalog.candidates).toHaveLength(8);
    expect(catalog.overflow).toBe(true);
    expect(referencedRequirementCandidates([{ id: "user-1", text: SOURCE_PATHS.join(", ") }])).toHaveLength(9);
  });

  it("still overflows when one de-authorization leaves nine active candidates", () => {
    const paths = Array.from({ length: 10 }, (_, index) => `SPEC-${index + 1}.md`);
    const prompts = [
      { id: "user-1", text: paths.join(", ") },
      { id: "user-2", text: "SPEC-10.md is excluded." },
    ];
    const catalog = activeRequirementSourceCandidateCatalog(prompts, ["SPEC-10.md"]);
    expect(catalog.candidates).toHaveLength(8);
    expect(catalog.overflow).toBe(true);
  });

  it("blocks a nine-source prompt without dropping the ninth requirement", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: `参照ファイル: ${SOURCE_PATHS.join(", ")}`,
          timestamp: 100,
        },
      });
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBe(true);
      expect(
        (await beforeEvidenceTool(harness.agent, "write", { path: "src/result.ts", content: "export {};\n" }))?.reason,
      ).toContain("authoritative source catalog exceeds its eight-source limit");
      const stateBeforeChecklist = structuredClone(harness.controller.currentState);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["The requested behavior remains stable"],
        }),
      ).toContain("More than 8 requirement-source candidates were referenced");
      expect(harness.controller.currentState).toEqual(stateBeforeChecklist);

      const restored = createTaskVerificationController(harness.sessionManager, "evidence");
      expect(restored.restoreError).toBeUndefined();
      expect(restored.currentState.criticalProofObligationOverflow).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("recovers after de-authorizing one source without dropping the newly exposed ninth source", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: `Implement according to ${SOURCE_PATHS.join(", ")}.`,
          timestamp: 100,
        },
      });
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBe(true);

      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "SPEC-1.md を要件ソースから除外します。",
          timestamp: 200,
        },
      });
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBe(true);
      expect(
        (await beforeEvidenceTool(harness.agent, "write", { path: "src/result.ts", content: "export {};\n" }))?.block,
      ).toBe(true);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          deauthorized_source_paths: ["SPEC-1.md"],
          completion_checklist: ["The requested behavior remains stable"],
        }),
      ).toContain("Completion checklist recorded");
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBeUndefined();
      expect(harness.controller.currentState.criticalProofDeauthorizedSourcePaths).toEqual(["SPEC-1.md"]);
      expect(harness.controller.currentState.criticalProofSourceSelections).toHaveLength(8);
      expect(harness.controller.currentState.criticalProofSourceSelections?.map((item) => item.sourcePath)).toEqual(
        SOURCE_PATHS.slice(1),
      );
      expect(
        (await beforeEvidenceTool(harness.agent, "write", { path: "src/result.ts", content: "export {};\n" }))?.block,
      ).not.toBe(true);

      const restored = createTaskVerificationController(harness.sessionManager, "evidence");
      expect(restored.restoreError).toBeUndefined();
      expect(restored.currentState.criticalProofObligationOverflow).toBeUndefined();
      expect(restored.currentState.criticalProofDeauthorizedSourcePaths).toEqual(["SPEC-1.md"]);
      expect(restored.currentState.criticalProofSourceSelections).toHaveLength(8);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects overflow recovery declared after a newer unrelated prompt", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: `参照ファイル: ${SOURCE_PATHS.join(", ")}`, timestamp: 100 },
      });
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "SPEC-9.md を要件ソースから除外します。",
          timestamp: 200,
        },
      });
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Also preserve deterministic output.", timestamp: 300 },
      });
      expect(harness.controller.currentState.criticalProofObligationOverflow).toBe(true);
      expect(
        (await beforeEvidenceTool(harness.agent, "write", { path: "src/result.ts", content: "export {};\n" }))?.block,
      ).toBe(true);
      const stateBeforeChecklist = structuredClone(harness.controller.currentState);
      expect(
        await callEvidenceVerification(harness.controller, {
          action: "record_completion_checklist",
          deauthorized_source_paths: ["SPEC-9.md"],
          completion_checklist: ["The requested behavior remains stable"],
        }),
      ).toContain("must be referenced in the latest direct user prompt");
      expect(harness.controller.currentState).toEqual(stateBeforeChecklist);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-critical-proof-selection-ledger-"));
  for (const sourcePath of SOURCE_PATHS) writeFileSync(join(cwd, sourcePath), "Preserve stable behavior.\n");
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
