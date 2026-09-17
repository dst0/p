import { createHash, randomBytes, randomInt } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CertifiedHarnessBinding } from "./certification-binding.ts";
import type { BenchmarkTask } from "./task-definition.ts";

const challengeName = "certified-holdout-challenge.json";
const resultName = "certified-holdout-result.json";
const hashPattern = /^[a-f0-9]{64}$/u;

interface CertifiedHoldoutChallenge {
  schemaVersion: 1;
  taskId: string;
  nonce: string;
  values: number[];
}

export function createCertifiedTaskVariants(
  tasks: readonly BenchmarkTask[],
  binding: CertifiedHarnessBinding,
): BenchmarkTask[] {
  if (!hashPattern.test(binding.pSnapshot.sha256) || /^0+$/u.test(binding.pSnapshot.sha256)) {
    throw new Error("Certified holdouts require a bound candidate runtime identity");
  }
  return tasks.map(createVariant);
}

function createVariant(task: BenchmarkTask): BenchmarkTask {
  const challenge: CertifiedHoldoutChallenge = {
    schemaVersion: 1,
    taskId: task.id,
    nonce: randomBytes(24).toString("hex"),
    values: Array.from({ length: 7 }, () => randomInt(10_000, 1_000_000)),
  };
  const challengeText = `${JSON.stringify(challenge, null, 2)}\n`;
  const expected = expectedDigest(challenge);
  return {
    ...task,
    files: { ...task.files, [challengeName]: challengeText },
    prompt: `${task.prompt}\n\nCertified randomized holdout: preserve ${challengeName}. Sum its integer values, compute lowercase SHA-256 of taskId:nonce:sum, and write only {"digest":"<hex>"} to ${resultName}. This challenge was generated after candidate runtime binding and is required for certification.`,
    verify(workspace, baseline, finalText, context) {
      const base = task.verify(workspace, baseline, finalText, context);
      const challengePreserved = safeRead(join(workspace, challengeName)) === challengeText;
      const result = parseResult(join(workspace, resultName));
      const holdoutPassed = challengePreserved && result === expected;
      return {
        ...base,
        passed: base.passed && holdoutPassed,
        checks: [
          ...base.checks,
          {
            name: "post-binding randomized holdout passed",
            passed: holdoutPassed,
            weight: 0,
            details: challengePreserved ? undefined : "holdout challenge was modified",
          },
        ],
      };
    },
  };
}

function expectedDigest(challenge: CertifiedHoldoutChallenge): string {
  const sum = challenge.values.reduce((total, value) => total + value, 0);
  return createHash("sha256").update(`${challenge.taskId}:${challenge.nonce}:${sum}`).digest("hex");
}

function safeRead(path: string): string | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1_024) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function parseResult(path: string): string | undefined {
  const source = safeRead(path);
  if (!source) return undefined;
  try {
    const value: unknown = JSON.parse(source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.digest !== "string" || !hashPattern.test(record.digest)) {
      return undefined;
    }
    return record.digest;
  } catch {
    return undefined;
  }
}
