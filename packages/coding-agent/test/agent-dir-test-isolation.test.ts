import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR, ENV_SESSION_DIR, getAgentDir } from "../src/config.ts";
import { getDefaultSessionDirPath } from "../src/core/session-manager/session-context.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { getCwdRelativePath } from "../src/utils/paths.ts";
import {
  ISOLATED_AGENT_DIR_PREFIX,
  ISOLATED_AGENT_DIR_ROOT_ENV,
  ISOLATED_AGENT_DIR_ROOT_PREFIX,
  isolateAgentDir,
  isolateAgentDirInRunRoot,
} from "./isolated-agent-dir.ts";
import setupIsolatedAgentDirRoot from "./vitest-global-setup-agent-dir-root.ts";

// The directory production code falls back to when no agent dir is configured (the real ~/.p/agent).
// Resolved through getAgentDir() itself so the guard follows any change to the production default.
function resolveUnconfiguredAgentDir(): string {
  const configured = process.env[ENV_AGENT_DIR];
  delete process.env[ENV_AGENT_DIR];
  try {
    return getAgentDir();
  } finally {
    if (configured !== undefined) process.env[ENV_AGENT_DIR] = configured;
  }
}

describe("vitest run agent directory isolation", () => {
  it("resolves the default agent dir to a per-file dir inside the per-run temp root", () => {
    const agentDir = getAgentDir();
    const root = process.env[ISOLATED_AGENT_DIR_ROOT_ENV];
    const userAgentDir = resolveUnconfiguredAgentDir();

    expect(getCwdRelativePath(agentDir, userAgentDir)).toBeUndefined();
    expect(getCwdRelativePath(userAgentDir, agentDir)).toBeUndefined();
    expect(root).toBeDefined();
    expect(dirname(root!)).toBe(tmpdir());
    expect(basename(root!).startsWith(ISOLATED_AGENT_DIR_ROOT_PREFIX)).toBe(true);
    expect(dirname(agentDir)).toBe(root);
    expect(basename(agentDir).startsWith(ISOLATED_AGENT_DIR_PREFIX)).toBe(true);
    expect(existsSync(agentDir)).toBe(true);
    expect(process.env[ENV_SESSION_DIR]).toBeUndefined();
  });

  it("persists sessions created without an explicit session dir inside the isolated agent dir", () => {
    const root = process.env[ISOLATED_AGENT_DIR_ROOT_ENV];
    const cwd = mkdtempSync(join(tmpdir(), "p-agent-dir-guard-cwd-"));
    try {
      const userSessionDir = getDefaultSessionDirPath(cwd, resolveUnconfiguredAgentDir());
      // Containment is checked before SessionManager.create, so any agent dir outside the per-run temp root
      // (the user default, a developer-configured dir, or a subdirectory of either) fails before a write.
      expect(root).toBeDefined();
      expect(getCwdRelativePath(getDefaultSessionDirPath(cwd), root!)).toBeDefined();

      const sessionManager = SessionManager.create(cwd);
      sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() });
      sessionManager.appendMessage(fauxAssistantMessage("persisted"));
      const sessionFile = sessionManager.getSessionFile();

      expect(sessionFile).toBeDefined();
      expect(existsSync(sessionFile!)).toBe(true);
      expect(getCwdRelativePath(sessionFile!, root!)).toBeDefined();
      expect(existsSync(userSessionDir)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("agent dir isolation lifecycle", () => {
  let fileLevelEnv: Array<readonly [string, string | undefined]>;
  let tempRoot: string;

  beforeEach(() => {
    fileLevelEnv = [ENV_AGENT_DIR, ENV_SESSION_DIR, ISOLATED_AGENT_DIR_ROOT_ENV].map(
      (key) => [key, process.env[key]] as const,
    );
    tempRoot = mkdtempSync(join(tmpdir(), "p-agent-dir-isolation-root-"));
  });

  afterEach(() => {
    for (const [key, value] of fileLevelEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe("isolateAgentDir", () => {
    it("overrides configured agent and session dirs, then restores them and deletes written state", () => {
      const configuredAgentDir = join(tempRoot, "configured-agent");
      const configuredSessionDir = join(tempRoot, "configured-sessions");
      process.env[ENV_AGENT_DIR] = configuredAgentDir;
      process.env[ENV_SESSION_DIR] = configuredSessionDir;

      const isolation = isolateAgentDir(tempRoot);
      expect(dirname(isolation.agentDir)).toBe(tempRoot);
      expect(basename(isolation.agentDir).startsWith(ISOLATED_AGENT_DIR_PREFIX)).toBe(true);
      expect(getAgentDir()).toBe(isolation.agentDir);
      expect(process.env[ENV_SESSION_DIR]).toBeUndefined();
      const sessionFile = join(getAgentDir(), "sessions", "--guard--", "session.jsonl");
      mkdirSync(dirname(sessionFile), { recursive: true });
      writeFileSync(sessionFile, "{}\n");

      isolation.restore();

      expect(process.env[ENV_AGENT_DIR]).toBe(configuredAgentDir);
      expect(process.env[ENV_SESSION_DIR]).toBe(configuredSessionDir);
      expect(existsSync(isolation.agentDir)).toBe(false);
      expect(existsSync(configuredAgentDir)).toBe(false);
      expect(existsSync(configuredSessionDir)).toBe(false);
    });

    it("unsets variables that were not configured before isolation", () => {
      delete process.env[ENV_AGENT_DIR];
      delete process.env[ENV_SESSION_DIR];

      const isolation = isolateAgentDir(tempRoot);
      expect(process.env[ENV_AGENT_DIR]).toBe(isolation.agentDir);
      isolation.restore();

      expect(ENV_AGENT_DIR in process.env).toBe(false);
      expect(ENV_SESSION_DIR in process.env).toBe(false);
    });

    it("gives every isolation its own directory and unwinds nested isolations in order", () => {
      const outer = isolateAgentDir(tempRoot);
      const inner = isolateAgentDir(tempRoot);
      expect(inner.agentDir).not.toBe(outer.agentDir);
      expect(getAgentDir()).toBe(inner.agentDir);

      inner.restore();
      expect(getAgentDir()).toBe(outer.agentDir);
      expect(existsSync(inner.agentDir)).toBe(false);
      expect(existsSync(outer.agentDir)).toBe(true);

      outer.restore();
      expect(existsSync(outer.agentDir)).toBe(false);
    });

    it("restores the environment when code under test already removed the directory", () => {
      const previousAgentDir = process.env[ENV_AGENT_DIR];
      const isolation = isolateAgentDir(tempRoot);
      rmSync(isolation.agentDir, { recursive: true, force: true });

      expect(() => isolation.restore()).not.toThrow();
      expect(process.env[ENV_AGENT_DIR]).toBe(previousAgentDir);
    });
  });

  describe("isolateAgentDirInRunRoot", () => {
    it("creates the per-file agent dir inside the run root published by the global setup", () => {
      process.env[ISOLATED_AGENT_DIR_ROOT_ENV] = tempRoot;

      const isolation = isolateAgentDirInRunRoot();
      expect(dirname(isolation.agentDir)).toBe(tempRoot);
      expect(getAgentDir()).toBe(isolation.agentDir);
      isolation.restore();

      expect(existsSync(isolation.agentDir)).toBe(false);
    });

    it("fails closed without touching the agent dir env when the run root is missing", () => {
      const agentDirBefore = process.env[ENV_AGENT_DIR];
      delete process.env[ISOLATED_AGENT_DIR_ROOT_ENV];

      expect(() => isolateAgentDirInRunRoot()).toThrow(`${ISOLATED_AGENT_DIR_ROOT_ENV} is not set`);
      expect(process.env[ENV_AGENT_DIR]).toBe(agentDirBefore);
    });
  });

  describe("global setup run root", () => {
    it("removes per-file dirs whose afterAll never ran and restores the previous root", () => {
      const fileLevelRoot = process.env[ISOLATED_AGENT_DIR_ROOT_ENV];
      const teardown = setupIsolatedAgentDirRoot();
      const runRoot = process.env[ISOLATED_AGENT_DIR_ROOT_ENV]!;
      let skippedFileAgentDir: string;
      try {
        expect(runRoot).not.toBe(fileLevelRoot);
        expect(dirname(runRoot)).toBe(tmpdir());
        expect(basename(runRoot).startsWith(ISOLATED_AGENT_DIR_ROOT_PREFIX)).toBe(true);

        // A fully skipped test file creates its agent dir during setup but never reaches afterAll.
        skippedFileAgentDir = isolateAgentDir(runRoot).agentDir;
        writeFileSync(join(skippedFileAgentDir, "settings.json"), "{}\n");
      } finally {
        teardown();
      }

      expect(existsSync(skippedFileAgentDir)).toBe(false);
      expect(existsSync(runRoot)).toBe(false);
      expect(process.env[ISOLATED_AGENT_DIR_ROOT_ENV]).toBe(fileLevelRoot);
    });

    it("unsets the root variable on teardown when no root was configured before", () => {
      delete process.env[ISOLATED_AGENT_DIR_ROOT_ENV];

      const teardown = setupIsolatedAgentDirRoot();
      try {
        expect(process.env[ISOLATED_AGENT_DIR_ROOT_ENV]).toBeDefined();
      } finally {
        teardown();
      }

      expect(ISOLATED_AGENT_DIR_ROOT_ENV in process.env).toBe(false);
    });
  });
});
