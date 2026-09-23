import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelfUpdateCommandForMethod } from "../src/config/package-roots.ts";
import { PACKAGE_NAME } from "../src/config.ts";
import { runSelfUpdate } from "../src/package-manager-cli/list-command.ts";

describe("source checkout self-update command", () => {
  let tempDir: string;
  const originalPackageDir = process.env.P_PACKAGE_DIR;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "p-source-checkout-"));
  });

  afterEach(() => {
    if (originalPackageDir === undefined) delete process.env.P_PACKAGE_DIR;
    else process.env.P_PACKAGE_DIR = originalPackageDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("pulls and rebuilds the enclosing git checkout instead of installing a package", () => {
    const packageDir = join(tempDir, "packages", "coding-agent");
    mkdirSync(join(tempDir, ".git"), { recursive: true });
    writeFileSync(join(tempDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(packageDir, { recursive: true });
    process.env.P_PACKAGE_DIR = packageDir;

    const expected = {
      command: "bash",
      args: ["-c", `cd ${tempDir} && git pull && npm run build`],
      display: `bash -c "cd ${tempDir} && git pull && npm run build"`,
    };
    expect(getSelfUpdateCommandForMethod("source-checkout", PACKAGE_NAME)).toEqual(expected);
    // A checkout builds whatever it pulls, so it is never pinned or version-verified.
    expect(getSelfUpdateCommandForMethod("source-checkout", PACKAGE_NAME, undefined, "1.2.4")).toEqual(expected);
  });

  it("offers no command when the package directory is not inside a git checkout", () => {
    process.env.P_PACKAGE_DIR = tempDir;

    expect(getSelfUpdateCommandForMethod("source-checkout", PACKAGE_NAME)).toBeUndefined();
  });
});

describe("pinned self-update commands", () => {
  it.each([
    ["npm", ["npm"], "npm", ["install", "-g", "--ignore-scripts", "--min-release-age=0", `${PACKAGE_NAME}@1.2.4`]],
    ["yarn", undefined, "yarn", ["global", "add", "--ignore-scripts", `${PACKAGE_NAME}@1.2.4`]],
    [
      "bun",
      undefined,
      "bun",
      ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", `${PACKAGE_NAME}@1.2.4`],
    ],
  ] as const)("pins %s installs to the checked version", (method, npmCommand, command, args) => {
    expect(
      getSelfUpdateCommandForMethod(method, PACKAGE_NAME, npmCommand ? [...npmCommand] : undefined, "1.2.4"),
    ).toEqual({
      command,
      args,
      display: [command, ...args].join(" "),
      pinnedVersion: "1.2.4",
    });
  });

  it("pins pnpm installs to the checked version", () => {
    const command = getSelfUpdateCommandForMethod("pnpm", PACKAGE_NAME, undefined, "1.2.4");

    expect(command?.command).toBe("pnpm");
    expect(command?.args.at(-1)).toBe(`${PACKAGE_NAME}@1.2.4`);
    expect(command?.pinnedVersion).toBe("1.2.4");
  });

  it("leaves installs unpinned without a checked version", () => {
    expect(getSelfUpdateCommandForMethod("npm", PACKAGE_NAME, ["npm"])).toEqual({
      command: "npm",
      args: ["install", "-g", "--ignore-scripts", "--min-release-age=0", PACKAGE_NAME],
      display: `npm install -g --ignore-scripts --min-release-age=0 ${PACKAGE_NAME}`,
    });
  });
});

describe("runSelfUpdate", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const nodeCommand = (script: string) => ({
    command: process.execPath,
    args: ["-e", script],
    display: "package-manager install",
  });

  it("resolves when the package manager exits successfully", async () => {
    await expect(runSelfUpdate(nodeCommand("process.exit(0)"))).resolves.toBeUndefined();
  });

  it("rejects with the exit code when the package manager fails", async () => {
    await expect(runSelfUpdate(nodeCommand("process.exit(3)"))).rejects.toThrow(
      "package-manager install exited with code 3",
    );
  });

  it.skipIf(process.platform === "win32")("rejects when the package manager is terminated by a signal", async () => {
    await expect(runSelfUpdate(nodeCommand("process.kill(process.pid, 'SIGTERM')"))).rejects.toThrow(
      "package-manager install terminated by signal SIGTERM",
    );
  });

  it("rejects when the package manager cannot be started", async () => {
    const missing = join(tmpdir(), `p-missing-package-manager-${process.pid}-${Date.now()}`);

    await expect(runSelfUpdate({ command: missing, args: ["install"], display: "missing install" })).rejects.toThrow(
      /ENOENT/,
    );
  });
});
