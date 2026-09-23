import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, VERSION } from "../src/config.ts";
import { main } from "../src/main.ts";
import {
  FOREIGN_PACKAGE,
  getNewerPatchVersion,
  REGISTRY_URL,
  releaseNotesUrl,
  useSelfUpdateHarness,
} from "./self-update-test-harness.ts";

describe("p update --self release source", () => {
  const h = useSelfUpdateHarness();

  it("installs only this package when the version response names a different package", async () => {
    h.installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    // Whatever endpoint the version check contacts receives the hostile rename payload.
    h.stubNetwork((url) =>
      url.startsWith("https://api.github.com/")
        ? new Response("Not Found", { status: 404 })
        : Response.json({ name: FOREIGN_PACKAGE, packageName: FOREIGN_PACKAGE, version: newerVersion }),
    );

    await main(["update", "--self"]);

    expect(process.exitCode).toBeUndefined();
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(JSON.stringify(h.recordedNpmCalls())).not.toMatch(/uninstall|remove|earendil/);
    expect(`${h.stdout()}\n${h.stderr()}`).not.toContain(FOREIGN_PACKAGE);
  });

  it("installs only this package when the release notes response names a different package", async () => {
    h.installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    h.stubNetwork((url) =>
      url === REGISTRY_URL
        ? Response.json({ version: newerVersion })
        : Response.json({ tag_name: "v99.0.0", name: FOREIGN_PACKAGE, packageName: FOREIGN_PACKAGE, body: "Switch" }),
    );

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(h.stdout()).toContain("Switch");
    expect(`${h.stdout()}\n${h.stderr()}`).not.toContain(FOREIGN_PACKAGE);
    expect(process.exitCode).toBeUndefined();
  });

  it("uses the npm registry version to skip an update that is not newer", async () => {
    h.installFakeNpm();
    h.stubNetwork((url) => {
      if (url === REGISTRY_URL) return Response.json({ version: VERSION });
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([REGISTRY_URL]);
    expect(h.stdout()).toContain(`is already up to date (v${VERSION})`);
    expect(h.recordedNpmCalls()).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the fork's GitHub release notes before installing a newer registry version", async () => {
    h.installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    h.stubNetwork((url) => {
      if (url === REGISTRY_URL) return Response.json({ version: newerVersion });
      if (url === releaseNotesUrl(newerVersion))
        return Response.json({ body: "### Fixed\n\n- Registry-driven update" });
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    const printed = h.stdout();
    expect(printed).toContain("Registry-driven update");
    expect(printed.indexOf("Update note")).toBeGreaterThanOrEqual(0);
    expect(printed.indexOf("Update note")).toBeLessThan(printed.indexOf("Updating p with"));
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(process.exitCode).toBeUndefined();
  });

  it("still installs, without a note, when the release notes request fails", async () => {
    h.installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    h.stubNetwork((url) => {
      if (url === REGISTRY_URL) return Response.json({ version: newerVersion });
      throw new TypeError("fetch failed");
    });

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    expect(h.stdout()).not.toContain("Update note");
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(h.stderr()).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [
      "times out",
      (): Response => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    ],
    ["returns a non-JSON page", () => new Response("<html>captive portal</html>", { status: 200 })],
  ])("installs this package without a note when the registry request %s", async (_label, respond) => {
    h.installFakeNpm();
    h.stubNetwork(respond);

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([REGISTRY_URL]);
    expect(h.stdout()).not.toContain("Update note");
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall()]);
    expect(h.stderr()).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("skips the version and notes requests in offline mode but still runs the requested install", async () => {
    h.installFakeNpm();
    process.env.P_OFFLINE = "1";
    h.stubNetwork((url) => {
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([]);
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall()]);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the manual update instruction and installs nothing when no package manager manages this install", async () => {
    h.installFakeNpm();
    // A wrapper-linked checkout (for example via reinstall.sh) runs from a path no install method recognizes.
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/node", configurable: true });
    const newerVersion = getNewerPatchVersion();
    h.stubNetwork((url) =>
      url === REGISTRY_URL ? Response.json({ version: newerVersion }) : new Response("Not Found", { status: 404 }),
    );

    await main(["update", "--self"]);

    expect(h.requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    expect(h.stderr()).toContain("error: p cannot self-update this installation.");
    expect(h.stderr()).toContain(
      `Update ${PACKAGE_NAME} using the package manager, wrapper, or source checkout that provides this installation.`,
    );
    expect(h.recordedNpmCalls()).toEqual([]);
    expect(h.stdout()).not.toMatch(/Updating p with|Updated p\b/);
    expect(process.exitCode).toBe(1);
  });

  it("reports a failed install of this package without claiming success", async () => {
    h.installFakeNpm({ failInstall: true });
    const newerVersion = getNewerPatchVersion();
    h.stubNetwork((url) =>
      url === REGISTRY_URL ? Response.json({ version: newerVersion }) : new Response("Not Found", { status: 404 }),
    );

    await main(["update", "--self"]);

    expect(process.exitCode).toBe(1);
    expect(h.recordedNpmCalls()).toEqual([h.expectedInstall(`${PACKAGE_NAME}@${newerVersion}`)]);
    expect(h.stderr()).toContain("exited with code 23");
    expect(h.stderr()).toContain("run this command yourself:");
    expect(h.stderr()).toContain(
      `--prefix ${h.globalPrefix} install -g --ignore-scripts --min-release-age=0 ${PACKAGE_NAME}@${newerVersion}`,
    );
    expect(h.stdout()).not.toMatch(/Updated p\b/);
  });
});
