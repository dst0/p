import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import { parseNamedNodeTests, runFixtureCommand } from "./fixture-verification.ts";
import type { BenchmarkCheck } from "./task-definition.ts";

export type HiddenRubric = {
  id: string;
  name: string;
  weight: number;
};

export type HiddenVerificationResult = {
  passed: boolean;
  checks: BenchmarkCheck[];
};

export function runHiddenVerification(
  workspace: string,
  fileName: string,
  source: string,
  prefix: string,
  rubric: readonly HiddenRubric[],
): HiddenVerificationResult {
  const hiddenTestPath = join(workspace, "test", fileName);
  let status: number | null = null;
  let output = "";
  let created = false;
  try {
    assertCertifiedOutputWritePath(hiddenTestPath);
    writeFileSync(hiddenTestPath, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    created = true;
    const result = runFixtureCommand(workspace, ["test"], {
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--test-reporter=tap"].filter(Boolean).join(" "),
    });
    status = result.status;
    output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  } finally {
    if (created) {
      assertCertifiedOutputWritePath(hiddenTestPath);
      rmSync(hiddenTestPath);
    }
  }
  const results = parseNamedNodeTests(output, prefix);
  const checks: BenchmarkCheck[] = rubric.map((criterion) => ({
    name: criterion.name,
    passed: results.get(criterion.id) === true,
    weight: criterion.weight,
  }));
  const firstFailure = checks.find((check) => !check.passed);
  if (firstFailure) firstFailure.details = output.slice(-12_000);
  return { passed: status === 0 && checks.every((check) => check.passed), checks };
}
