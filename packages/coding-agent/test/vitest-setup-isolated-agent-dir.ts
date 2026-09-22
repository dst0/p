/**
 * Vitest setup file: runs before every coding-agent test file so that code resolving the default agent
 * directory (for example `SessionManager.create(cwd)` without a session dir) writes into a per-file
 * temporary directory instead of the real user agent directory. Tests that need a specific agent dir
 * still set `P_CODING_AGENT_DIR` or pass `agentDir` explicitly; this only replaces the unsafe default.
 */
import { afterAll } from "vitest";
import { isolateAgentDirInRunRoot } from "./isolated-agent-dir.ts";

const isolation = isolateAgentDirInRunRoot();

afterAll(() => {
  isolation.restore();
});
