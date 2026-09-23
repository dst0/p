import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";
import { ENV_AGENT_DIR, LEGACY_ENV_AGENT_DIR, LEGACY_ENV_SESSION_DIR, PACKAGE_NAME, VERSION } from "../src/config.ts";

export const REGISTRY_URL = "https://registry.npmjs.org/@dst0%2fp/latest";
export const FOREIGN_PACKAGE = "@earendil-works/pi-coding-agent";
const ENV_NAMES = [
  ENV_AGENT_DIR,
  LEGACY_ENV_AGENT_DIR,
  LEGACY_ENV_SESSION_DIR,
  "P_PACKAGE_DIR",
  "P_OFFLINE",
  "P_SKIP_VERSION_CHECK",
] as const;

export function getNewerPatchVersion(): string {
  const [major = "0", minor = "0", patch = "0"] = VERSION.split(".");
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

export function releaseNotesUrl(version: string): string {
  return `https://api.github.com/repos/dst0/p/releases/tags/v${version}`;
}

export interface FakeNpmOptions {
  /** Exit with code 23 on `install`. */
  failInstall?: boolean;
  /** On `install <name>@<version>`, write that version to the installed package.json like a real install. */
  writeInstalledVersion?: boolean;
}

export interface SelfUpdateHarness {
  globalPrefix: string;
  /** Global install directory of the running p package inside the fake npm prefix. */
  selfPackageDir: string;
  requestedUrls: string[];
  /** `npmCommand` written to settings by `installFakeNpm`. */
  npmCommand: string[];
  installFakeNpm(options?: FakeNpmOptions): void;
  stubNetwork(respond: (url: string) => Response): void;
  recordedNpmCalls(): string[][];
  setInstalledVersion(version: string): void;
  stdout(): string;
  stderr(): string;
  expectedInstall(spec?: string): string[];
}

/**
 * Registers per-test setup for `p update --self` scenarios: an isolated agent dir, a fake global npm
 * prefix that records invocations, and captured console output. Call once inside a `describe`.
 */
export function useSelfUpdateHarness(): SelfUpdateHarness {
  let tempDir = "";
  let recordPath = "";
  let originalCwd = "";
  let originalExitCode: typeof process.exitCode;
  let originalExecPath = "";
  let originalEnv = new Map<string, string | undefined>();
  let stdoutSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof console.error>;
  const output = (spy: MockInstance<(...args: unknown[]) => void>) =>
    spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

  const harness: SelfUpdateHarness = {
    globalPrefix: "",
    selfPackageDir: "",
    requestedUrls: [],
    npmCommand: [],
    installFakeNpm(options = {}) {
      const fakeNpmPath = join(tempDir, "fake-npm.cjs");
      mkdirSync(harness.selfPackageDir, { recursive: true });
      writeFileSync(
        fakeNpmPath,
        `const fs=require("node:fs"),path=require("node:path"),args=process.argv.slice(2),prefix=args[args.indexOf("--prefix")+1];
if(args.includes("root")){console.log(path.join(prefix,"lib","node_modules"));process.exit(0);}
const records=fs.existsSync(${JSON.stringify(recordPath)})?JSON.parse(fs.readFileSync(${JSON.stringify(recordPath)},"utf-8")):[];
records.push(args);
fs.writeFileSync(${JSON.stringify(recordPath)},JSON.stringify(records));
if(${options.failInstall === true}&&args.includes("install")) process.exit(23);
const pinned=/^(@[^/]+\\/[^@]+)@(.+)$/.exec(args[args.length-1]);
if(${options.writeInstalledVersion === true}&&args.includes("install")&&pinned) fs.writeFileSync(path.join(prefix,"lib","node_modules",pinned[1],"package.json"),JSON.stringify({name:pinned[1],version:pinned[2]}));
`,
      );
      harness.npmCommand = [originalExecPath, fakeNpmPath, "--prefix", harness.globalPrefix];
      writeFileSync(
        join(tempDir, "agent", "settings.json"),
        JSON.stringify({ npmCommand: harness.npmCommand }, null, 2),
      );
      process.env.P_PACKAGE_DIR = harness.selfPackageDir;
      Object.defineProperty(process, "execPath", {
        value: join(harness.selfPackageDir, "dist", "cli.js"),
        configurable: true,
      });
    },
    stubNetwork(respond) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : String(input);
          harness.requestedUrls.push(url);
          return respond(url);
        }),
      );
    },
    recordedNpmCalls() {
      return existsSync(recordPath) ? (JSON.parse(readFileSync(recordPath, "utf-8")) as string[][]) : [];
    },
    setInstalledVersion(version) {
      mkdirSync(harness.selfPackageDir, { recursive: true });
      writeFileSync(join(harness.selfPackageDir, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
    },
    stdout: () => output(stdoutSpy),
    stderr: () => output(stderrSpy),
    expectedInstall: (spec = PACKAGE_NAME) => [
      "--prefix",
      harness.globalPrefix,
      "install",
      "-g",
      "--ignore-scripts",
      "--min-release-age=0",
      spec,
    ],
  };

  beforeEach(() => {
    tempDir = join(tmpdir(), `p-self-update-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    recordPath = join(tempDir, "npm-calls.json");
    harness.globalPrefix = join(tempDir, "global-prefix");
    harness.selfPackageDir = join(harness.globalPrefix, "lib", "node_modules", "@dst0", "p");
    harness.requestedUrls = [];
    harness.npmCommand = [];
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
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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

  return harness;
}
