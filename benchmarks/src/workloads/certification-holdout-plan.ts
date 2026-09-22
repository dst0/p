import { createHash, randomBytes } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchmarkEvaluationSnapshot } from "../harness/evaluation-freeze.ts";
import { hashSnapshotDirectory } from "../harness/runtime-snapshot.ts";
import type { CertifiedHarnessCoreBinding } from "./certification-binding.ts";
import { createSealedHoldoutTaskPlan, type SealedHoldoutTaskPlan } from "./certification-holdout-plan-cases.ts";
import { certifiedTaskIds } from "./certified-task-score-policy.ts";

const planDirectoryName = ".certified-holdout";
const planFileName = "plan.json";
const adapterFileName = "adapter.js";
const adapterSourceFileName = "certification-holdout-adapter.js";
const schemaVersion = 1;

export type SealedHoldoutPlan = {
  schemaVersion: 1;
  coreCandidateSha256: string;
  preHoldoutEvaluatorSha256: string;
  taskPlans: readonly SealedHoldoutTaskPlan[];
};

export type { SealedHoldoutTaskPlan } from "./certification-holdout-plan-cases.ts";

export function createSealedHoldoutPlan(
  core: CertifiedHarnessCoreBinding,
  evaluator: BenchmarkEvaluationSnapshot,
  seed: Uint8Array = randomBytes(32),
): { plan: SealedHoldoutPlan; holdoutSha256: string } {
  validateHash(core.pSnapshot.sha256, "candidate runtime");
  validateHash(evaluator.sha256, "pre-holdout evaluator");
  if (seed.length !== 32) throw new Error("Sealed holdout seed must contain exactly 32 bytes");
  const plan: SealedHoldoutPlan = {
    schemaVersion,
    coreCandidateSha256: core.pSnapshot.sha256,
    preHoldoutEvaluatorSha256: evaluator.sha256,
    taskPlans: certifiedTaskIds.map((taskId) => createSealedHoldoutTaskPlan(taskId, seed)),
  };
  const contents = canonicalSerialize(plan);
  const holdoutSha256 = hash(contents);
  persistPrivatePlan(evaluator.path, contents);
  evaluator.sha256 = hashSnapshotDirectory(evaluator.path);
  return { plan, holdoutSha256 };
}

export function recheckSealedHoldoutPlan(
  evaluator: { path: string; sha256: string },
  coreCandidateSha256: string,
  holdoutSha256: string,
): void {
  validateHash(holdoutSha256, "sealed holdout");
  if (hashSnapshotDirectory(evaluator.path) !== evaluator.sha256) {
    throw new Error("Evaluator freeze fixtures changed before certification publishing");
  }
  const source = readPrivateFile(join(evaluator.path, planDirectoryName, planFileName));
  const plan = parsePlan(source);
  if (plan.coreCandidateSha256 !== coreCandidateSha256 || hash(canonicalSerialize(plan)) !== holdoutSha256) {
    throw new Error("Sealed holdout plan does not match the certified harness");
  }
}

export function sealedHoldoutAdapterPath(evaluatorPath: string): string {
  return join(evaluatorPath, planDirectoryName, adapterFileName);
}

export function readSealedHoldoutAdapter(evaluatorPath: string): string {
  return readPrivateFile(sealedHoldoutAdapterPath(evaluatorPath));
}

function persistPrivatePlan(evaluatorPath: string, contents: string): void {
  const directory = join(evaluatorPath, planDirectoryName);
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(evaluatorPath, 0o700);
  chmodSync(directory, 0o700);
  writeFileSync(join(directory, planFileName), contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(
    join(directory, adapterFileName),
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), adapterSourceFileName)),
    { flag: "wx", mode: 0o600 },
  );
  chmodSync(join(directory, planFileName), 0o600);
  chmodSync(join(directory, adapterFileName), 0o600);
}

function readPrivateFile(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65_536 || (stat.mode & 0o077) !== 0) {
    throw new Error("Sealed holdout plan has an unsafe private file identity");
  }
  return readFileSync(path, "utf8");
}

function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Sealed holdout canonical serialization rejected a value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSerialize((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function parsePlan(source: string): SealedHoldoutPlan {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sealed holdout plan is malformed");
  const plan = value as Partial<SealedHoldoutPlan>;
  if (
    plan.schemaVersion !== schemaVersion ||
    typeof plan.coreCandidateSha256 !== "string" ||
    !Array.isArray(plan.taskPlans) ||
    plan.taskPlans.length !== certifiedTaskIds.length
  ) {
    throw new Error("Sealed holdout plan is malformed");
  }
  return plan as SealedHoldoutPlan;
}

function validateHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value) || /^0+$/u.test(value)) throw new Error(`Invalid ${label} hash`);
}

function hash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
