import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification,
  createEvidenceHarness,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

const CRITERION = "Authentication rejects invalid payment token";
const COMBINED_CRITERION = "Authentication rejects invalid or expired payment token";

describe("controller-owned focused evidence batch isolation", () => {
  it.each(["invalid", "expired"])("does not certify both boundaries from only the %s case", async (boundary) => {
    const result = await verifySelectors([`Authentication rejects ${boundary} payment token`], COMBINED_CRITERION);
    expect(result).not.toContain("verification_token:");
    expect(result).toContain(COMBINED_CRITERION);
  });

  it("combines separate negative boundaries without including the positive case", async () => {
    const result = await verifySelectors(
      [
        "Authentication rejects invalid payment token",
        "Authentication rejects expired payment token",
        "Authentication accepts valid payment token",
      ],
      COMBINED_CRITERION,
    );
    expect(result).toContain("verification_token:");
  });

  it("does not let a positive test poison an independently sufficient negative test", async () => {
    const result = await verifySelectors([
      "Authentication rejects invalid payment token",
      "Authentication accepts valid payment token",
    ]);
    expect(result).toContain("verification_token:");
  });

  it("does not borrow rejection and invalid-input qualifiers from another subject", async () => {
    const result = await verifySelectors(["Authentication examines payment token", "JSON parser rejects invalid"]);
    expect(result).not.toContain("verification_token:");
    expect(result).toContain(CRITERION);
  });

  it("does not borrow rejection behavior to reverse an unsafe authentication acceptance", async () => {
    const result = await verifySelectors([
      "Authentication accepts invalid payment token",
      "Authentication rejects expired password reset links",
    ]);
    expect(result).not.toContain("verification_token:");
    expect(result).toContain(CRITERION);
  });
});

async function verifySelectors(selectors: readonly string[], criterion = CRITERION): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "p-focused-evidence-isolation-"));
  const harness = createEvidenceHarness(cwd);
  try {
    await harness.emit({ type: "turn_start" });
    await harness.emit({
      type: "message_end",
      message: { role: "user", content: "Implement payment-token authentication.", timestamp: 100 },
    });
    const checklist = await callEvidenceVerification(harness.controller, {
      action: "record_completion_checklist",
      completion_checklist: [criterion],
    });
    expect(checklist).toBe("Completion checklist recorded with 1 behavioral check.");
    const args = { path: "authenticate.ts", content: "export {};\n" };
    const call = evidenceToolCall("write", args);
    expect((await beforeEvidenceTool(harness.agent, "write", args, call))?.block).not.toBe(true);
    writeFileSync(join(cwd, args.path), args.content);
    await afterEvidenceTool(harness.agent, "write", args, "wrote authenticate.ts", call);
    for (const selector of selectors) {
      await afterEvidenceTool(
        harness.agent,
        "bash",
        { command: `node --test --test-name-pattern "${selector}" test/authenticate.test.ts` },
        "Tests 1 passed",
      );
    }
    return await callEvidenceVerification(harness.controller, { action: "ready_to_finish" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
