import { buildSessionContext } from "../session-context.ts";
import { generateId } from "../session-id.ts";
import type { SessionManager } from "../sessionmanager.ts";
import type { BranchSummaryEntry, SessionContext, SessionEntry, SessionHeader, SessionTreeNode } from "../types.ts";

export function do_getBranch(self: SessionManager, fromId?: string): SessionEntry[] {
  const path: SessionEntry[] = [];
  const startId = fromId ?? self.leafId;
  let current = startId ? self.byId.get(startId) : undefined;
  while (current) {
    path.unshift(current);
    current = current.parentId ? self.byId.get(current.parentId) : undefined;
  }
  return path;
}

export function do_buildSessionContext(self: SessionManager): SessionContext {
  return buildSessionContext(self.getEntries(), self.leafId, self.byId);
}

export function do_getHeader(self: SessionManager): SessionHeader | null {
  const h = self.fileEntries.find((e) => e.type === "session");
  return h ? (h as SessionHeader) : null;
}

export function do_getEntries(self: SessionManager): SessionEntry[] {
  return self.fileEntries.filter((e): e is SessionEntry => e.type !== "session");
}

export function do_getTree(self: SessionManager): SessionTreeNode[] {
  const entries = self.getEntries();
  const nodeMap = new Map<string, SessionTreeNode>();
  const roots: SessionTreeNode[] = [];

  // Create nodes with resolved labels
  for (const entry of entries) {
    const label = self.labelsById.get(entry.id);
    const labelTimestamp = self.labelTimestampsById.get(entry.id);
    nodeMap.set(entry.id, { entry, children: [], label, labelTimestamp });
  }

  // Build tree
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (entry.parentId === null || entry.parentId === entry.id) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan - treat as root
        roots.push(node);
      }
    }
  }

  // Sort children by timestamp (oldest first, newest at bottom)
  // Use iterative approach to avoid stack overflow on deep trees
  const stack: SessionTreeNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }

  return roots;
}

export function do_branch(self: SessionManager, branchFromId: string): void {
  if (!self.byId.has(branchFromId)) {
    throw new Error(`Entry ${branchFromId} not found`);
  }
  self.leafId = branchFromId;
}

export function do_resetLeaf(self: SessionManager): void {
  self.leafId = null;
}

export function do_branchWithSummary(
  self: SessionManager,
  branchFromId: string | null,
  summary: string,
  details?: unknown,
  fromHook?: boolean,
): string {
  if (branchFromId !== null && !self.byId.has(branchFromId)) {
    throw new Error(`Entry ${branchFromId} not found`);
  }
  self.leafId = branchFromId;
  const entry: BranchSummaryEntry = {
    type: "branch_summary",
    id: generateId(self.byId),
    parentId: branchFromId,
    timestamp: new Date().toISOString(),
    fromId: branchFromId ?? "root",
    summary,
    details,
    fromHook,
  };
  self._appendEntry(entry);
  return entry.id;
}
