import fs from "node:fs";
import path from "node:path";
import type { IndexingProgress, RagState } from "@dst0/p-code-index";
import { getAgentDir } from "../config.ts";
import {
  disableIndexingForRepo,
  enableIndexingForRepo,
  prioritizeIndexingForRepo,
  type RepoIndexingDecision,
} from "./indexed-repos.ts";
import { readIndexingSelectionConfiguration } from "./indexing-config-reader.ts";
import { type RepoDecisionInfo, resolveRepoDecision } from "./indexing-decision-inheritance.ts";

export const INDEXING_SERVICE_STATUS_FILE = "indexing-service-status.json";
export const INDEXING_SERVICE_REINSTALL_FILE = "indexing-service-reinstall.json";
const INDEXING_SERVICE_REINSTALL_GRACE_MS = 5 * 60_000;

export interface IndexStatus {
  decision: RepoIndexingDecision;
  indexed: boolean;
  /** Set when this repo has no decision of its own but is a linked worktree whose main
   * checkout does; the worktree is never auto-indexed, only exempted from the prompt. */
  inheritedFrom?: string;
  serviceRunning: boolean;
  configuredDevice?: string;
  configuredMaxBatchSize?: number;
  ragState?: RagState | "queued" | "error";
  ragFiles?: number;
  ragChunks?: number;
  totalFiles?: number;
  totalChunks?: number;
  progress?: IndexingProgress;
  lastError?: string;
}

export function getConfiguredIndexingDevice(agentDir: string = getAgentDir()): string | undefined {
  return readIndexingSelectionConfiguration(agentDir).device;
}

export function getConfiguredIndexingBatchSize(agentDir: string = getAgentDir()): number | undefined {
  return readIndexingSelectionConfiguration(agentDir).maxBatchSize;
}

export interface RepositoryServiceStatus {
  path: string;
  state: RagState | "queued" | "error";
  indexedFiles: number;
  indexedChunks: number;
  updatedAt: string;
  progress?: IndexingProgress;
  lastError?: string;
}

export interface IndexingRuntimeProvenance {
  daemonPath: string;
  runtimeRoot: string;
}

export interface IndexingServiceStatusData {
  pid: number;
  running: boolean;
  startedAt: string;
  updatedAt: string;
  repos: RepositoryServiceStatus[];
  /** Content hash of indexing-related code; used to skip unnecessary restarts. */
  indexingVersion?: string;
  /** Hash of the runtime configuration captured when the daemon started. */
  runtimeConfigFingerprint?: string;
  /** Canonical daemon executable and checkout root captured at daemon startup. */
  runtimeProvenance?: IndexingRuntimeProvenance;
}

interface IndexingServiceReinstallData {
  pid: number;
  startedAt: string;
}

export class IndexingService {
  private readonly agentDir: string;

  constructor(agentDir: string = getAgentDir()) {
    this.agentDir = agentDir;
  }

  getDecision(workspaceRoot: string): RepoIndexingDecision {
    return this.resolveDecision(workspaceRoot).decision;
  }

  /**
   * Resolves the indexing decision for `workspaceRoot`, inheriting a linked git worktree's
   * main checkout decision (without persisting or auto-indexing anything) so the worktree
   * does not re-prompt for a decision the main checkout already made. See
   * `indexing-decision-inheritance.ts` for the inheritance and caching rules.
   */
  resolveDecision(workspaceRoot: string): RepoDecisionInfo {
    return resolveRepoDecision(workspaceRoot, this.agentDir);
  }

  getStatus(workspaceRoot: string): IndexStatus {
    const resolved = canonicalizePath(workspaceRoot);
    const decisionInfo = this.resolveDecision(resolved);
    const daemonStatus = readServiceStatus(this.agentDir);
    const repoStatus = daemonStatus?.repos.find((entry) => canonicalizePath(entry.path) === resolved);
    const configuredDevice = getConfiguredIndexingDevice(this.agentDir);
    const configuredMaxBatchSize = getConfiguredIndexingBatchSize(this.agentDir);
    return {
      decision: decisionInfo.decision,
      indexed: decisionInfo.decision === "enabled",
      inheritedFrom: decisionInfo.inheritedFrom,
      serviceRunning: daemonStatus?.running === true,
      configuredDevice,
      configuredMaxBatchSize,
      ragState: repoStatus?.state,
      ragFiles: repoStatus?.indexedFiles,
      ragChunks: repoStatus?.indexedChunks,
      totalFiles: repoStatus?.progress?.totalFiles,
      totalChunks: repoStatus?.progress?.totalChunks,
      progress: repoStatus?.progress,
      lastError: repoStatus?.lastError,
    };
  }

  enableIndexing(workspaceRoot: string): void {
    enableIndexingForRepo(workspaceRoot, this.agentDir);
  }

  disableIndexing(workspaceRoot: string): void {
    disableIndexingForRepo(workspaceRoot, this.agentDir);
  }

  prioritizeIndexing(workspaceRoot: string): boolean {
    return prioritizeIndexingForRepo(workspaceRoot, this.agentDir) !== undefined;
  }

