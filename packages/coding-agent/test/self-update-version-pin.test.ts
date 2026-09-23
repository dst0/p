import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, readInstalledPackageVersion, VERSION } from "../src/config.ts";
import { main } from "../src/main.ts";
import { getNewerPatchVersion, REGISTRY_URL, useSelfUpdateHarness } from "./self-update-test-harness.ts";

describe("p update --self version pinning", () => {
  const h = useSelfUpdateHarness();

  function publishNewerVersion(): string {
    const newerVersion = getNewerPatchVersion();
    h.stubNetwork((url) =>
      url === REGISTRY_URL ? Response.json({ version: newerVersion }) : new Response("Not Found", { status: 404 }),
    );
    return newerVersion;
  }

  it("installs exactly the registry version it announced and reports it", async () => {
    h.installFakeNpm({ writeInstalledVersion: true });
    h.setInstalledVersion(VERSION);
    const newerVersion = publishNewerVersion();

    await main(["update", "--self"]);

    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(h.stdout()).toContain(`Updated p to v${newerVersion}`);
    expect(h.stderr()).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("reports a version mismatch instead of success when the install leaves another version in place", async () => {
    // A lagging registry mirror "succeeds" without replacing the running version.
    h.installFakeNpm();
    h.setInstalledVersion(VERSION);
    const newerVersion = publishNewerVersion();

    await main(["update", "--self"]);

    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(h.stderr()).toContain(`expected p v${newerVersion} after updating, but v${VERSION} is installed`);
    expect(h.stderr()).toContain(`run this command yourself:`);
    expect(h.stdout()).not.toMatch(/Updated p\b/);
    expect(process.exitCode).toBe(1);
  });

  it("reports success for a pinned install whose installed version cannot be read", async () => {
    h.installFakeNpm();
    const newerVersion = publishNewerVersion();

    await main(["update", "--self"]);

    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(h.stdout()).toMatch(/Updated p$/m);
    expect(process.exitCode).toBeUndefined();
  });

  it("does not pin or verify a forced reinstall", async () => {
    h.installFakeNpm();
    h.setInstalledVersion(VERSION);
    h.stubNetwork((url) => {
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self", "--force"]);

    expect(h.requestedUrls).toEqual([]);
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(PACKAGE_NAME)]);
    expect(h.stdout()).toMatch(/Updated p$/m);
    expect(process.exitCode).toBeUndefined();
  });

  it("does not pin or verify when the latest version is unknown", async () => {
    h.installFakeNpm();
    h.setInstalledVersion(VERSION);
    h.stubNetwork(() => new Response("unavailable", { status: 503 }));

    await main(["update", "--self"]);

    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(PACKAGE_NAME)]);
    expect(h.stdout()).toMatch(/Updated p$/m);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("readInstalledPackageVersion", () => {
  const h = useSelfUpdateHarness();

  it("reads the version from the global root that manages the running install", () => {
    h.installFakeNpm();
    h.setInstalledVersion(" 9.8.7 ");

    expect(readInstalledPackageVersion("npm", PACKAGE_NAME, h.npmCommand)).toBe("9.8.7");
  });

  it("returns undefined when the installed package.json is missing or unreadable", () => {
    h.installFakeNpm();
    expect(readInstalledPackageVersion("npm", PACKAGE_NAME, h.npmCommand)).toBeUndefined();

    for (const content of ["{ not json", "null", JSON.stringify({ version: 5 }), JSON.stringify({ version: " " })]) {
      writeFileSync(join(h.selfPackageDir, "package.json"), content);
      expect(readInstalledPackageVersion("npm", PACKAGE_NAME, h.npmCommand), content).toBeUndefined();
    }
  });

  it("returns undefined when the package manager cannot report its global root", () => {
    h.installFakeNpm();
    h.setInstalledVersion("9.8.7");

    expect(readInstalledPackageVersion("npm", PACKAGE_NAME, [join(h.globalPrefix, "missing-npm")])).toBeUndefined();
  });

  it("returns undefined for install methods without a global package root", () => {
    expect(readInstalledPackageVersion("source-checkout", PACKAGE_NAME)).toBeUndefined();
    expect(readInstalledPackageVersion("bun-binary", PACKAGE_NAME)).toBeUndefined();
  });
});
