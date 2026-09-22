import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ConfigConstants from "../src/config/constants.ts";
import {
  detectInstallMethod,
  getSelfUpdateCommand,
  getSelfUpdateUnavailableInstruction,
  PACKAGE_NAME,
} from "../src/config.ts";
import { printSelfUpdateUnavailable } from "../src/package-manager-cli/list-command.ts";

vi.mock("../src/config/constants.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ConfigConstants>()),
  isBunBinary: true,
}));

const RELEASES_URL = "https://github.com/dst0/p/releases/latest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("standalone binary self-update instructions", () => {
  it("points standalone binary users at the fork's GitHub releases", () => {
    expect(detectInstallMethod()).toBe("bun-binary");
    expect(getSelfUpdateCommand(PACKAGE_NAME)).toBeUndefined();
    expect(getSelfUpdateUnavailableInstruction(PACKAGE_NAME)).toBe(`Download from: ${RELEASES_URL}`);
  });

  it("prints the fork's release download page when p update cannot self-update", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    printSelfUpdateUnavailable();

    const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
    expect(stderr).toContain("cannot self-update this installation");
    expect(stderr).toContain(`Download from: ${RELEASES_URL}`);
    expect(stderr).not.toContain("p-mono");
  });
});