  isEnabled(workspaceRoot: string): boolean {
    return this.getDecision(workspaceRoot) === "enabled";
  }
}

export function writeIndexingServiceStatus(agentDir: string, value: IndexingServiceStatusData): void {
  const filePath = path.join(agentDir, INDEXING_SERVICE_STATUS_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export function getIndexingRuntimeProvenance(daemonPath: string | undefined): IndexingRuntimeProvenance | undefined {
  if (!daemonPath) return undefined;
  try {
    const canonicalDaemonPath = fs.realpathSync(daemonPath);
    const runtimeRoot = fs.realpathSync(path.resolve(path.dirname(canonicalDaemonPath), "../../.."));
    return { daemonPath: canonicalDaemonPath, runtimeRoot };
  } catch {
    return undefined;
  }
}

let indexingServiceInstance: IndexingService | undefined;

export function getIndexingService(): IndexingService {
  indexingServiceInstance ??= new IndexingService();
  return indexingServiceInstance;
}

function readServiceStatus(agentDir: string): IndexingServiceStatusData | undefined {
  const filePath = path.join(agentDir, INDEXING_SERVICE_STATUS_FILE);
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!isServiceStatus(value)) return undefined;
    if (isReinstallingService(agentDir, value.pid)) return { ...value, running: true };
    if (value.running && !isProcessAlive(value.pid)) return { ...value, running: false };
    return value;
  } catch {
    return undefined;
  }
}

function isReinstallingService(agentDir: string, pid: number): boolean {
  const filePath = path.join(agentDir, INDEXING_SERVICE_REINSTALL_FILE);
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!isReinstallData(value) || value.pid !== pid) return false;
    const startedAt = Date.parse(value.startedAt);
    if (!Number.isFinite(startedAt)) return false;
    const ageMs = Date.now() - startedAt;
    return ageMs >= 0 && ageMs <= INDEXING_SERVICE_REINSTALL_GRACE_MS;
  } catch {
    return false;
  }
}

function isServiceStatus(value: unknown): value is IndexingServiceStatusData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexingServiceStatusData>;
  return (
    typeof candidate.pid === "number" &&
    typeof candidate.running === "boolean" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.runtimeConfigFingerprint === undefined || typeof candidate.runtimeConfigFingerprint === "string") &&
    (candidate.runtimeProvenance === undefined || isRuntimeProvenance(candidate.runtimeProvenance)) &&
    Array.isArray(candidate.repos) &&
    candidate.repos.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.path === "string" &&
        typeof entry.state === "string" &&
        typeof entry.indexedFiles === "number" &&
        typeof entry.indexedChunks === "number" &&
        typeof entry.updatedAt === "string" &&
        (entry.lastError === undefined || typeof entry.lastError === "string") &&
        (entry.progress === undefined || isIndexingProgress(entry.progress)),
    )
  );
}

function isRuntimeProvenance(value: unknown): value is IndexingRuntimeProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexingRuntimeProvenance>;
  return (
    typeof candidate.daemonPath === "string" &&
    path.isAbsolute(candidate.daemonPath) &&
    typeof candidate.runtimeRoot === "string" &&
    path.isAbsolute(candidate.runtimeRoot)
  );
}

function isReinstallData(value: unknown): value is IndexingServiceReinstallData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexingServiceReinstallData>;
  return Number.isSafeInteger(candidate.pid) && typeof candidate.startedAt === "string";
}

function isIndexingProgress(value: unknown): value is IndexingProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexingProgress>;
  return (
    (candidate.phase === "scanning" ||
      candidate.phase === "preparing" ||
      candidate.phase === "indexing" ||
      candidate.phase === "finalizing") &&
    typeof candidate.percent === "number" &&
    Number.isFinite(candidate.percent) &&
    candidate.percent >= 0 &&
    candidate.percent <= 100 &&
    (candidate.processedFiles === undefined ||
      (typeof candidate.processedFiles === "number" && Number.isFinite(candidate.processedFiles))) &&
    (candidate.totalFiles === undefined ||
      (typeof candidate.totalFiles === "number" && Number.isFinite(candidate.totalFiles))) &&
    (candidate.processedChunks === undefined ||
      (typeof candidate.processedChunks === "number" && Number.isFinite(candidate.processedChunks))) &&
    (candidate.totalChunks === undefined ||
      (typeof candidate.totalChunks === "number" && Number.isFinite(candidate.totalChunks))) &&
    (candidate.startedAt === undefined || typeof candidate.startedAt === "string") &&
    (candidate.etaSeconds === undefined ||
      (typeof candidate.etaSeconds === "number" && Number.isFinite(candidate.etaSeconds))) &&
    (candidate.reusedChunks === undefined ||
      (typeof candidate.reusedChunks === "number" && Number.isFinite(candidate.reusedChunks))) &&
    (candidate.recalculatedChunks === undefined ||
      (typeof candidate.recalculatedChunks === "number" && Number.isFinite(candidate.recalculatedChunks))) &&
    (candidate.recalculatedTotal === undefined ||
      (typeof candidate.recalculatedTotal === "number" && Number.isFinite(candidate.recalculatedTotal)))
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function canonicalizePath(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}
