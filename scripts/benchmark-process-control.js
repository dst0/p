import { spawnSync } from "node:child_process";

export function benchmarkProcessGroupOptions(options, platform = process.platform) {
  return platform === "win32" ? options : { ...options, detached: true };
}

export async function terminateBenchmarkProcessTree(child, graceMs, operations = {}) {
  const processGroups = collectProcessGroups(child, operations);
  signalProcessGroups(child, processGroups, "SIGTERM", operations);
  if (await waitForProcessTreeExit(child, processGroups, graceMs, operations)) return true;
  for (const group of collectProcessGroups(child, operations)) processGroups.add(group);
  signalProcessGroups(child, processGroups, "SIGKILL", operations);
  return waitForProcessTreeExit(child, processGroups, operations.killWaitMs ?? 1_500, operations);
}

async function waitForProcessTreeExit(child, processGroups, timeoutMs, operations) {
  const deadline = Date.now() + timeoutMs;
  while (processTreeExists(child, processGroups, operations)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())));
  }
  return true;
}

function processTreeExists(child, processGroups, operations) {
  const platform = operations.platform ?? process.platform;
  if (platform === "win32" || !Number.isInteger(child.pid) || child.pid <= 0) {
    return child.exitCode === null && child.signalCode === null;
  }
  const rows = processRows((operations.listProcesses ?? listProcesses)());
  if (rows) {
    return rows.some((row) => processGroups.has(row.processGroup) && !row.state.startsWith("Z"));
  }
  return [...processGroups].some((processGroup) => processGroupExists(processGroup, operations));
}

function processGroupExists(processGroup, operations) {
  try {
    (operations.kill ?? process.kill)(-processGroup, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function signalProcessGroups(child, processGroups, signal, operations) {
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

function collectProcessGroups(child, operations) {
  const platform = operations.platform ?? process.platform;
  const groups = new Set([child.pid]);
  if (platform === "win32" || !Number.isInteger(child.pid) || child.pid <= 0) return groups;
  const result = (operations.listProcesses ?? listProcesses)();
  const rows = processRows(result);
  if (!rows) return groups;
  const descendants = new Set([child.pid]);
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

function listProcesses() {
  return spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat="], { encoding: "utf8" });
}

function processRows(result) {
  if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
  return result.stdout.trim().split(/\r?\n/u).map((line) => {
    const [pid, parentPid, processGroup, state = ""] = line.trim().split(/\s+/u);
    return { pid: Number(pid), parentPid: Number(parentPid), processGroup: Number(processGroup), state };
  });
}

export function signalBenchmarkProcessTree(child, signal, operations = {}) {
  const platform = operations.platform ?? process.platform;
  const kill = operations.kill ?? process.kill;
  if (platform !== "win32" && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      kill(-child.pid, signal);
      return true;
    } catch {
      // Fall back to the direct child when process groups are unavailable.
    }
  }
  try {
    return child.kill(signal);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}
