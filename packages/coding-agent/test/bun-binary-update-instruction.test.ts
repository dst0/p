import { readFileSync } from "fs";
import { describe, expect, test, vi } from "vitest";

vi.mock("../src/config/constants.ts", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as Record<string, unknown>), isBunBinary: true };
});

import {
  detectInstallMethod,
  getSelfUpdateCommand,
  getSelfUpdateUnavailableInstruction,
  getUpdateInstruction,
} from "../src/config.ts";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  repository: { url: string };
};

describe("standalone binary update guidance", () => {
  test("sends compiled binaries to the releases page of the repository that publishes them", () => {
    const repository = /^git\+(https:\/\/github\.com\/[^/]+\/[^/]+)\.git$/.exec(packageJson.repository.url)?.[1];
    expect(repository).toBe("https://github.com/dst0/p");
    const instruction = `Download from: ${repository}/releases/latest`;

    expect(detectInstallMethod()).toBe("bun-binary");
    expect(getSelfUpdateCommand("@dst0/p")).toBeUndefined();
    expect(getSelfUpdateUnavailableInstruction("@dst0/p")).toBe(instruction);
    expect(getUpdateInstruction("@dst0/p")).toBe(instruction);
  });
});
