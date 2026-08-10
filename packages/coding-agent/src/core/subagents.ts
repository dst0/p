import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@dst0/p-agent-core";

export type SubagentName = "explore" | "scout" | "review" | "compact";
export type SubagentMode = "subagent" | "system";
export type SubagentPermission = "allow" | "deny" | "ask";

const PERMISSION_TO_TOOL: Record<string, string[]> = {
  read: ["read"],
  grep: ["rg", "grep"],
  list: ["ls", "find"],
  edit: ["edit", "write"],
  bash: ["bash"],
  web: [],
  diff: [],
  test: [],
};

export const SUBAGENT_MAX_TURNS = 8;

export interface SubagentProfile {
  name: SubagentName;
  mode: SubagentMode;
  hidden?: boolean;
  description: string;
  permissions: {
    read?: SubagentPermission;
    grep?: SubagentPermission;
    list?: SubagentPermission;
    edit?: SubagentPermission;
    bash?: SubagentPermission;
    web?: SubagentPermission;
    diff?: SubagentPermission;
    test?: SubagentPermission;
  };
}

export interface SubagentDigest {
  id: string;
  profile: SubagentName;
  query: string;
  summary: string;
  evidencePointers: string[];
  transcriptPath?: string;
  createdAt: string;
  sessionId: string;
  parentEntryId: string | null;
}

export interface SubagentStorageTarget {
  sessionDir: string;
  sessionId: string;
  isPersisted: boolean;
}

export interface DigestFilter {
  sessionId: string;
  validEntryIds: ReadonlySet<string> | readonly string[];
}

function validateTarget(target: SubagentStorageTarget): void {
  if (!target || typeof target !== "object" || typeof target.sessionId !== "string" || !target.sessionId.trim()) {
    throw new Error("Invalid target or sessionId");
  }
}

export function getSubagentStorageDir(target: SubagentStorageTarget): string {
  validateTarget(target);
  if (target.isPersisted && target.sessionDir) {
    return join(target.sessionDir, "artifacts", target.sessionId, "subagents");
  }
  return join(tmpdir(), "p-subagents", target.sessionId);
}

export const BUILTIN_SUBAGENT_PROFILES: readonly SubagentProfile[] = [
  {
    name: "explore",
    mode: "subagent",
    description: "Read-only exploration.",
    permissions: { read: "allow", grep: "allow", list: "allow", edit: "deny", bash: "deny" },
  },
  {
    name: "scout",
    mode: "subagent",
    description: "Read-only external research.",
    permissions: { web: "allow", read: "allow", edit: "deny", bash: "deny" },
  },
  {
    name: "review",
    mode: "subagent",
    description: "Read-only diff/test review.",
    permissions: { diff: "allow", test: "ask", read: "allow", edit: "deny" },
  },
  {
    name: "compact",
    mode: "system",
    hidden: true,
    description: "Compaction worker.",
    permissions: { read: "allow", edit: "deny", bash: "deny" },
  },
];

export function createSubagentProfilesPrompt(): string {
  return [
    "<subagent_profiles>",
    "Use subagents for noisy exploration. Cite digests, do not paste transcripts.",
    ...BUILTIN_SUBAGENT_PROFILES.filter((profile) => !profile.hidden).map(
      (profile) => `- ${profile.name}: ${profile.description} permissions=${JSON.stringify(profile.permissions)}`,
    ),
    "</subagent_profiles>",
  ].join("\n");
}

