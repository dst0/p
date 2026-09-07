import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { join } from "node:path";
import { sanitizeBenchmarkGitEnvironment } from "../harness/workspace-repository.ts";
import { repoRoot } from "./runner-options.ts";

export function runFixtureCommand(
  workspace: string,
  args: readonly string[],
  envOverrides: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  const separator = process.platform === "win32" ? ";" : ":";
  const environment = {
    ...sanitizeBenchmarkGitEnvironment(),
    PATH: `${join(repoRoot, "node_modules", ".bin")}${separator}${process.env.PATH ?? ""}`,
    NO_COLOR: "1",
    ...envOverrides,
  };
  return spawnSync("npm", [...args], {
    cwd: workspace,
    env: sanitizeBenchmarkGitEnvironment(environment),
    encoding: "utf8",
    timeout: 60_000,
  });
}

export function parseNamedNodeTests(output: string, prefix: string): ReadonlyMap<string, boolean> {
  const results = new Map<string, boolean>();
  const pattern = new RegExp(`^\\s*(not ok|ok)\\s+\\d+\\s+-\\s+\\[${prefix}:([^\\]]+)\\]`, "gmu");
  for (const match of output.matchAll(pattern)) {
    const id = match[2];
    if (id) results.set(id, match[1] === "ok");
  }
  return results;
}
