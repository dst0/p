import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { PackageJson } from "./types.ts";

export const __filename = fileURLToPath(import.meta.url);

export const __dirname = dirname(__filename);

export const isBunBinary =
  import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

export const isBunRuntime = !!process.versions.bun;

let loadedPkg: PackageJson = {};
try {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      loadedPkg = JSON.parse(readFileSync(candidate, "utf-8")) as PackageJson;
      break;
    }
    dir = dirname(dir);
  }
} catch {
  // Ignore fallback
}

export const pkg: PackageJson = loadedPkg;

export const piConfigName: string | undefined = pkg.piConfig?.name;

export const PACKAGE_NAME: string = pkg.name || "@dst0/p";

export const APP_NAME: string = piConfigName || "p";

export const APP_TITLE: string = piConfigName ? APP_NAME : "π";

export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".p";

export const VERSION: string = pkg.version || "0.0.0";

export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;

export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;

export const LEGACY_ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";

export const LEGACY_ENV_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR";

export const DEFAULT_SHARE_VIEWER_URL = "https://p.dev/session/";
