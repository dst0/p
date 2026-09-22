import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR, LEGACY_ENV_AGENT_DIR, LEGACY_ENV_SESSION_DIR, PACKAGE_NAME, VERSION } from "../src/config.ts";
import { main } from "../src/main.ts";

const REGISTRY_URL = "https://registry.npmjs.org/@dst0%2fp/latest";
const FOREIGN_PACKAGE = "@earendil-works/pi-coding-agent";
const ENV_NAMES = [
  ENV_AGENT_DIR,
  LEGACY_ENV_AGENT_DIR,
  LEGACY_ENV_SESSION_DIR,
  "P_PACKAGE_DIR",
  "P_OFFLINE",
  "P_SKIP_VERSION_CHECK",
] as const;

function getNewerPatchVersion(): string {
  const [major = "0", minor = "0", patch = "0"] = VERSION.split(".");
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

function releaseNotesUrl(version: string): string {
  return `https://api.github.com/repos/dst0/p/releases/tags/v${version}`;
}

describe("p update --self release source", () => {
  let tempDir: string;
  let globalPrefix: string;
  let recordPath: string;
  let requestedUrls: string[];
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;
  let originalExecPath: string;
  let originalEnv: Map<string, string | undefined>;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  /** Installs a fake global npm that records every non-`root` invocation, optionally failing installs. */
  function installFakeNpm(options: { failInstall?: boolean } = {}): void {
    const selfPackageDir = join(globalPrefix, "lib", "node_modules", "@dst0", "p");
    const fakeNpmPath = join(tempDir, "fake-npm.cjs");
    mkdirSync(selfPackageDir, { recursive: true });
    writeFileSync(
      fakeNpmPath,
      `const fs=require("node:fs"),path=require("node:path"),args=process.argv.slice(2),prefix=args[args.indexOf("--prefix")+1];
if(args.includes("root")){console.log(path.join(prefix,"lib","node_modules"));process.exit(0);}
const records=fs.existsSync(${JSON.stringify(recordPath)})?JSON.parse(fs.readFileSync(${JSON.stringify(recordPath)},"utf-8")):[];
records.push(args);
fs.writeFileSync(${JSON.stringify(recordPath)},JSON.stringify(records));
if(${options.failInstall ? "true" : "false"}&&args.includes("install")) process.exit(23);
`,
    );
    writeFileSync(
      join(tempDir, "agent", "settings.json"),
      JSON.stringify({ npmCommand: [originalExecPath, fakeNpmPath, "--prefix", globalPrefix] }, null, 2),
    );
    process.env.P_PACKAGE_DIR = selfPackageDir;
    Object.defineProperty(process, "execPath", { value: join(selfPackageDir, "dist", "cli.js"), configurable: true });
  }

  function stubNetwork(respond: (url: string) => Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        requestedUrls.push(url);
        return respond(url);
      }),
    );
  }

  function recordedNpmCalls(): string[][] {
    return existsSync(recordPath) ? (JSON.parse(readFileSync(recordPath, "utf-8")) as string[][]) : [];
  }

  function output(spy: ReturnType<typeof vi.spyOn>): string {
    return spy.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");
  }

  const expectedInstall = () => [
    "--prefix",
    globalPrefix,
    "install",
    "-g",
    "--ignore-scripts",
    "--min-release-age=0",
    PACKAGE_NAME,
  ];

  beforeEach(() => {
    tempDir = join(tmpdir(), `p-self-update-source-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    globalPrefix = join(tempDir, "global-prefix");
    recordPath = join(tempDir, "npm-calls.json");
    requestedUrls = [];
    mkdirSync(join(tempDir, "agent"), { recursive: true });
    mkdirSync(join(tempDir, "project"), { recursive: true });
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    originalExecPath = process.execPath;
    originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
    delete process.env.P_OFFLINE;
    delete process.env.P_SKIP_VERSION_CHECK;
    process.exitCode = undefined;
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      process.exitCode = code === undefined || code === null || Number(code) === 0 ? undefined : code;
      return undefined as never;
    }) as typeof process.exit);
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env[ENV_AGENT_DIR] = join(tempDir, "agent");
    process.chdir(join(tempDir, "project"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("installs only this package when the version response names a different package", async () => {
    installFakeNpm();
    // Whatever endpoint the version check contacts receives the hostile rename payload.
    stubNetwork((url) =>
      url.startsWith("https://api.github.com/")
        ? new Response("Not Found", { status: 404 })
        : Response.json({ name: FOREIGN_PACKAGE, packageName: FOREIGN_PACKAGE, version: getNewerPatchVersion() }),
    );

    await main(["update", "--self"]);

    expect(process.exitCode).toBeUndefined();
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(JSON.stringify(recordedNpmCalls())).not.toMatch(/uninstall|remove|earendil/);
    expect(`${output(stdout)}\n${output(stderr)}`).not.toContain(FOREIGN_PACKAGE);
  });

  it("installs only this package when the release notes response names a different package", async () => {
    installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    stubNetwork((url) =>
      url === REGISTRY_URL
        ? Response.json({ version: newerVersion })
        : Response.json({ tag_name: "v99.0.0", name: FOREIGN_PACKAGE, packageName: FOREIGN_PACKAGE, body: "Switch" }),
    );

    await main(["update", "--self"]);

    expect(requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(output(stdout)).toContain("Switch");
    expect(`${output(stdout)}\n${output(stderr)}`).not.toContain(FOREIGN_PACKAGE);
    expect(process.exitCode).toBeUndefined();
  });

  it("uses the npm registry version to skip an update that is not newer", async () => {
    installFakeNpm();
    stubNetwork((url) => {
      if (url === REGISTRY_URL) return Response.json({ version: VERSION });
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self"]);

    expect(requestedUrls).toEqual([REGISTRY_URL]);
    expect(output(stdout)).toContain(`is already up to date (v${VERSION})`);
    expect(recordedNpmCalls()).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the fork's GitHub release notes before installing a newer registry version", async () => {
    installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    stubNetwork((url) => {
      if (url === REGISTRY_URL) return Response.json({ version: newerVersion });
      if (url === releaseNotesUrl(newerVersion))
        return Response.json({ body: "### Fixed\n\n- Registry-driven update" });
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self"]);

    expect(requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    const printed = output(stdout);
    expect(printed).toContain("Registry-driven update");
    expect(printed.indexOf("Update note")).toBeGreaterThanOrEqual(0);
    expect(printed.indexOf("Update note")).toBeLessThan(printed.indexOf("Updating p with"));
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(process.exitCode).toBeUndefined();
  });

  it("still installs, without a note, when the release notes request fails", async () => {
    installFakeNpm();
    const newerVersion = getNewerPatchVersion();
    stubNetwork((url) => {
      if (url === REGISTRY_URL) return Response.json({ version: newerVersion });
      throw new TypeError("fetch failed");
    });

    await main(["update", "--self"]);

    expect(requestedUrls).toEqual([REGISTRY_URL, releaseNotesUrl(newerVersion)]);
    expect(output(stdout)).not.toContain("Update note");
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(output(stderr)).toBe("");
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
    installFakeNpm();
    stubNetwork(respond);

    await main(["update", "--self"]);

    expect(requestedUrls).toEqual([REGISTRY_URL]);
    expect(output(stdout)).not.toContain("Update note");
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(output(stderr)).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("skips the version and notes requests in offline mode but still runs the requested install", async () => {
    installFakeNpm();
    process.env.P_OFFLINE = "1";
    stubNetwork((url) => {
      throw new Error(`unexpected request to ${url}`);
    });

    await main(["update", "--self"]);

    expect(requestedUrls).toEqual([]);
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(process.exitCode).toBeUndefined();
  });

  it("reports a failed install of this package without claiming success", async () => {
    installFakeNpm({ failInstall: true });
    stubNetwork((url) =>
      url === REGISTRY_URL
        ? Response.json({ version: getNewerPatchVersion() })
        : new Response("Not Found", { status: 404 }),
    );

    await main(["update", "--self"]);

    expect(process.exitCode).toBe(1);
    expect(recordedNpmCalls()).toEqual([expectedInstall()]);
    expect(output(stderr)).toContain("exited with code 23");
    expect(output(stderr)).toContain("run this command yourself:");
    expect(output(stderr)).toContain(
      `--prefix ${globalPrefix} install -g --ignore-scripts --min-release-age=0 ${PACKAGE_NAME}`,
    );
    expect(output(stdout)).not.toMatch(/Updated p\b/);
  });
});
