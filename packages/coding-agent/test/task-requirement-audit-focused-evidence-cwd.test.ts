import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

const requirement = {
  type: "behavior" as const,
  text: "Integrity: fromLog rejects truncated logs",
  acceptance_criterion: "A focused fromLog test rejects a truncated log",
  source_prompt_indexes: [1],
};

async function auditCommand(command: string): Promise<string> {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [requirement],
    ignored_source_prompts: [],
  });
  const evidenceRef = auditEvidenceHandle(
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command },
      {
        text: ["\u2714 fromLog rejects truncated log (0.1ms)", "\u2139 tests 1", "\u2139 pass 1", "\u2139 fail 0"].join(
          "\n",
        ),
      },
    ),
  );
  await nextModelTurn(harness);
  return callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: [
      {
        requirement_id: "R1",
        passed: true,
        reason: "The focused current-revision truncation test passed.",
        evidence_refs: [evidenceRef],
      },
    ],
  });
}

describe("focused requirement evidence with a workspace directory prefix", () => {
  it("accepts one focused test after a literal cd prefix", async () => {
    const result = await auditCommand(
      'cd /private/tmp/inventory && node --import tsx --test --test-name-pattern="fromLog rejects tampered truncated log integrity" test/*.test.ts 2>&1',
    );

    expect(result).toContain("Requirement audit passed: 1/1");
  });

  it("rejects an extra command after the focused test", async () => {
    const result = await auditCommand(
      'cd /private/tmp/inventory && node --import tsx --test --test-name-pattern="fromLog rejects tampered truncated log integrity" test/*.test.ts && echo done',
    );

    expect(result).toContain("R1 requires focused executable evidence");
    expect(result).toContain("test runner's case selector");
    expect(result).toContain("--test-name-pattern");
    expect(result).toContain("selector itself must name the observable outcome");
    expect(result).toContain(requirement.acceptance_criterion);
    expect(result).toContain("shorter prefix is insufficient");
  });

  it("rejects a computed directory prefix", async () => {
    const result = await auditCommand(
      'cd "$(pwd)" && node --import tsx --test --test-name-pattern="fromLog rejects tampered truncated log integrity" test/*.test.ts',
    );

    expect(result).toContain("R1 requires focused executable evidence");
  });

  it.each([
    'cd /private/tmp/inventory ; node --import tsx --test --test-name-pattern="fromLog rejects truncated log integrity" test/*.test.ts',
    'cd /private/tmp/inventory || node --import tsx --test --test-name-pattern="fromLog rejects truncated log integrity" test/*.test.ts',
    'cd /private/tmp/inventory & node --import tsx --test --test-name-pattern="fromLog rejects truncated log integrity" test/*.test.ts',
    'cd <(pwd) && node --import tsx --test --test-name-pattern="fromLog rejects truncated log integrity" test/*.test.ts',
  ])("rejects a non-sequential or computed directory wrapper: %s", async (command) => {
    const result = await auditCommand(command);

    expect(result).toContain("R1 requires focused executable evidence");
  });
});
