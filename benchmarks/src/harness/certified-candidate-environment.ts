import { devNull } from "node:os";
import { dirname, join } from "node:path";

export function certifiedCandidateEnvironment(configDir: string, runtime?: string): NodeJS.ProcessEnv {
  const path = [
    ...(runtime ? [join(runtime, "node_modules", ".bin")] : []),
    dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");
  const env: NodeJS.ProcessEnv = {
    HOME: configDir,
    TMPDIR: configDir,
    PATH: path,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of ["LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ"] as const) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
