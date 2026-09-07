import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatedCompletionChecklist } from "../src/core/task-verification/completion-checklist-policy.ts";
import {
  beforeEvidenceTool as beforeTool,
  callEvidenceVerification as callVerification,
  createEvidenceHarness as createHarness,
} from "./task-verification-evidence-test-harness.ts";

const REQUIREMENTS = [
  "State has exactly sku, onHand, reserved, available, reservations, and version.",
  "Every successful command emits exactly one event and increments that SKU version.",
  "Every event records a global one-based position and its per-SKU version.",
  "All command identifiers must remain non-empty after trimming.",
  "Every stale command must fail without changing observable state.",
  "All exact command retries return the original result without appending an event.",
  "A batch commits all commands and idempotency records in order, or commits none.",
  "All returned state, results, and history remain deep copies of engine data.",
  "The event log contains exactly one line for each event followed by its manifest.",
  "Every event hash includes the preceding hash, and the first previous hash is null.",
  "Replay validates all positions, versions, invariants, hash links, and command identifiers.",
  "A restored engine continues all global positions and hash links correctly.",
] as const;
const TASK3_CONCISE_CHECKLIST = [
  "Export InventoryEngine, errors, and all public command/state/event/result/option types; executeBatch returns command results where each item contains command, commandId, and expectedVersion.",
  "State has exactly sku, onHand, reserved, available, reservations, and version; every successful command emits one event and advances its SKU version.",
  "Validate positive integer quantities and trimmed IDs; enforce expectedVersion; receive, reserve, release, and ship preserve bounds.",
  "Retrying the exact same command/options returns the original result without appending an event; conflicting command-ID reuse throws ValidationError.",
  "Batches are atomic across all SKUs: either all commands and idempotency records commit in order or no observable state changes; each expected version sees prior effects.",
  "Return deep copies; export deterministic newline-terminated JSONL with valid manifest, contiguous positions/versions, canonical hashes, and predecessor links.",
  "fromLog validates structure, positions, versions, every hash link, the manifest, and command-ID consistency; rejects any truncation, extra data, malformed JSON, impossible transition, or tampering; restores byte-identical JSONL and continues links.",
] as const;

describe("free-text completion-checklist scope", () => {
  it("accepts one model-owned real task-3 checklist without counting discarded process evidence", () => {
    expect(TASK3_CONCISE_CHECKLIST.join("\n")).toHaveLength(1199);
    expect(validatedCompletionChecklist([...TASK3_CONCISE_CHECKLIST])).toEqual([...TASK3_CONCISE_CHECKLIST]);
    expect(validatedCompletionChecklist([...TASK3_CONCISE_CHECKLIST, "All tests pass"])).toEqual([
      ...TASK3_CONCISE_CHECKLIST,
    ]);
    expect(validatedCompletionChecklist(Array.from({ length: 25 }, () => "All tests pass"))).toContain(
      "at most 24 items",
    );
  });

  it("does not make a model-owned checklist depend on the later source-file lifecycle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-checklist-source-lifecycle-"));
    execFileSync("git", ["init", "-q"], { cwd });
    writeFileSync(join(cwd, "SPEC.md"), "Write exactly 2 manifest records.\n");
    execFileSync("git", ["add", "SPEC.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: { role: "user", content: "Treat SPEC.md as authoritative and implement it.", timestamp: 100 },
      });
      expect(
        await callVerification(harness.controller, {
          action: "record_completion_checklist",
          completion_checklist: ["Write exactly 2 manifest records"],
        }),
      ).toContain("Completion checklist recorded");
      rmSync(join(cwd, "SPEC.md"));
      expect((await beforeTool(harness.agent, "write", { path: "result.txt", content: "done\n" }))?.block).toBeFalsy();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not require an exhaustive source-clause matrix within the concise checklist budget", async () => {
    const exhaustiveRestatement = REQUIREMENTS.map(
      (requirement) =>
        `${requirement} Verify this behavior independently against the authoritative inventory contract.`,
    );
    expect(validatedCompletionChecklist(exhaustiveRestatement)).toContain(
      "completion_checklist must fit within 1200 characters.",
    );
    expect(validatedCompletionChecklist(exhaustiveRestatement)).toContain("Omit unselected source clauses");
    const cwd = mkdtempSync(join(tmpdir(), "p-checklist-free-text-scope-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "maintenance.auto", "false"], { cwd });
    writeFileSync(join(cwd, "SPEC.md"), `${REQUIREMENTS.join("\n")}\n`);
    execFileSync("git", ["add", "SPEC.md"], { cwd });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], {
      cwd,
    });
    const harness = createHarness(cwd);
    try {
      await harness.emit({ type: "turn_start" });
      await harness.emit({
        type: "message_end",
        message: {
          role: "user",
          content: "Treat SPEC.md as authoritative and implement the requested inventory behavior.",
          timestamp: 100,
        },
      });

      const result = await callVerification(harness.controller, {
        action: "record_completion_checklist",
        completion_checklist: [
          "State has exactly sku, onHand, reserved, available, reservations, and version",
          "Every successful command emits exactly one event and increments that SKU version",
          "A batch commits all commands and idempotency records in order, or commits none",
        ],
      });
      expect(result).toContain("Completion checklist recorded");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
