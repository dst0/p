import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ISOLATED_AGENT_DIR_ROOT_ENV, ISOLATED_AGENT_DIR_ROOT_PREFIX } from "./isolated-agent-dir.ts";

/**
 * Vitest global setup: create one temporary root per run for the per-file agent dirs created by
 * `vitest-setup-isolated-agent-dir.ts`. Workers inherit the root through the environment. The returned
 * teardown deletes the whole root, including dirs of test files whose `afterAll` never ran (Vitest skips
 * file hooks when every test in the file is skipped).
 */
export default function setupIsolatedAgentDirRoot(): () => void {
  const previousRoot = process.env[ISOLATED_AGENT_DIR_ROOT_ENV];
  const root = mkdtempSync(join(tmpdir(), ISOLATED_AGENT_DIR_ROOT_PREFIX));
  process.env[ISOLATED_AGENT_DIR_ROOT_ENV] = root;
  return () => {
    rmSync(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env[ISOLATED_AGENT_DIR_ROOT_ENV];
    else process.env[ISOLATED_AGENT_DIR_ROOT_ENV] = previousRoot;
  };
}
