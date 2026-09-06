import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frozenSourceOutputRestoreError } from "../src/core/task-verification/critical-proof-source-output-revalidation.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const SOURCE_TEXT = "Preserve stable behavior.\n";
const CRITICAL_SOURCE_TEXT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must reject removal of only the final LF byte.",
  "",
].join("\n");

describe("authoritative source-output authorization hardening", () => {
  it("requires the current direct prompt to authorize mutating every output path", async () => {
    const cwd = createRepository(["SPEC.md"]);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(harness, "Implement behavior according to SPEC.md, but do not modify SPEC.md.", 100);
      expect(await declare(harness, ["SPEC.md"], ["SPEC.md"])).toContain("[source-output:SPEC.md]");

      await prompt(harness, "Implement another validation behavior without changing the specification.", 200);
      expect(await declare(harness, undefined, ["SPEC.md"])).toContain("[source-output:SPEC.md]");

      await prompt(harness, "Реализуй требования из SPEC.md и измени сам SPEC.md.\n[source-output:SPEC.md]", 300);
      expect(await declare(harness, ["SPEC.md"], ["SPEC.md"])).toMatch(/(?:recorded|already recorded)/u);
      expect(harness.controller.currentState.criticalProofSourceOutputs).toContainEqual(
        expect.objectContaining({ sourcePath: "SPEC.md", authorizedAtPromptId: expect.any(String) }),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("binds each output path to a user-authored marker and its own checklist item", async () => {
    const cwd = createRepository(["README.md", "SPEC.md"]);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(harness, "Edit README.md according to the authority in SPEC.md.", 100);
      expect(await declare(harness, ["SPEC.md"], ["SPEC.md"], ["SPEC.md is the requested source output"])).toContain(
        "[source-output:SPEC.md]",
      );

      await prompt(harness, "حرّر SPEC.md نفسه وفقًا للمتطلبات.\n[source-output:SPEC.md]", 200);
      expect(await declare(harness, ["SPEC.md"], ["SPEC.md"])).toMatch(/(?:recorded|already recorded)/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects marker-only, quoted, fenced, stale, and noncanonical authorization", async () => {
    const rejectedPrompts = [
      "Edit SPEC.md itself.\n> [source-output:SPEC.md]",
      "Edit SPEC.md itself.\n```text\n[source-output:SPEC.md]\n```",
      "Edit SPEC.md itself.\n[source-output:./SPEC.md]",
      "Edit SPEC.md itself.\n[source-output:SPEC.md] trailing text",
    ];
    for (const [index, content] of rejectedPrompts.entries()) {
      const cwd = createRepository(["SPEC.md"]);
      const harness = createEvidenceHarness(cwd);
      try {
        await prompt(harness, content, 100 + index);
        expect(await declare(harness, ["SPEC.md"], ["SPEC.md"])).toContain("[source-output:SPEC.md]");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }

    const markerOnlyCwd = createRepository(["SPEC.md"]);
    const markerOnlyHarness = createEvidenceHarness(markerOnlyCwd);
    try {
      await prompt(markerOnlyHarness, "Use SPEC.md as the authoritative source.", 100);
      expect(await declare(markerOnlyHarness, ["SPEC.md"])).toContain("recorded");
      await prompt(markerOnlyHarness, "Please perform the requested change.\n[source-output:SPEC.md]", 200);
      expect(await declare(markerOnlyHarness, undefined, ["SPEC.md"])).toContain("[source-output:SPEC.md]");
    } finally {
      rmSync(markerOnlyCwd, { recursive: true, force: true });
    }

    const cwd = createRepository(["SPEC.md"]);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(harness, "Edit SPEC.md itself.\n[source-output:SPEC.md]", 200);
      expect(await declare(harness, ["SPEC.md"], ["SPEC.md"])).toContain("recorded");
      const originalOutput = harness.controller.currentState.criticalProofSourceOutputs?.[0];
      await prompt(harness, "Continue with the requested change to SPEC.md.", 300);
      expect(frozenSourceOutputRestoreError(harness.controller)).toContain("latest direct user prompt");
      const restoredHarness = createEvidenceHarness(cwd, harness.sessionManager);
      expect(restoredHarness.controller.restoreError).toContain("latest direct user prompt");
      const editArgs = { path: "SPEC.md", edits: [{ oldText: SOURCE_TEXT, newText: "Changed.\n" }] };
      expect(
        (await beforeEvidenceTool(restoredHarness.agent, "edit", editArgs, evidenceToolCall("edit", editArgs)))?.reason,
      ).toContain("latest direct user prompt");

      await prompt(restoredHarness, "Продолжи изменять SPEC.md.\n[source-output:SPEC.md]", 400);
      expect(await declare(restoredHarness, undefined, ["SPEC.md"])).toContain("recorded");
      const reboundOutput = restoredHarness.controller.currentState.criticalProofSourceOutputs?.[0];
      expect(reboundOutput?.authorizedAtPromptId).not.toBe(originalOutput?.authorizedAtPromptId);
      expect(reboundOutput?.baselineState).toBe(originalOutput?.baselineState);
      expect(reboundOutput?.criticalDomains).toEqual(originalOutput?.criticalDomains);
      expect(restoredHarness.controller.restoreError).toBeUndefined();
      expect(
        (await beforeEvidenceTool(restoredHarness.agent, "edit", editArgs, evidenceToolCall("edit", editArgs)))?.block,
      ).not.toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("allows three outputs per call and eight cumulatively", async () => {
    const paths = Array.from({ length: 8 }, (_, index) => `SPEC-${index + 1}.md`);
    const cwd = createRepository(paths);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(
        harness,
        `Edit each requested source output: ${paths.join(", ")}.\n${paths.map((path) => `[source-output:${path}]`).join("\n")}`,
        100,
      );
      for (const batch of [paths.slice(0, 3), paths.slice(3, 6), paths.slice(6, 8)]) {
        expect(await declare(harness, batch, batch, outputCriteria(paths))).toMatch(/(?:recorded|already recorded)/u);
      }
      expect(harness.controller.currentState.criticalProofSourceOutputs).toHaveLength(8);
      expect(createTaskVerificationController(harness.sessionManager, "evidence").restoreError).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("restores a non-runtime critical-looking source output without runtime proof debt", async () => {
    const cwd = createRepository(["FORMAT.md"], CRITICAL_SOURCE_TEXT);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(harness, "حدّث مستند FORMAT.md نفسه.\n[source-output:FORMAT.md]", 100);
      expect(await declare(harness, ["FORMAT.md"], ["FORMAT.md"], undefined, "non_runtime_content")).toContain(
        "recorded",
      );
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      expect(createTaskVerificationController(harness.sessionManager, "evidence").restoreError).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("revalidates zero-domain frozen outputs before readiness and restore", async () => {
    const cwd = createRepository(["SPEC.md"]);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(harness, "Use SPEC.md as the source and edit SPEC.md itself.\n[source-output:SPEC.md]", 100);
      expect(await declare(harness, ["SPEC.md"], ["SPEC.md"])).toContain("recorded");
      writeFileSync(join(cwd, "SPEC.md"), "External race before tracked mutation.\n");

      expect(frozenSourceOutputRestoreError(harness.controller)).toContain(
        "changed before its requested task mutation was recorded",
      );
      expect(createTaskVerificationController(harness.sessionManager, "evidence").restoreError).toContain(
        "changed before its requested task mutation was recorded",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("preserves ordinary authoritative-source revalidation during restore", async () => {
    const cwd = createRepository(["FORMAT.md"], CRITICAL_SOURCE_TEXT);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(harness, "Implement the behavior required by FORMAT.md without editing that source.", 100);
      expect(await declare(harness, ["FORMAT.md"])).toContain("append");
      writeFileSync(join(cwd, "FORMAT.md"), `${CRITICAL_SOURCE_TEXT}Changed externally.\n`);

      expect(createTaskVerificationController(harness.sessionManager, "evidence").restoreError).toContain(
        "changed after its critical proof boundary was recorded",
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects missing frozen obligations and keeps retained output valid after reselection", async () => {
    const cwd = createRepository(["FORMAT.md"], CRITICAL_SOURCE_TEXT);
    const harness = createEvidenceHarness(cwd);
    try {
      await prompt(
        harness,
        "Implement the behavior required by FORMAT.md and edit FORMAT.md itself.\n[source-output:FORMAT.md]",
        100,
      );
      expect(await declare(harness, ["FORMAT.md"], ["FORMAT.md"])).toContain("append");
      const originalAuthorization =
        harness.controller.currentState.criticalProofSourceOutputs?.[0]?.authorizedAtPromptId;

      await prompt(
        harness,
        "Continue using FORMAT.md and edit FORMAT.md itself to add clarification.\n[source-output:FORMAT.md]",
        200,
      );
      expect(await declare(harness, undefined, ["FORMAT.md"])).toContain("append");
      expect(harness.controller.currentState.criticalProofSourceOutputs?.[0]?.authorizedAtPromptId).not.toBe(
        originalAuthorization,
      );
      expect(createTaskVerificationController(harness.sessionManager, "evidence").restoreError).toBeUndefined();

      harness.controller.state = { ...harness.controller.state, criticalProofObligations: undefined };
      expect(frozenSourceOutputRestoreError(harness.controller)).toContain("missing its frozen critical obligation");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(paths: readonly string[], text = SOURCE_TEXT): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-source-output-authorization-"));
  for (const path of paths) writeFileSync(join(cwd, path), text);
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

async function prompt(harness: ReturnType<typeof createEvidenceHarness>, content: string, timestamp: number) {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}

async function declare(
  harness: ReturnType<typeof createEvidenceHarness>,
  authoritativeSourcePaths?: string[],
  sourceOutputPaths?: string[],
  completionChecklist = outputCriteria(sourceOutputPaths ?? []),
  verificationScope?: "runtime_behavior" | "non_runtime_content" | "external_operation",
): Promise<string> {
  return callEvidenceVerification(harness.controller, {
    action: "record_completion_checklist",
    ...(authoritativeSourcePaths ? { authoritative_source_paths: authoritativeSourcePaths } : {}),
    ...(sourceOutputPaths ? { source_output_paths: sourceOutputPaths } : {}),
    ...(verificationScope ? { verification_scope: verificationScope } : {}),
    completion_checklist:
      completionChecklist.length > 0
        ? completionChecklist
        : ["The requested behavior matches the current user request"],
  });
}

function outputCriteria(paths: readonly string[]): string[] {
  return paths.map((path) => `${path} is the requested source output`);
}
