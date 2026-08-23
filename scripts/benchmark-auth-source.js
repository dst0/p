import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function resolveBenchmarkAuthSource(environment = process.env) {
  const explicit = environment.P_BENCHMARK_AUTH_FILE;
  return typeof explicit === "string" && explicit.length > 0
    ? explicit
    : join(homedir(), ".p", "agent", "auth.json");
}

export function consumeBenchmarkAuthSource(environment = process.env) {
  const source = resolveBenchmarkAuthSource(environment);
  delete environment.P_BENCHMARK_AUTH_FILE;
  return source;
}

export function copyBenchmarkAuthSource(source, destination) {
  if (!existsSync(source)) {
    rmSync(destination, { force: true });
    return false;
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  return true;
}
