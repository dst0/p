import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    PACKAGE_NAME: "@example/pi-coding-agent",
  };
});

import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";
import { ENV_AGENT_DIR } from "../src/config.ts";

describe("shouldRunFirstTimeSetup in forked distributions", () => {
  const originalPiExperimental = process.env.PI_EXPERIMENTAL;
  const originalAgentDir = process.env[ENV_AGENT_DIR];
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-first-time-setup-fork-"));
    settingsPath = join(tempDir, "settings.json");
    process.env.PI_EXPERIMENTAL = "1";
    // A custom agent dir also disables first-time setup; clear it so only the fork check can return false.
    delete process.env[ENV_AGENT_DIR];
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalPiExperimental === undefined) {
      delete process.env.PI_EXPERIMENTAL;
    } else {
      process.env.PI_EXPERIMENTAL = originalPiExperimental;
    }
    if (originalAgentDir === undefined) {
      delete process.env[ENV_AGENT_DIR];
    } else {
      process.env[ENV_AGENT_DIR] = originalAgentDir;
    }
  });

  it("returns false for a forked package", () => {
    expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
  });
});
