import { getRepoIndexingDecision, type RepoIndexingDecision } from "./indexed-repos.ts";
import { canonicalizePath, findMainWorktreePath } from "./workspace-root.ts";

export interface RepoDecisionInfo {
  decision: RepoIndexingDecision;
  /** Set only when the repo's own decision is "unknown" but its linked worktree's main
   * checkout has an explicit decision. The worktree is never auto-indexed on this basis —
   * it is only exempted from the "index this repo?" prompt. */
  inheritedFrom?: string;
}

// Resolving inheritance re-reads the main checkout's persisted decision (and, transitively,
// shells out to git to resolve the main worktree the first time). A repo's own decision and
// worktree topology never change for the lifetime of this process, so once inheritance has
// been checked for a given (agentDir, workspaceRoot) pair, cache the outcome: frequent
// pollers (e.g. the footer's 500ms indexing-status refresh) must not re-resolve it every
// tick. Keyed by `${agentDir}\0${canonicalWorkspaceRoot}`; only ever populated when the
// repo's own decision was "unknown", so an explicit `/index enable|disable` on the repo
// itself bypasses this cache entirely (its own decision short-circuits first).
const inheritedDecisionCache = new Map<string, RepoDecisionInfo>();

/**
 * Resolves the indexing decision for `workspaceRoot`, inheriting a linked git worktree's
 * main checkout decision without persisting or auto-indexing anything.
 */
export function resolveRepoDecision(workspaceRoot: string, agentDir: string): RepoDecisionInfo {
  const decision = getRepoIndexingDecision(workspaceRoot, agentDir);
  if (decision !== "unknown") return { decision };

  const cacheKey = `${agentDir}\0${canonicalizePath(workspaceRoot)}`;
  const cached = inheritedDecisionCache.get(cacheKey);
  if (cached) return cached;

  const mainWorktree = findMainWorktreePath(workspaceRoot);
  const mainDecision = mainWorktree ? getRepoIndexingDecision(mainWorktree, agentDir) : "unknown";
  const resolved: RepoDecisionInfo =
    mainWorktree && mainDecision !== "unknown" ? { decision: "unknown", inheritedFrom: mainWorktree } : { decision };
  inheritedDecisionCache.set(cacheKey, resolved);
  return resolved;
}
