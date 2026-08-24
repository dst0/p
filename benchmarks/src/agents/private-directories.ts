import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyBenchmarkAuthSource } from "../harness/auth-source.ts";

export interface BenchmarkAgentDirectoryOptions {
  modelsFile?: string;
  authFile: string;
  kiloConfig?: string;
  codexConfig?: string;
}

export interface BenchmarkAgentDirectories {
  root: string;
  dirs: Record<string, string>;
  dispose(): void;
}

function copyOptionalPrivateFile(source: string | undefined, destination: string): void {
  if (typeof source !== "string" || !existsSync(source)) return;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}

export function createBenchmarkAgentDirectories(
  options: BenchmarkAgentDirectoryOptions,
  temporaryParent = tmpdir(),
): BenchmarkAgentDirectories {
  const root = mkdtempSync(join(temporaryParent, "p-agent-benchmark-config-"));
  chmodSync(root, 0o700);
  try {
    const dirs: Record<string, string> = {};
    for (const agent of ["pi", "p"]) {
      const dir = join(root, agent);
      mkdirSync(dir, { recursive: true });
      copyOptionalPrivateFile(options.modelsFile, join(dir, "models.json"));
      copyBenchmarkAuthSource(options.authFile, join(dir, "auth.json"));
      dirs[agent] = dir;
    }
    const kiloDir = join(root, "kilo");
    const kiloConfigDir = join(kiloDir, "config", "kilo");
    mkdirSync(kiloConfigDir, { recursive: true });
    copyOptionalPrivateFile(options.kiloConfig, join(kiloConfigDir, "kilo.jsonc"));
    dirs.kilo = kiloDir;
    const codexDir = join(root, "codex");
    mkdirSync(codexDir, { recursive: true });
    copyOptionalPrivateFile(options.codexConfig, join(codexDir, "config.toml"));
    dirs.codex = codexDir;
    dirs.agy = join(root, "agy");
    mkdirSync(dirs.agy, { recursive: true });
    return { root, dirs, dispose: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