export function persistSubagentDigest(
  target: SubagentStorageTarget,
  digest: Omit<SubagentDigest, "id" | "createdAt"> & { id?: string },
): SubagentDigest {
  validateTarget(target);
  if (digest.sessionId !== target.sessionId) {
    throw new Error("Digest sessionId must match target sessionId");
  }
  if (digest.parentEntryId !== null && (typeof digest.parentEntryId !== "string" || !digest.parentEntryId.trim())) {
    throw new Error("Digest parentEntryId must be null or string");
  }
  const full: SubagentDigest = {
    profile: digest.profile,
    query: digest.query,
    summary: digest.summary,
    evidencePointers: digest.evidencePointers,
    transcriptPath: digest.transcriptPath,
    id: digest.id ?? `subagent:${digest.profile}:${randomUUID()}`,
    createdAt: new Date().toISOString(),
    sessionId: digest.sessionId,
    parentEntryId: digest.parentEntryId,
  };
  const storageDir = getSubagentStorageDir(target);
  const path = join(storageDir, "subagent-digests.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(full)}\n`);
  return full;
}

export function readSubagentDigests(target: SubagentStorageTarget, filter: DigestFilter): SubagentDigest[] {
  validateTarget(target);
  if (!filter || filter.sessionId !== target.sessionId || !filter.validEntryIds) {
    throw new Error("Invalid filter configuration");
  }
  const validSet = filter.validEntryIds instanceof Set ? filter.validEntryIds : new Set(filter.validEntryIds);
  const storageDir = getSubagentStorageDir(target);
  const path = join(storageDir, "subagent-digests.jsonl");
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isSubagentDigest(parsed) || parsed.sessionId !== filter.sessionId) return [];
        if (parsed.parentEntryId !== null && !validSet.has(parsed.parentEntryId)) return [];
        return [parsed];
      } catch {
        return [];
      }
    });
}

export function persistSubagentTranscript(target: SubagentStorageTarget, id: string, messages: AgentMessage[]): string {
  validateTarget(target);
  const safeId = id.replace(/[^A-Za-z0-9_.:-]+/g, "_");
  const storageDir = getSubagentStorageDir(target);
  const path = join(storageDir, `${safeId}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const body = messages.map((message) => JSON.stringify({ type: "message", message })).join("\n");
  appendFileSync(path, body.length > 0 ? `${body}\n` : "");
  return path;
}

export function createSubagentDigestContext(
  target: SubagentStorageTarget,
  query: string,
  filter: DigestFilter,
): string | undefined {
  const terms = tokenize(query);
  if (terms.length === 0) return undefined;
  const digests = readSubagentDigests(target, filter)
    .map((digest) => ({ digest, score: scoreDigest(digest, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (digests.length === 0) return undefined;
  return [
    "<subagent_digests>",
    ...digests.map(
      ({ digest }) =>
        `- ${digest.id} [${digest.profile}] ${digest.summary} evidence=${digest.evidencePointers.join(",") || "(none)"}`,
    ),
    "</subagent_digests>",
  ].join("\n");
}

function scoreDigest(digest: SubagentDigest, terms: string[]): number {
  const text = `${digest.profile} ${digest.query} ${digest.summary} ${digest.evidencePointers.join(" ")}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score++;
  }
  return score;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function getSubagentAllowedTools(profile: SubagentName): Set<string> {
  const subagentProfile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.name === profile);
  if (!subagentProfile) return new Set();

  const allowed = new Set<string>();
  for (const [perm, tools] of Object.entries(subagentProfile.permissions)) {
    if (perm === "web" || perm === "diff" || perm === "test") continue;
    if (tools === undefined) continue;
    if (
      perm in subagentProfile.permissions &&
      subagentProfile.permissions[perm as keyof typeof subagentProfile.permissions] === "allow"
    ) {
      for (const tool of PERMISSION_TO_TOOL[perm] ?? []) {
        allowed.add(tool);
      }
    }
  }
  allowed.add("session_recall");
  return allowed;
}

export interface RunSubagentInput {
  profile: SubagentName;
  task: string;
}

export interface RunSubagentResult {
  id: string;
  profile: SubagentName;
  task: string;
  summary: string;
  evidencePointers: string[];
  turnCount: number;
}

function isSubagentDigest(value: unknown): value is SubagentDigest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const isStr = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  return (
    isStr(r.id) &&
    isStr(r.profile) &&
    typeof r.query === "string" &&
    typeof r.summary === "string" &&
    Array.isArray(r.evidencePointers) &&
    r.evidencePointers.every(isStr) &&
    (r.transcriptPath === undefined || isStr(r.transcriptPath)) &&
    isStr(r.sessionId) &&
    (r.parentEntryId === null || isStr(r.parentEntryId)) &&
    isStr(r.createdAt)
  );
}
