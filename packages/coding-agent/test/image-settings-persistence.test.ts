import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("image model settings persistence", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("reads legacy nested defaults and persists the selected provider/model pair", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "p-image-settings-agent-"));
    const projectDir = await mkdtemp(join(tmpdir(), "p-image-settings-project-"));
    directories.push(agentDir, projectDir);
    const settingsPath = join(agentDir, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({ images: { defaultProvider: "legacy-provider", defaultModel: "legacy-model" } }),
    );
    const manager = SettingsManager.create(projectDir, agentDir);

    expect(manager.getDefaultImageProvider()).toBe("legacy-provider");
    expect(manager.getDefaultImageModel()).toBe("legacy-model");

    manager.setDefaultImageModelAndProvider("llm-orchestrator", "flux2-klein-4b");
    await manager.flush();
    const saved = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(saved.defaultImageProvider).toBe("llm-orchestrator");
    expect(saved.defaultImageModel).toBe("flux2-klein-4b");
  });
});
