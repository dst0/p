import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IndexingProgress, RagState } from "@dst0/p-code-index";
import { getAgentDir } from "../config.ts";
import {
  disableIndexingForRepo,
  enableIndexingForRepo,
  getRepoIndexingDecision,
  prioritizeIndexingForRepo,
  type RepoIndexingDecision,
} from "./indexed-repos.ts";

export const INDEXING_SERVICE_STATUS_FILE = "indexing-service-status.json";
export const INDEXING_SERVICE_REINSTALL_FILE = "indexing-service-reinstall.json";
const INDEXING_SERVICE_REINSTALL_GRACE_MS = 5 * 60_000;

export interface IndexStatus {
  decision: RepoIndexingDecision;
  indexed: boolean;
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
  try {
    const filePath = path.join(agentDir, "indexing-device");
    if (!fs.existsSync(filePath)) return undefined;
    const val = fs.readFileSync(filePath, "utf-8").trim();
    return val || undefined;
  } catch {
    return undefined;
  }
}

export function getConfiguredIndexingBatchSize(agentDir: string = getAgentDir()): number | undefined {
  try {
    const filePath = path.join(agentDir, "indexing-max-batch-size");
    if (!fs.existsSync(filePath)) return undefined;
    const val = parseInt(fs.readFileSync(filePath, "utf-8").trim(), 10);
    return Number.isFinite(val) && val > 0 ? val : undefined;
  } catch {
    return undefined;
  }
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

export interface IndexingServiceStatusData {
  pid: number;
  running: boolean;
  startedAt: string;
  updatedAt: string;
  repos: RepositoryServiceStatus[];
  /** Content hash of indexing-related code; used to skip unnecessary restarts. */
  indexingVersion?: string;
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
    return getRepoIndexingDecision(workspaceRoot, this.agentDir);
  }

  getStatus(workspaceRoot: string): IndexStatus {
    const resolved = canonicalizePath(workspaceRoot);
    const decision = this.getDecision(resolved);
    const daemonStatus = readServiceStatus(this.agentDir);
    const repoStatus = daemonStatus?.repos.find((entry) => canonicalizePath(entry.path) === resolved);
    const configuredDevice = getConfiguredIndexingDevice(this.agentDir);
    const configuredMaxBatchSize = getConfiguredIndexingBatchSize(this.agentDir);
    return {
      decision,
      indexed: decision === "enabled",
      serviceRunning: daemonStatus?.running === true,
      configuredDevice,
      configuredMaxBatchSize,
      ragState: repoStatus?.state,
      ragFiles: repoStatus?.indexedFiles,
      ragChunks: repoStatus?.indexedChunks,
      totalFiles: repoStatus?.progress?.totalFiles ?? repoStatus?.indexedFiles,
      totalChunks: repoStatus?.progress?.totalChunks ?? repoStatus?.indexedChunks,
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

function isReinstallData(value: unknown): value is IndexingServiceReinstallData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexingServiceReinstallData>;
  return Number.isSafeInteger(candidate.pid) && typeof candidate.startedAt === "string";
}

function isIndexingProgress(value: unknown): value is IndexingProgress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<IndexingProgress>;
  return (
    (candidate.phase === "scanning" || candidate.phase === "indexing" || candidate.phase === "finalizing") &&
    typeof candidate.percent === "number" &&
    Number.isFinite(candidate.percent) &&
    candidate.percent >= 0 &&
    candidate.percent <= 100 &&
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

/**
 * Compute a deterministic content hash of all indexing-related code.
 * Used by the daemon and reinstall scripts to detect whether the indexing
 * runtime has actually changed, allowing them to skip disruptive operations.
 *
 * @param projectRoot - Root of the p monorepo (resolved automatically when omitted).
 */
export function computeIndexingVersion(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot();
  const files = collectIndexingFiles(root);
  const hash = createHash("sha256");
  for (const filePath of files.sort()) {
    try {
      const content = fs.readFileSync(filePath);
      const relativePath = path.relative(root, filePath);
      hash.update(relativePath);
      hash.update(content);
    } catch {
      // If a file disappears during computation, skip it gracefully.
    }
  }
  return hash.digest("hex");
}

function fileExists(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function collectIndexingFiles(projectRoot: string): string[] {
  const files: string[] = [];
  const agentDistDir = path.join(projectRoot, "packages", "coding-agent", "dist");
  const agentSrcDir = path.join(projectRoot, "packages", "coding-agent", "src");
  const codeIndexDir = path.join(projectRoot, "packages", "code-index");

  // Standalone daemon entry point
  const standaloneDaemon = path.join(agentDistDir, "indexing-service-daemon.js");
  if (fileExists(standaloneDaemon)) files.push(standaloneDaemon);

  // Core daemon runtime files (discover all indexing*.js or indexing*.ts files)
  const daemonCoreDistDir = path.join(agentDistDir, "core");
  const daemonCoreSrcDir = path.join(agentSrcDir, "core");
  if (dirExists(daemonCoreDistDir)) {
    collectMatchingFiles(daemonCoreDistDir, files, (name) => name.startsWith("indexing") && name.endsWith(".js"));
  } else if (dirExists(daemonCoreSrcDir)) {
    collectMatchingFiles(daemonCoreSrcDir, files, (name) => name.startsWith("indexing") && name.endsWith(".ts"));
  }

  // Service installer and helper scripts
  const installerScripts = [
    path.join(projectRoot, "scripts", "install-indexing-service.js"),
    path.join(projectRoot, "scripts", "indexing-device-selection.sh"),
    path.join(projectRoot, "scripts", "prepare-indexing-service-reinstall.js"),
    path.join(projectRoot, "scripts", "compute-indexing-version.js"),
  ];
  for (const file of installerScripts) {
    if (fileExists(file)) files.push(file);
  }

  // code-index compiled files
  const codeIndexDistDir = path.join(codeIndexDir, "dist");
  if (dirExists(codeIndexDistDir)) {
    collectJsFiles(codeIndexDistDir, files, [".js"]);
  }

  // code-index Python files
  const pythonFiles = ["embedding_server.py", "resource_manager.py"];
  for (const file of pythonFiles) {
    const filePath = path.join(codeIndexDir, file);
    if (fileExists(filePath)) files.push(filePath);
  }

  // code-index Python package
  const codeIndexPyDir = path.join(codeIndexDir, "src", "code-index");
  if (dirExists(codeIndexPyDir)) {
    collectJsFiles(codeIndexPyDir, files, [".py"]);
  }

  // code-index Python backends package
  const embeddingBackendsDir = path.join(codeIndexDir, "embedding_backends");
  if (dirExists(embeddingBackendsDir)) {
    collectJsFiles(embeddingBackendsDir, files, [".py"]);
  }

  // code-index Swift worker
  const swiftWorkerDir = path.join(codeIndexDir, "apple-ane-worker", "Sources");
  if (dirExists(swiftWorkerDir)) {
    collectJsFiles(swiftWorkerDir, files, [".swift"]);
  }

  // code-index config
  const configFiles = ["requirements.txt", "pyproject.toml"];
  for (const file of configFiles) {
    const filePath = path.join(codeIndexDir, file);
    if (fileExists(filePath)) files.push(filePath);
  }

  return files;
}

function collectMatchingFiles(dir: string, result: string[], filter: (name: string) => boolean): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && filter(entry.name)) {
        result.push(path.join(dir, entry.name));
      }
    }
  } catch {
    // Directory may not exist in all environments.
  }
}

function collectJsFiles(dir: string, result: string[], extensions: string[] = [".js"]): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectJsFiles(fullPath, result, extensions);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        result.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist in all environments.
  }
}

function resolveProjectRoot(): string {
  // Navigate from this compiled file back to the monorepo root.
  // Works for both source (src/) and compiled (dist/) locations.
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(current, "packages"))) {
      // Verify this is the p monorepo by checking for packages/coding-agent
      if (fs.existsSync(path.join(current, "packages", "coding-agent"))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: use the agent dir's known ancestor
  return path.dirname(path.dirname(path.dirname(getAgentDir())));
}
