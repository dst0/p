import type { CertifiedProxyEvidence } from "../harness/certified-egress-proxy.ts";

const hashPattern = /^[a-f0-9]{64}$/u;

export function validateCertifiedProxyEvidence(
  evidence: CertifiedProxyEvidence | undefined,
  label: string,
  expectedModel: string | undefined,
): string[] {
  if (!evidence) return [`missing certified proxy evidence for ${label}`];
  const failures: string[] = [];
  const count = evidence.requestCount;
  if (!Number.isSafeInteger(count) || count < 1) failures.push(`invalid proxy request count for ${label}`);
  if (!Array.isArray(evidence.requestModels) || evidence.requestModels.length !== count) {
    failures.push(`invalid proxy request model evidence for ${label}`);
  } else if (evidence.requestModels.some((model) => typeof model !== "string" || model !== expectedModel)) {
    failures.push(`proxy request model mismatch for ${label}`);
  }
  if (!Array.isArray(evidence.responseModels) || evidence.responseModels.length === 0) {
    failures.push(`missing proxy response model evidence for ${label}`);
  } else if (evidence.responseModels.some((model) => typeof model !== "string" || model !== expectedModel)) {
    failures.push(`proxy response model mismatch for ${label}`);
  }
  if (
    !Array.isArray(evidence.requestHashes) ||
    evidence.requestHashes.length !== count ||
    evidence.requestHashes.some((hash) => typeof hash !== "string" || !hashPattern.test(hash))
  ) {
    failures.push(`invalid proxy request hash evidence for ${label}`);
  }
  return failures;
}
