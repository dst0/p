import type { TaskVerificationState } from "../types.ts";
import { MAX_TASK_OWNED_PATHS, normalizeWorkspaceEffectPath } from "../workspace-effect-state.ts";
import type { SourceWorkspaceSnapshot } from "./source-workspace-snapshot.ts";
import { changedSourcePaths } from "./source-workspace-snapshot.ts";

export interface WorkspaceEffectLedgerUpdate {
  taskOwnedPaths: string[];
  taskOwnedPathBaselines: NonNullable<TaskVerificationState["taskOwnedPathBaselines"]>;
  taskOwnedPathOverflow: boolean;
  taskOwnedPathTrackingFailed: boolean;
}

export function updatedWorkspaceEffectLedger(
  state: TaskVerificationState,
  before: SourceWorkspaceSnapshot | undefined,
  after: SourceWorkspaceSnapshot | undefined,
): WorkspaceEffectLedgerUpdate {
  if (!before || !after) {
    return {
      taskOwnedPaths: state.taskOwnedPaths ?? [],
      taskOwnedPathBaselines: state.taskOwnedPathBaselines ?? [],
      taskOwnedPathOverflow: state.taskOwnedPathOverflow ?? false,
      taskOwnedPathTrackingFailed: true,
    };
  }

  const baselines = new Map((state.taskOwnedPathBaselines ?? []).map((entry) => [entry.path, entry.state]));
  let overflow = state.taskOwnedPathOverflow ?? false;
  for (const candidate of changedSourcePaths(before, after)) {
    const filePath = normalizeWorkspaceEffectPath(candidate);
    if (!filePath || baselines.has(filePath)) continue;
    if (baselines.size >= MAX_TASK_OWNED_PATHS) {
      overflow = true;
      continue;
    }
    baselines.set(filePath, before.get(filePath) ?? null);
  }

  for (const [filePath, baseline] of baselines) {
    if ((after.get(filePath) ?? null) === baseline) baselines.delete(filePath);
  }
  const entries = [...baselines]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, baseline]) => ({ path, state: baseline }));
  return {
    taskOwnedPaths: entries.map((entry) => entry.path),
    taskOwnedPathBaselines: entries,
    taskOwnedPathOverflow: overflow,
    taskOwnedPathTrackingFailed: state.taskOwnedPathTrackingFailed ?? false,
  };
}
