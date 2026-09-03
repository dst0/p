import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
} from "./task-verification-evidence-test-harness.ts";

const EXACT_LOG_CONTRACT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must always reject any truncation or extra data.",
  "",
].join("\n");

describe("evidence-mode critical proof source safety", () => {
  it("discovers a prompt-authoritative critical boundary before the first mutation", async () => {
    const cwd = createRepository({ "FORMAT.md": EXACT_LOG_CONTRACT });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Implement the persistence contract from FORMAT.md.", 100);
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(1);
      expect(await recordChecklist(harness.controller)).toContain("append");
      expect(
        (await beforeEvidenceTool(harness.agent, "write", { path: "src/store.ts", content: "export {};\n" }))?.block,
      ).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("matches an absolute case-only source alias by safe file identity", async () => {
    const cwd = createRepository({ "README.md": "# Contract\n\nPreserve configured records.\n" });
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(harness, "Implement the persistence contract from README.md.", 100);
      expect(harness.controller.currentState.criticalProofObligations).toEqual([]);
      const aliasPath = join(cwd, "readme.md");
      if (!existsSync(aliasPath)) return;
      writeFileSync(join(cwd, "README.md"), EXACT_LOG_CONTRACT);
      await afterEvidenceTool(harness.agent, "read", { path: aliasPath }, EXACT_LOG_CONTRACT);
      expect(harness.controller.currentState.criticalProofObligations).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(["symlink", "hardlink"] as const)(
    "blocks unsafe prompt-referenced %s sources until safe reread or deauthorization",
    async (linkKind) => {
      const cwd = createLinkedRepository(linkKind);
      const sourcePath = linkKind === "symlink" ? "SYMLINK.md" : "HARDLINK.md";
      const harness = createEvidenceHarness(cwd);
      try {
        await sendPrompt(harness, `Implement the persistence contract from ${sourcePath}.`, 100);
        expect(harness.controller.currentState.criticalProofDiscoveryFailures).toHaveLength(1);
        expect(harness.controller.formatNextRequirement()).toContain("Critical proof discovery is blocked");
        const observed = await afterEvidenceTool(harness.agent, "read", { path: sourcePath }, EXACT_LOG_CONTRACT);
        expect(observed).toContain("Critical proof discovery is blocked");
        expect(harness.controller.currentState.criticalProofDiscoveryFailures).toHaveLength(1);
        expect(await recordChecklist(harness.controller)).toContain("Critical proof discovery is blocked");

        const restored = createEvidenceHarness(cwd, harness.sessionManager);
        expect(restored.controller.restoreError).toBeUndefined();
        expect(restored.controller.currentState.criticalProofDiscoveryFailures).toHaveLength(1);
        expect(await recordChecklist(restored.controller)).toContain("Critical proof discovery is blocked");
        expect(
          (await beforeEvidenceTool(restored.agent, "write", { path: "src/store.ts", content: "export {};\n" }))
            ?.reason,
        ).toContain("Critical proof discovery is blocked");

        rmSync(join(cwd, sourcePath));
        writeFileSync(join(cwd, sourcePath), EXACT_LOG_CONTRACT);
        const resolved = await afterEvidenceTool(restored.agent, "read", { path: sourcePath }, EXACT_LOG_CONTRACT);
        expect(resolved).toContain("bounded critical proof boundary changed");
        expect(restored.controller.currentState.criticalProofDiscoveryFailures).toBeUndefined();
        expect(restored.controller.currentState.criticalProofObligations).toHaveLength(1);

        await sendPrompt(restored, `Do not use ${sourcePath} as a requirement source.`, 101);
        expect(restored.controller.currentState.criticalProofObligations).toEqual([]);
        expect(await recordChecklist(restored.controller)).toContain("Completion checklist recorded");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );
});

function createRepository(files: Readonly<Record<string, string>>): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-evidence-critical-proof-source-safety-"));
  mkdirSync(join(cwd, "src"));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
  initializeRepository(cwd);
  return cwd;
}

function createLinkedRepository(linkKind: "symlink" | "hardlink"): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-evidence-critical-proof-source-safety-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "REAL.md"), EXACT_LOG_CONTRACT);
  const sourcePath = linkKind === "symlink" ? "SYMLINK.md" : "HARDLINK.md";
  if (linkKind === "symlink") symlinkSync("REAL.md", join(cwd, sourcePath));
  else linkSync(join(cwd, "REAL.md"), join(cwd, sourcePath));
  initializeRepository(cwd);
  return cwd;
}

function initializeRepository(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
  execFileSync("git", ["config", "gc.auto", "0"], { cwd });
  execFileSync("git", ["config", "gc.autoDetach", "false"], { cwd });
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
    cwd,
  });
}

async function sendPrompt(harness: ReturnType<typeof createEvidenceHarness>, content: string, timestamp: number) {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}

function recordChecklist(controller: TaskVerificationController) {
  return callEvidenceVerification(controller, {
    action: "record_completion_checklist",
    completion_checklist: ["Export emits deterministic newline-terminated JSONL"],
  });
}
