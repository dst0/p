import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ENV_AGENT_DIR, ENV_SESSION_DIR } from "../src/config/constants.ts";

/** Set by the Vitest global setup to the per-run root that holds every per-file agent dir. */
export const ISOLATED_AGENT_DIR_ROOT_ENV = "P_TEST_AGENT_DIR_ROOT";

export const ISOLATED_AGENT_DIR_ROOT_PREFIX = "p-test-agent-dirs-";

export const ISOLATED_AGENT_DIR_PREFIX = "p-test-agent-dir-";

export interface IsolatedAgentDir {
  agentDir: string;
  restore: () => void;
}

/**
 * Point every default agent-dir consumer (sessions, settings, auth, models, themes) at a fresh
 * directory under `root` and clear the session-dir override, so code under test cannot write into
 * the real user agent directory or a developer's configured session store. `restore` reinstates the
 * previous environment values and deletes the directory.
 */
export function isolateAgentDir(root: string): IsolatedAgentDir {
  const previousValues = [ENV_AGENT_DIR, ENV_SESSION_DIR].map((key) => [key, process.env[key]] as const);
  const agentDir = mkdtempSync(join(root, ISOLATED_AGENT_DIR_PREFIX));
  process.env[ENV_AGENT_DIR] = agentDir;
  delete process.env[ENV_SESSION_DIR];
  return {
    agentDir,
    restore: () => {
      for (const [key, value] of previousValues) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(agentDir, { recursive: true, force: true });
    },
  };
}

/**
 * Isolate the agent dir inside the per-run root published by the Vitest global setup. Fails closed when
 * the root is missing, so a misconfigured run cannot silently fall back to the real agent dir.
 */
export function isolateAgentDirInRunRoot(): IsolatedAgentDir {
  const root = process.env[ISOLATED_AGENT_DIR_ROOT_ENV];
  if (!root) {
    throw new Error(
      `${ISOLATED_AGENT_DIR_ROOT_ENV} is not set; register test/vitest-global-setup-agent-dir-root.ts as a Vitest globalSetup so tests cannot fall back to the real agent dir.`,
    );
  }
  return isolateAgentDir(root);
}
