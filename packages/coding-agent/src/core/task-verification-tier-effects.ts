import { isAbsolute, relative, resolve } from "node:path";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import type {
  InstalledTaskVerificationRuntime,
  ObservedVerificationLedger,
} from "./agent-session/task-verification-runtime-state.ts";
import { KNOWN_DIRECT_MUTATION_TOOLS } from "./task-verification/constants.ts";
import { effectEscalation, type VerificationTierDecision } from "./task-verification/task-tier.ts";
import { pathArgument } from "./task-verification/tool-classification.ts";
import type { TaskVerificationState } from "./task-verification/types.ts";

export function snapshotObservedLedger(state: TaskVerificationState): ObservedVerificationLedger {
  return {
    ownedPaths: new Set(state.taskOwnedPaths ?? []),
    sourcePaths: new Set(state.mutatedSourcePaths ?? []),
    mutationRevision: state.mutationRevision,
  };
}

/**
 * The path a successful direct file mutation targeted: relative inside the workspace, absolute outside it
 * (for example a sibling worktree), which the snapshot-based ledger cannot see.
 */
export function directMutationPath(context: AfterToolCallContext, cwd: string): string | undefined {
  const declaredWrite = context.effect?.kind === "workspace_write";
  const builtinWrite = context.effect?.source === "builtin" && KNOWN_DIRECT_MUTATION_TOOLS.has(context.toolCall.name);
  const path = declaredWrite || builtinWrite ? pathArgument(context.args) : undefined;
  if (!path) return undefined;
  const absolute = resolve(cwd, path);
  const inside = relative(cwd, absolute);
  const outside = inside === "" || inside === ".." || /^\.\.[\\/]/u.test(inside) || isAbsolute(inside);
  return (outside ? absolute : inside).replaceAll("\\", "/");
}

/**
 * Effect backstop: escalates LIGHT to STRICT for a new source, test, or build-config path, whether the
 * ledger saw it through a workspace snapshot, the parsed mutation paths, or the call's own target path.
 * A detected mutation whose paths could not be tracked escalates conservatively.
 */
export function observeVerificationTierEffect(
  runtime: InstalledTaskVerificationRuntime,
  context: AfterToolCallContext,
  isError: boolean,
  cwd: string,
): void {
  const previous = runtime.observedLedger;
  const state = runtime.controller.state;
  const current = snapshotObservedLedger(state);
  runtime.observedLedger = current;
  if (!runtime.tier.escalationEnabled || runtime.tier.tier === "strict") return;
  const directPath = isError ? undefined : directMutationPath(context, cwd);
  const candidates = [
    ...[...current.ownedPaths].filter((path) => !previous.ownedPaths.has(path)),
    ...[...current.sourcePaths].filter((path) => !previous.sourcePaths.has(path)),
    ...(directPath ? [directPath] : []),
  ];
  const decision = effectEscalation(candidates) ?? untrackedMutation(previous, state, directPath, context);
  if (decision) runtime.tier.escalate(decision.reason, decision.trigger);
}

function untrackedMutation(
  previous: ObservedVerificationLedger,
  state: TaskVerificationState,
  directPath: string | undefined,
  context: AfterToolCallContext,
): VerificationTierDecision | undefined {
  const mutated = state.mutationRevision > previous.mutationRevision;
  const untracked = state.taskOwnedPathTrackingFailed === true || state.mutatedSourcePathOverflow === true;
  if (!mutated || !untracked || directPath !== undefined) return undefined;
  return { tier: "strict", reason: "effect_untracked", trigger: context.toolCall.name };
}
