import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("SettingsManager enableIndexingTray", () => {
  const testDir = join(process.cwd(), "test-settings-tray-tmp");
  const agentDir = join(testDir, "agent");
  const projectDir = join(testDir, "project");

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(projectDir, ".p"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("defaults to true when no config exists", () => {
    const manager = SettingsManager.create(projectDir, agentDir);
    expect(manager.getEnableIndexingTray()).toBe(true);
  });

  it("persists enableTray to code-rag.json and settings.json on setEnableIndexingTray", async () => {
    const manager = SettingsManager.create(projectDir, agentDir);
    manager.setEnableIndexingTray(false);
    await manager.flush();

    expect(manager.getEnableIndexingTray()).toBe(false);

    const saved = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
    expect(saved.enableIndexingTray).toBe(false);

    const codeRag = JSON.parse(readFileSync(join(agentDir, "code-rag.json"), "utf-8"));
    expect(codeRag.enableTray).toBe(false);
  });

  it("re-enables tray by setting to true", async () => {
    const manager = SettingsManager.create(projectDir, agentDir);
    manager.setEnableIndexingTray(false);
    await manager.flush();
    manager.setEnableIndexingTray(true);
    await manager.flush();

    expect(manager.getEnableIndexingTray()).toBe(true);
    const codeRag = JSON.parse(readFileSync(join(agentDir, "code-rag.json"), "utf-8"));
    expect(codeRag.enableTray).toBe(true);
  });

  it("merges enableTray into existing code-rag.json without overwriting other keys", async () => {
    writeFileSync(join(agentDir, "code-rag.json"), JSON.stringify({ someKey: "preserved" }));
    const manager = SettingsManager.create(projectDir, agentDir);
    manager.setEnableIndexingTray(false);
    await manager.flush();

    const codeRag = JSON.parse(readFileSync(join(agentDir, "code-rag.json"), "utf-8"));
    expect(codeRag.enableTray).toBe(false);
    expect(codeRag.someKey).toBe("preserved");
  });
});
