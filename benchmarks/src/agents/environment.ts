import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function augmentBenchmarkPath(repoRoot: string): string {
  const separator = process.platform === "win32" ? ";" : ":";
  const extraDirs = [
    dirname(process.execPath),
    join(repoRoot, "node_modules", ".bin"),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const nvmVersionsDir = join(homedir(), ".nvm", "versions", "node");
  if (existsSync(nvmVersionsDir)) {
    try {
      for (const entry of readdirSync(nvmVersionsDir)) extraDirs.push(join(nvmVersionsDir, entry, "bin"));
    } catch {
      // Optional PATH discovery must not block a benchmark.
    }
  }
  return `${extraDirs.filter((directory) => existsSync(directory)).join(separator)}${separator}${process.env.PATH ?? ""}`;
}
