import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyBenchmarkAuthSource } from "./benchmark-auth-source.js";

function copyOptionalPrivateFile(source, destination) {
  if (typeof source !== "string" || !existsSync(source)) return;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}

export function createBenchmarkAgentDirectories(options, temporaryParent = tmpdir()) {
  const root = mkdtempSync(join(temporaryParent, "p-agent-benchmark-config-"));
  chmodSync(root, 0o700);
  try {
    const dirs = {};
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
