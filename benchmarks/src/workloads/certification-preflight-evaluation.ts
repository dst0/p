import type { CertifiedHarnessCoreBinding } from "./certification-binding.ts";
import type { CertifiedInstructionReceipt } from "./certification-preflight.ts";

const HASH_RE = /^[a-f0-9]{64}$/u;

function validateReceiptShape(receipt: CertifiedInstructionReceipt, failures: string[]): void {
  const { agent, elapsedMs, receiptSha256, responseModel, responseModels } = receipt;
  if (typeof receiptSha256 !== "string" || !HASH_RE.test(receiptSha256)) {
    failures.push(`Malformed receipt hash for agent: ${agent}`);
  }
  if (typeof responseModel !== "string" || !responseModel.trim()) {
    failures.push(`Missing responseModel in instruction parity receipt for agent: ${agent}`);
  }
  if (
    !Array.isArray(responseModels) ||
    responseModels.length === 0 ||
    responseModels.some((model) => typeof model !== "string" || !model)
  ) {
    failures.push(`Missing responseModels in instruction parity receipt for agent: ${agent}`);
  }
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    failures.push(`Non-positive or non-finite elapsed time in instruction parity receipt for agent: ${agent}`);
  }
}

function validateReceiptOutcome(
  receipt: CertifiedInstructionReceipt,
  expectedReceiptSha256: string | undefined,
  expectedModel: string | undefined,
  failures: string[],
): void {
  const { agent } = receipt;
  if (receipt.status !== "passed" || !receipt.responseMatched) {
    failures.push(
      `Instruction parity preflight failed for agent: ${agent}${receipt.error ? ` (${receipt.error})` : ""}`,
    );
  }
  if (expectedReceiptSha256 && receipt.receiptSha256 !== expectedReceiptSha256) {
    failures.push(`Instruction parity receipt mismatch for agent: ${agent}`);
  }
  if (expectedModel && receipt.responseModel && receipt.responseModel !== expectedModel) {
    failures.push(
      `Instruction parity model mismatch for agent: ${agent} (got ${receipt.responseModel}, expected ${expectedModel})`,
    );
  }
  for (const model of receipt.responseModels ?? []) {
    if (expectedModel && model !== expectedModel) {
      failures.push(`Instruction parity model mismatch for agent: ${agent} (got ${model}, expected ${expectedModel})`);
    }
  }
}

export function evaluateInstructionParityReceipts(
  binding: CertifiedHarnessCoreBinding | undefined,
  canonicalAgents: readonly string[],
  expectedModel?: string,
): string[] {
  if (!binding) return [];
  const failures: string[] = [];
  const expectedHash = binding.projectInstructions.receiptSha256;
  if (expectedHash !== undefined && !HASH_RE.test(expectedHash)) {
    failures.push(`Invalid expected instruction parity receipt hash: ${expectedHash}`);
  }
  const receiptByAgent = new Map<string, CertifiedInstructionReceipt>();
  for (const receipt of binding.receipts ?? []) {
    if (!receipt || typeof receipt !== "object") {
      failures.push("Malformed receipt entry");
      continue;
    }
    const candidate = receipt as CertifiedInstructionReceipt;
    if (!canonicalAgents.includes(candidate.agent)) {
      failures.push(`Unexpected agent in instruction parity receipt: ${candidate.agent}`);
    }
    if (receiptByAgent.has(candidate.agent)) {
      failures.push(`Duplicate instruction parity receipt for agent: ${candidate.agent}`);
    }
    validateReceiptShape(candidate, failures);
    receiptByAgent.set(candidate.agent, candidate);
  }
  for (const agent of canonicalAgents) {
    const receipt = receiptByAgent.get(agent);
    if (!receipt) {
      failures.push(`Missing certified instruction parity receipt for agent: ${agent}`);
      continue;
    }
    validateReceiptOutcome(receipt, expectedHash, expectedModel, failures);
  }
  return failures;
}
