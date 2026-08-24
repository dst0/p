import { spawnSync } from "node:child_process";

interface BenchmarkChildProcess {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean | undefined;
}

interface ProcessListResult {
  status: number | null;
  stdout?: string | Buffer;
}

interface ProcessControlOperations {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  listProcesses?: () => ProcessListResult;
  killWaitMs?: number;
}

interface ProcessRow {
  pid: number;
  parentPid: number;
  processGroup: number;
  state: string;
}

export function benchmarkProcessGroupOptions<T extends object>(
  options: T,
  platform: NodeJS.Platform = process.platform,
): T & { detached?: boolean } {
  return platform === "win32" ? options : { ...options, detached: true };
}

export async function terminateBenchmarkProcessTree(
  child: BenchmarkChildProcess,
  graceMs: number,
  operations: ProcessControlOperations = {},
): Promise<boolean> {
  const processGroups = collectProcessGroups(child, operations);
  signalProcessGroups(child, processGroups, "SIGTERM", operations);
  if (await waitForProcessTreeExit(child, processGroups, graceMs, operations)) return true;
  for (const group of collectProcessGroups(child, operations)) processGroups.add(group);
  signalProcessGroups(child, processGroups, "SIGKILL", operations);
  return waitForProcessTreeExit(child, processGroups, operations.killWaitMs ?? 1_500, operations);
}

async function waitForProcessTreeExit(
  child: BenchmarkChildProcess,
  processGroups: ReadonlySet<number>,
  timeoutMs: number,
  operations: ProcessControlOperations,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processTreeExists(child, processGroups, operations)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())));
  }
  return true;
}

function processTreeExists(
  child: BenchmarkChildProcess,
  processGroups: ReadonlySet<number>,
  operations: ProcessControlOperations,
): boolean {
  const platform = operations.platform ?? process.platform;
  const childPid = child.pid;
  if (platform === "win32" || typeof childPid !== "number" || !Number.isInteger(childPid) || childPid <= 0) {
    return child.exitCode === null && child.signalCode === null;
  }
  const rows = processRows((operations.listProcesses ?? listProcesses)());
  if (rows) {
    return rows.some((row) => processGroups.has(row.processGroup) && !row.state.startsWith("Z"));
  }
  return [...processGroups].some(
    (processGroup) => processGroup !== undefined && processGroupExists(processGroup, operations),
  );
}

function processGroupExists(processGroup: number, operations: ProcessControlOperations): boolean {
  try {
    (operations.kill ?? process.kill)(-processGroup, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalProcessGroups(
  child: BenchmarkChildProcess,
  processGroups: ReadonlySet<number>,
  signal: NodeJS.Signals,
  operations: ProcessControlOperations,
): void {
  const rootGroup = child.pid;
  for (const processGroup of processGroups) {
    if (processGroup === rootGroup) continue;
    try {
      (operations.kill ?? process.kill)(-processGroup, signal);
    } catch {
      // A descendant group may have exited after discovery.
    }
  }
  signalBenchmarkProcessTree(child, signal, operations);
}

function collectProcessGroups(child: BenchmarkChildProcess, operations: ProcessControlOperations): Set<number> {
  const platform = operations.platform ?? process.platform;
  const groups = new Set<number>();
  const childPid = child.pid;
  if (typeof childPid === "number" && Number.isInteger(childPid) && childPid > 0) groups.add(childPid);
  if (platform === "win32" || typeof childPid !== "number" || !Number.isInteger(childPid) || childPid <= 0) {
    return groups;
  }
  const result = (operations.listProcesses ?? listProcesses)();
  const rows = processRows(result);
  if (!rows) return groups;
  const descendants = new Set([childPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!descendants.has(row.parentPid) || descendants.has(row.pid)) continue;
      descendants.add(row.pid);
      changed = true;
    }
  }
  for (const row of rows) {
    if (descendants.has(row.pid) && row.processGroup > 0) groups.add(row.processGroup);
  }
  return groups;
}

function listProcesses(): ProcessListResult {
  return spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat="], { encoding: "utf8" });
}

function processRows(result: ProcessListResult): ProcessRow[] | undefined {
  if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
  return result.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const [pid, parentPid, processGroup, state = ""] = line.trim().split(/\s+/u);
      return { pid: Number(pid), parentPid: Number(parentPid), processGroup: Number(processGroup), state };
    });
}

export function signalBenchmarkProcessTree(
  child: BenchmarkChildProcess,
  signal: NodeJS.Signals,
  operations: ProcessControlOperations = {},
): boolean | undefined {
  const platform = operations.platform ?? process.platform;
  const kill = operations.kill ?? process.kill;
  const childPid = child.pid;
  if (platform !== "win32" && typeof childPid === "number" && Number.isInteger(childPid) && childPid > 0) {
    try {
      kill(-childPid, signal);
      return true;
    } catch {
      // Fall back to the direct child when process groups are unavailable.
    }
  }
  try {
    return child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
