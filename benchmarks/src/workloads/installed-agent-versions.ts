import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentId, RunnerOptions } from "./runner-options.ts";

export type AgentVersions = Partial<Record<AgentId, string>> & { pi: string; p: string };

function packageVersion(packagePath: string): string {
  const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`Invalid package manifest: ${packagePath}`);
  const version = (parsed as Record<string, unknown>).version;
  if (typeof version !== "string" || !version) throw new Error(`Missing package version: ${packagePath}`);
  return version;
}

function executableVersion(executable: string): string {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Unable to run ${executable} --version`);
  return result.stdout.trim();
}

export function resolveAgentVersions(options: RunnerOptions): AgentVersions {
  const versions: AgentVersions = {
    pi: options.piVersion,
    p: packageVersion(resolve(dirname(options.pCli), "..", "package.json")),
  };
  if (options.agents.includes("kilo")) {
    const installedKiloVersion = executableVersion("kilo");
    if (installedKiloVersion !== options.kiloVersion) {
      throw new Error(`Installed Kilo version is ${installedKiloVersion}; expected ${options.kiloVersion}`);
    }
    versions.kilo = installedKiloVersion;
  }
  if (options.agents.includes("codex")) versions.codex = executableVersion("codex");
  if (options.agents.includes("agy")) versions.agy = executableVersion("agy");
  return versions;
}
