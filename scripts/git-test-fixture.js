import { execFileSync } from "node:child_process";

const disabledMaintenanceConfig = [
  ["maintenance.auto", "false"],
  ["maintenance.autoDetach", "false"],
  ["gc.auto", "0"],
  ["gc.autoDetach", "false"],
];

export function disableDetachedGitMaintenance(repoRoot) {
  for (const [key, value] of disabledMaintenanceConfig) {
    execFileSync("git", ["config", "--local", key, value], { cwd: repoRoot });
  }
}
