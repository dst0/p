import { externalEffectReceiptsAreValid } from "./external-effect-state.ts";
import { isTaskOwnedPathBaselines, isTaskOwnedPaths } from "./workspace-effect-state.ts";

export function taskEffectStateIsValid(value: Record<string, unknown>): boolean {
  if (
    !isTaskOwnedPaths(value.taskOwnedPaths) ||
    !isTaskOwnedPathBaselines(value.taskOwnedPathBaselines) ||
    (value.taskOwnedPathOverflow !== undefined && typeof value.taskOwnedPathOverflow !== "boolean") ||
    (value.taskOwnedPathTrackingFailed !== undefined && typeof value.taskOwnedPathTrackingFailed !== "boolean")
  ) {
    return false;
  }
  const paths = value.taskOwnedPaths ?? [];
  const baselines = value.taskOwnedPathBaselines ?? [];
  if (
    !Array.isArray(paths) ||
    !Array.isArray(baselines) ||
    paths.length !== baselines.length ||
    !paths.every((filePath, index) => filePath === baselines[index]?.path)
  ) {
    return false;
  }
  const receipts = value.externalEffectReceipts ?? [];
  const revision = value.mutationRevision;
  if (!externalEffectReceiptsAreValid(receipts) || !isNonnegativeInteger(revision)) return false;
  return (
    (value.externalEffectReceiptOverflow === undefined || typeof value.externalEffectReceiptOverflow === "boolean") &&
    (value.effectTrackingFailed === undefined || typeof value.effectTrackingFailed === "boolean") &&
    receipts.every((receipt) => receipt.effectRevision <= revision)
  );
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
