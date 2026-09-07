import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callEvidenceVerification, createEvidenceHarness } from "./task-verification-evidence-test-harness.ts";

const EXACT_LOG_CONTRACT = [
  "Export deterministic newline-terminated JSONL.",
  "JSONL import must reject removal of only the final LF byte.",
  "",
].join("\n");

describe("critical-proof overflow deauthorization reconciliation", () => {
  it("restores an omitted selected obligation after deauthorizing a retained source", async () => {
    const cwd = createRepository();
    const harness = createEvidenceHarness(cwd);
    try {
      await sendPrompt(
        harness,
        [
          "Implement according to SPEC-1.md.",
          "Implement according to SPEC-2.md.",
          "Implement according to SPEC-3.md.",
          "Implement according to SPEC-4.md.",
          "Implement according to SPEC-5.md.",
        ].join(" "),
        100,
      );

      expect(harness.controller.currentState.criticalProofObligationOverflow).toBe(true);
      expect(harness.controller.currentState.criticalProofSourceSelections).toHaveLength(5);
      expect(obligationPaths(harness)).toContain("SPEC-1.md");
      expect(obligationPaths(harness)).not.toContain("SPEC-5.md");

      await sendPrompt(harness, "SPEC-1.md больше не является источником требований.", 200);
      await callEvidenceVerification(harness.controller, {
        action: "record_completion_checklist",
        deauthorized_source_paths: ["SPEC-1.md"],
        completion_checklist: ["The requested behavior is implemented"],
      });

      expect(harness.controller.currentState.criticalProofObligationOverflow).toBeUndefined();
      expect(obligationPaths(harness)).toHaveLength(4);
      expect(obligationPaths(harness)).toEqual(
        expect.arrayContaining(["SPEC-2.md", "SPEC-3.md", "SPEC-4.md", "SPEC-5.md"]),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function createRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), "p-critical-proof-overflow-deauthorization-"));
  mkdirSync(join(cwd, "src"));
  for (let index = 1; index <= 5; index += 1) {
    const content = index === 5 ? `${EXACT_LOG_CONTRACT}Source marker 10.\n` : EXACT_LOG_CONTRACT;
    writeFileSync(join(cwd, `SPEC-${index}.md`), content);
  }
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

async function sendPrompt(
  harness: ReturnType<typeof createEvidenceHarness>,
  content: string,
  timestamp: number,
): Promise<void> {
  await harness.emit({ type: "turn_start" });
  await harness.emit({ type: "message_end", message: { role: "user", content, timestamp } });
}

function obligationPaths(harness: ReturnType<typeof createEvidenceHarness>): string[] {
  return (harness.controller.currentState.criticalProofObligations ?? [])
    .map((obligation) => obligation.sourcePath)
    .sort();
}
