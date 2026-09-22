import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { hashRuntimeSnapshot, hashSnapshotDirectory } from "../harness/runtime-snapshot.ts";
import { recheckSealedHoldoutPlan } from "./certification-holdout-plan.ts";
import { type CertifiedModelConfiguration, recheckCertifiedModelConfiguration } from "./certification-model-config.ts";
import type { CertifiedInstructionReceipt } from "./certification-preflight.ts";

export interface CertifiedExecutableBinding {
  path: string;
  version: string;
  sha256: string;
}

export interface CertifiedHarnessCoreBinding {
  node: CertifiedExecutableBinding;
  pSnapshot: CertifiedExecutableBinding;
  pi: CertifiedExecutableBinding;
  kilo: CertifiedExecutableBinding;
  modelConfiguration: CertifiedModelConfiguration;
  projectInstructions: { path: string; sha256: string; receiptSha256?: string };
  receipts?: CertifiedInstructionReceipt[];
}

export interface CertifiedHarnessBinding extends CertifiedHarnessCoreBinding {
  evaluator: { path: string; sha256: string };
  holdoutSha256: string;
}

export interface CertifiedHarnessCoreInputs {
  nodeExecutable?: string;
  nodeVersion?: string;
  pSnapshotPath: string;
  pSnapshotSha256: string;
  pVersion?: string;
  piExecutable?: string;
  piVersion?: string;
  kiloExecutable?: string;
  kiloVersion?: string;
  modelConfiguration?: CertifiedModelConfiguration;
  projectInstructionsFile: string;
  projectInstructionsSha256?: string;
  receiptSha256?: string;
  receipts?: CertifiedInstructionReceipt[];
}

export interface CertifiedHarnessInputs extends CertifiedHarnessCoreInputs {
  evaluatorPath: string;
  evaluatorSha256: string;
  holdoutSha256: string;
}

const ZERO_HASH = "0".repeat(64);

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function resolveBinaryPath(executable: string | undefined, defaultName: string): string {
  if (executable && existsSync(executable)) {
    return realpathSync(executable);
  }
  if (!executable) {
    const whichResult = spawnSync("which", [defaultName], { encoding: "utf8" });
    if (whichResult.status === 0) {
      const found = whichResult.stdout.trim();
      if (found && existsSync(found)) return realpathSync(found);
    }
  }
  throw new Error(`Missing ${defaultName} executable; certified mode requires a resolved ${defaultName} binary`);
}

