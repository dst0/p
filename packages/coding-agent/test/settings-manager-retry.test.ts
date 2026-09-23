import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RETRY_BASE_DELAY_MS,
  DEFAULT_HOST_UNAVAILABLE_MAX_MS,
  SettingsManager,
} from "../src/core/settings-manager.ts";

const directories: string[] = [];

function createManager(): SettingsManager {
  const root = mkdtempSync(join(tmpdir(), "p-settings-retry-"));
  directories.push(root);
  return SettingsManager.create(join(root, "project"), join(root, "agent"));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SettingsManager retry settings", () => {
  it("defaults to fast exponential reconnects with a ten-minute budget for unreachable local model hosts", () => {
    expect(createManager().getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: 3,
      baseDelayMs: DEFAULT_AGENT_RETRY_BASE_DELAY_MS,
      hostUnavailableMaxMs: DEFAULT_HOST_UNAVAILABLE_MAX_MS,
    });
    expect(DEFAULT_HOST_UNAVAILABLE_MAX_MS).toBe(600_000);
  });
});
