import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const bunAvailable = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
const constantsPath = resolve("src/config/constants.ts");

type PackageMetadata = {
  APP_NAME: string;
  CONFIG_DIR_NAME: string;
  isBunBinary: boolean;
  PACKAGE_NAME: string;
  VERSION: string;
};

const fallbackMetadata: PackageMetadata = {
  APP_NAME: "p",
  CONFIG_DIR_NAME: ".p",
  isBunBinary: true,
  PACKAGE_NAME: "@dst0/p",
  VERSION: "0.0.0",
};

function writePackageMetadata(directory: string, name: string, version: string): void {
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name, version, piConfig: { name: `${name}-app`, configDir: `.${name}` } })}\n`,
  );
}

describe.skipIf(!bunAvailable)("standalone package metadata", () => {
  let fixtureRoot = "";
  let compiledBinary = "";

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "p-standalone-version-"));
    const entrypoint = join(fixtureRoot, "version-probe.ts");
    compiledBinary = join(fixtureRoot, "compiled-probe");
    writeFileSync(
      entrypoint,
      `import { APP_NAME, CONFIG_DIR_NAME, isBunBinary, PACKAGE_NAME, VERSION } from ${JSON.stringify(constantsPath)};
console.log(JSON.stringify({ APP_NAME, CONFIG_DIR_NAME, isBunBinary, PACKAGE_NAME, VERSION }));
`,
    );
    const compiled = spawnSync("bun", ["build", "--compile", entrypoint, "--outfile", compiledBinary], {
      cwd: fixtureRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(compiled.status, `${compiled.stdout}\n${compiled.stderr}`).toBe(0);
  });

  afterAll(() => {
    if (fixtureRoot) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  function runBinary(binary: string, cwd: string): PackageMetadata {
    const executed = spawnSync(binary, [], {
      cwd,
      encoding: "utf8",
      env: {
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        LOGNAME: process.env.LOGNAME,
        P_OFFLINE: "1",
        PATH: process.env.PATH,
        SHELL: process.env.SHELL,
        TMPDIR: process.env.TMPDIR,
        USER: process.env.USER,
      },
      timeout: 30_000,
    });
    expect(executed.status, `${executed.stdout}\n${executed.stderr}`).toBe(0);
    return JSON.parse(executed.stdout) as PackageMetadata;
  }

  test("loads the exact sidecar beside a moved executable", () => {
    const releaseDirectory = join(fixtureRoot, "valid-release");
    const binary = join(releaseDirectory, "p");
    mkdirSync(releaseDirectory);
    copyFileSync(compiledBinary, binary);
    writePackageMetadata(releaseDirectory, "fixture-p", "9.8.7");

    expect(runBinary(binary, fixtureRoot)).toEqual({
      APP_NAME: "fixture-p-app",
      CONFIG_DIR_NAME: ".fixture-p",
      isBunBinary: true,
      PACKAGE_NAME: "fixture-p",
      VERSION: "9.8.7",
    });
  });

  test("does not adopt a parent or working-directory manifest when the sidecar is missing", () => {
    const unrelatedParent = join(fixtureRoot, "missing-sidecar-parent");
    const binaryDirectory = join(unrelatedParent, "bin");
    const workingDirectory = join(fixtureRoot, "unrelated-cwd");
    const binary = join(binaryDirectory, "p");
    mkdirSync(binaryDirectory, { recursive: true });
    mkdirSync(workingDirectory);
    copyFileSync(compiledBinary, binary);
    writePackageMetadata(unrelatedParent, "parent-package", "1.2.3");
    writePackageMetadata(workingDirectory, "cwd-package", "4.5.6");

    expect(runBinary(binary, workingDirectory)).toEqual(fallbackMetadata);
  });

  test("does not adopt other manifests when the exact sidecar is malformed", () => {
    const unrelatedParent = join(fixtureRoot, "malformed-sidecar-parent");
    const binaryDirectory = join(unrelatedParent, "bin");
    const workingDirectory = join(fixtureRoot, "malformed-unrelated-cwd");
    const binary = join(binaryDirectory, "p");
    mkdirSync(binaryDirectory, { recursive: true });
    mkdirSync(workingDirectory);
    copyFileSync(compiledBinary, binary);
    writePackageMetadata(unrelatedParent, "parent-package", "1.2.3");
    writePackageMetadata(workingDirectory, "cwd-package", "4.5.6");
    writeFileSync(join(binaryDirectory, "package.json"), "{ malformed\n");

    expect(runBinary(binary, workingDirectory)).toEqual(fallbackMetadata);
  });
});