function resolveBinaryVersion(binaryPath: string, expectedVersion?: string): string {
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to run ${binaryPath} --version; certified mode requires an authoritative version`);
  }
  const actualVersion = result.stdout.trim();
  if (expectedVersion?.trim() && actualVersion !== expectedVersion.trim()) {
    throw new Error(
      `Installed binary version for ${binaryPath} is ${actualVersion}; expected ${expectedVersion.trim()}`,
    );
  }
  return actualVersion;
}

function bindExecutable(
  executable: string | undefined,
  defaultName: string,
  expectedVersion?: string,
): CertifiedExecutableBinding {
  const binaryPath = resolveBinaryPath(executable, defaultName);
  const version = resolveBinaryVersion(binaryPath, expectedVersion);
  const sha256 = hashFile(binaryPath);
  if (!sha256 || sha256 === ZERO_HASH) {
    throw new Error(`Invalid ${defaultName} executable hash placeholder`);
  }
  return { path: binaryPath, version, sha256 };
}

export function bindCertifiedHarnessCore(inputs: CertifiedHarnessCoreInputs): CertifiedHarnessCoreBinding {
  const nodeExecutable = inputs.nodeExecutable ?? process.execPath;
  if (!existsSync(nodeExecutable)) {
    throw new Error("Missing Node executable; certified mode requires a resolved Node binary");
  }
  const nodePath = realpathSync(nodeExecutable);
  const nodeResult = spawnSync(nodePath, ["--version"], { encoding: "utf8" });
  if (nodeResult.status !== 0 || !nodeResult.stdout.trim()) {
    throw new Error("Unable to run Node --version; certified mode requires an authoritative version");
  }
  const nodeVersion = nodeResult.stdout.trim();
  if (
    inputs.nodeVersion?.trim() &&
    nodeVersion !== inputs.nodeVersion.trim() &&
    !nodeVersion.endsWith(inputs.nodeVersion.trim())
  ) {
    throw new Error(`Node version mismatch: running ${nodeVersion}, expected ${inputs.nodeVersion}`);
  }
  const nodeSha = hashFile(nodePath);
  if (!nodeSha || nodeSha === ZERO_HASH) {
    throw new Error("Invalid Node executable hash placeholder");
  }

  if (!existsSync(inputs.pSnapshotPath)) {
    throw new Error("Missing P snapshot path; candidate runtime must exist");
  }
  const pSnapshotPath = realpathSync(inputs.pSnapshotPath);
  const pSnapshotSha256 = inputs.pSnapshotSha256;
  if (!pSnapshotSha256 || pSnapshotSha256 === ZERO_HASH) {
    throw new Error("Candidate P snapshot identity must not be zero or placeholder");
  }
  const candidatePkgPath = existsSync(join(pSnapshotPath, "packages", "coding-agent", "package.json"))
    ? join(pSnapshotPath, "packages", "coding-agent", "package.json")
    : join(pSnapshotPath, "package.json");
  if (!existsSync(candidatePkgPath)) {
    throw new Error(`Missing package manifest in P snapshot: ${candidatePkgPath}`);
  }
  if (hashRuntimeSnapshot(pSnapshotPath, nodePath) !== pSnapshotSha256) {
    throw new Error("Candidate P snapshot changed before certified core binding");
  }
  const pkgManifest: unknown = JSON.parse(readFileSync(candidatePkgPath, "utf8"));
  const pVersion =
    typeof pkgManifest === "object" && pkgManifest !== null
      ? (pkgManifest as Record<string, unknown>).version
      : undefined;
  if (
    typeof pVersion !== "string" ||
    !pVersion.trim() ||
    pVersion === "0.0.0-certified" ||
    pVersion.includes("placeholder")
  ) {
    throw new Error("Unresolved P version in package manifest; certified mode requires an authoritative version");
  }
  if (inputs.pVersion?.trim() && pVersion.trim() !== inputs.pVersion.trim()) {
    throw new Error(`Candidate P version is ${pVersion}; expected ${inputs.pVersion}`);
  }

  const piBinding = bindExecutable(inputs.piExecutable, "pi", inputs.piVersion);
  const kiloBinding = bindExecutable(inputs.kiloExecutable, "kilo", inputs.kiloVersion);
  if (!inputs.modelConfiguration || inputs.modelConfiguration.sha256 === ZERO_HASH) {
    throw new Error("Missing certified model configuration binding");
  }

  if (!existsSync(inputs.projectInstructionsFile)) {
    throw new Error(`Missing project instructions file: ${inputs.projectInstructionsFile}`);
  }
  const instructionsPath = realpathSync(inputs.projectInstructionsFile);
  const instructionsSha = hashFile(instructionsPath);
  if (!instructionsSha || instructionsSha === ZERO_HASH) {
    throw new Error("Invalid project instructions hash placeholder");
  }

  if (inputs.projectInstructionsSha256 && inputs.projectInstructionsSha256 !== instructionsSha) {
    throw new Error("Project instructions changed before certified core binding");
  }

  return {
    node: { path: nodePath, version: nodeVersion, sha256: nodeSha },
    pSnapshot: { path: pSnapshotPath, version: pVersion, sha256: pSnapshotSha256 },
    pi: piBinding,
    kilo: kiloBinding,
    modelConfiguration: inputs.modelConfiguration,
    projectInstructions: {
      path: instructionsPath,
      sha256: inputs.projectInstructionsSha256 ?? instructionsSha,
      receiptSha256: inputs.receiptSha256,
    },
    ...(inputs.receipts ? { receipts: inputs.receipts } : {}),
  };
}

export function bindCertifiedHarness(inputs: CertifiedHarnessInputs): CertifiedHarnessBinding {
  const core = bindCertifiedHarnessCore(inputs);
  if (!inputs.evaluatorPath || !existsSync(inputs.evaluatorPath)) {
    throw new Error("Missing evaluator freeze snapshot path");
  }
  const evaluatorPath = realpathSync(inputs.evaluatorPath);
  const evaluatorSha256 = hashSnapshotDirectory(evaluatorPath);
  if (!inputs.evaluatorSha256 || inputs.evaluatorSha256 !== evaluatorSha256 || evaluatorSha256 === ZERO_HASH) {
    throw new Error("Evaluator freeze snapshot changed before final certified binding");
  }
  if (!inputs.holdoutSha256 || !/^[a-f0-9]{64}$/u.test(inputs.holdoutSha256) || inputs.holdoutSha256 === ZERO_HASH) {
    throw new Error("Missing sealed holdout hash in final certified binding");
  }
  recheckSealedHoldoutPlan(
    { path: evaluatorPath, sha256: evaluatorSha256 },
    core.pSnapshot.sha256,
    inputs.holdoutSha256,
  );
  return { ...core, evaluator: { path: evaluatorPath, sha256: evaluatorSha256 }, holdoutSha256: inputs.holdoutSha256 };
}

export function recheckCertifiedHarnessCore(
  binding: CertifiedHarnessCoreBinding,
  pSnapshotPath: string,
  expectedSnapshotSha256: string,
): void {
  if (binding.node.sha256 === ZERO_HASH || hashFile(binding.node.path) !== binding.node.sha256) {
    throw new Error("Node executable binary changed before certification publishing");
  }
  if (binding.pSnapshot.sha256 === ZERO_HASH) {
    throw new Error("Candidate P snapshot identity must not be zero or placeholder");
  }
  if (realpathSync(pSnapshotPath) !== realpathSync(binding.pSnapshot.path)) {
    throw new Error("P snapshot identity does not match executed P runtime path");
  }
  const currentSnapshotSha = hashRuntimeSnapshot(pSnapshotPath, binding.node.path);
  if (currentSnapshotSha !== expectedSnapshotSha256 || currentSnapshotSha !== binding.pSnapshot.sha256) {
    throw new Error("Candidate P snapshot changed before certification publishing");
  }
  if (binding.pi.sha256 === ZERO_HASH || hashFile(binding.pi.path) !== binding.pi.sha256) {
    throw new Error("Pi executable binary changed before certification publishing");
  }
  if (binding.kilo.sha256 === ZERO_HASH || hashFile(binding.kilo.path) !== binding.kilo.sha256) {
    throw new Error("Kilo executable binary changed before certification publishing");
  }
  if (
    binding.projectInstructions.sha256 === ZERO_HASH ||
    hashFile(binding.projectInstructions.path) !== binding.projectInstructions.sha256
  ) {
    throw new Error("Project instructions content changed before certification publishing");
  }
  recheckCertifiedModelConfiguration(binding.modelConfiguration);
  if (binding.receipts) {
    for (const receipt of binding.receipts) {
      if (
        binding.projectInstructions.receiptSha256 &&
        receipt.receiptSha256 !== binding.projectInstructions.receiptSha256
      ) {
        throw new Error("Instruction parity receipt mismatch detected during publishing recheck");
      }
    }
  }
}

export function recheckCertifiedHarness(
  binding: CertifiedHarnessBinding,
  pSnapshotPath: string,
  expectedSnapshotSha256: string,
): void {
  recheckCertifiedHarnessCore(binding, pSnapshotPath, expectedSnapshotSha256);
  if (
    binding.evaluator.sha256 === ZERO_HASH ||
    hashSnapshotDirectory(binding.evaluator.path) !== binding.evaluator.sha256
  ) {
    throw new Error("Evaluator freeze fixtures changed before certification publishing");
  }
  recheckSealedHoldoutPlan(binding.evaluator, binding.pSnapshot.sha256, binding.holdoutSha256);
}

export function counterbalanceAgentOrder<T>(agents: readonly T[], runNumber: number, taskIndex: number): T[] {
  const count = agents.length;
  if (count <= 1) return [...agents];
  const shift = (runNumber - 1 + taskIndex) % count;
  return Array.from({ length: count }, (_, index) => agents[(index + shift) % count]!);
}

export function planRunCells<T, Task>(
  agents: readonly T[],
  tasks: readonly Task[],
  run: number,
  certified?: boolean,
): Array<{ agent: T; task: Task }> {
  const cells: Array<{ agent: T; task: Task }> = [];
  if (certified) {
    for (let idx = 0; idx < tasks.length; idx += 1) {
      const task = tasks[idx]!;
      for (const agent of counterbalanceAgentOrder(agents, run, idx)) cells.push({ agent, task });
    }
  } else {
    for (const agent of agents) {
      for (const task of tasks) cells.push({ agent, task });
    }
  }
  return cells;
}
