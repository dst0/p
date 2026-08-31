import { createHash } from "node:crypto";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { computeWorkspaceEffectHash } from "./source-workspace-snapshot.ts";

export function computeTaskEffectStateHash(self: TaskVerificationController): string | undefined {
  const paths = self.state.taskOwnedPaths ?? [];
  const receipts = self.state.externalEffectReceipts ?? [];
  if (paths.length === 0 && receipts.length === 0) return undefined;
  const workspaceHash = paths.length > 0 ? computeWorkspaceEffectHash(self.sessionManager.getCwd(), paths) : "none";
  if (!workspaceHash) return undefined;
  const canonicalReceipts = receipts.map((receipt) => ({
    id: receipt.id,
    toolCallId: receipt.toolCallId,
    toolName: receipt.toolName,
    effect: {
      kind: receipt.effect.kind,
      risk: receipt.effect.risk,
      domains: [...receipt.effect.domains].sort(),
      source: receipt.effect.source,
    },
    effectRevision: receipt.effectRevision,
  }));
  return createHash("sha256")
    .update(JSON.stringify({ workspaceHash, receipts: canonicalReceipts }))
    .digest("hex");
}
