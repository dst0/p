import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const agentDirectory = mkdtempSync(join(tmpdir(), "p-tools-manager-"));
const originalAgentDirectory = process.env.P_CODING_AGENT_DIR;
process.env.P_CODING_AGENT_DIR = agentDirectory;
vi.resetModules();

const {
  acquireDownloadLock,
  downloadTool,
  ensureTool,
  getTarExtractionArgs,
  getToolDownloadPaths,
  moveDownloadedBinary,
  releaseDownloadLock,
} = await import("../src/utils/tools-manager.ts");

const binDirectory = join(agentDirectory, "bin");

afterAll(() => {
  if (originalAgentDirectory === undefined) delete process.env.P_CODING_AGENT_DIR;
  else process.env.P_CODING_AGENT_DIR = originalAgentDirectory;
  rmSync(agentDirectory, { recursive: true, force: true });
});

describe("tool archive extraction", () => {
  it("does not apply archive ownership", () => {
    expect(getTarExtractionArgs("/tmp/fd.tar.gz", "/tmp/fd")).toEqual([
      "xzf",
      "/tmp/fd.tar.gz",
      "--no-same-owner",
      "-C",
      "/tmp/fd",
    ]);
  });

  it("creates unique archive, extraction, and platform binary paths", () => {
    expect(getToolDownloadPaths("fd", "fd.tar.gz", "linux", "download-id")).toEqual({
      archivePath: join(binDirectory, "download-id_fd.tar.gz"),
      binaryPath: join(binDirectory, "fd"),
      extractDir: join(binDirectory, "extract_tmp_download-id"),
    });
    expect(getToolDownloadPaths("rg", "rg.zip", "win32", "windows-id").binaryPath).toBe(join(binDirectory, "rg.exe"));
  });

  it("keeps a concurrently installed destination when its source disappears", () => {
    mkdirSync(binDirectory, { recursive: true });
    const source = join(binDirectory, "downloaded-fd");
    const destination = join(binDirectory, "fd");
    writeFileSync(source, "downloaded");
    moveDownloadedBinary(source, destination);
    expect(existsSync(destination)).toBe(true);

    expect(() => moveDownloadedBinary(source, destination)).not.toThrow();
    rmSync(destination);
    expect(() => moveDownloadedBinary(source, destination)).toThrow();
  });

  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "downloads, extracts, and installs a tarball through unique paths",
    async () => {
      mkdirSync(binDirectory, { recursive: true });
      const fixtureDirectory = mkdtempSync(join(tmpdir(), "p-tool-archive-"));
      const version = "1.2.3";
      const archiveRoot = `fd-v${version}-x86_64-unknown-linux-gnu`;
      const archivePath = join(fixtureDirectory, "fd.tar.gz");
      mkdirSync(join(fixtureDirectory, archiveRoot));
      writeFileSync(join(fixtureDirectory, archiveRoot, "fd"), "downloaded fd");
      const tar = spawnSync("tar", ["czf", archivePath, "-C", fixtureDirectory, archiveRoot], {
        encoding: "utf8",
      });
      expect(tar.status, tar.stderr).toBe(0);

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: `v${version}` })))
        .mockResolvedValueOnce(new Response(readFileSync(archivePath)));
      vi.stubGlobal("fetch", fetchMock);

      try {
        const installedPath = await downloadTool("fd");
        expect(installedPath).toBe(join(binDirectory, "fd"));
        expect(readFileSync(installedPath, "utf8")).toBe("downloaded fd");
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.unstubAllGlobals();
        rmSync(join(binDirectory, "fd"), { force: true });
        rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    },
  );
});

describe("cross-process tool download lock", () => {
  it("creates and releases a lock", async () => {
    const lock = await acquireDownloadLock("fd");
    expect(existsSync(lock.path)).toBe(true);
    releaseDownloadLock(lock);
    expect(existsSync(lock.path)).toBe(false);
  });

  it("replaces stale and broken lock entries", async () => {
    mkdirSync(binDirectory, { recursive: true });
    const lockPath = join(binDirectory, ".fd.download.lock");
    writeFileSync(lockPath, "");
    utimesSync(lockPath, new Date(0), new Date(0));

    const staleReplacement = await acquireDownloadLock("fd", { staleMs: 1, now: () => 10 });
    releaseDownloadLock(staleReplacement);

    symlinkSync(join(binDirectory, "missing-lock-target"), lockPath);
    const brokenReplacement = await acquireDownloadLock("fd");
    releaseDownloadLock(brokenReplacement);
  });

  it("waits for a lock and reports a bounded timeout", async () => {
    mkdirSync(binDirectory, { recursive: true });
    const lockPath = join(binDirectory, ".fd.download.lock");
    closeSync(openSync(lockPath, "wx"));
    let now = 0;
    let sleeps = 0;

    await expect(
      acquireDownloadLock("fd", {
        staleMs: 2,
        now: () => now,
        sleep: async () => {
          sleeps++;
          now = 3;
        },
      }),
    ).rejects.toThrow("Timed out waiting for the fd download lock");
    expect(sleeps).toBe(1);
    rmSync(lockPath);
  });

  it("reuses a tool installed by the process that held the lock", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    const heldLock = await acquireDownloadLock("fd");
    const binaryPath = join(binDirectory, "fd");
    const resultPromise = ensureTool("fd", true);

    setTimeout(() => {
      writeFileSync(binaryPath, "installed elsewhere");
      releaseDownloadLock(heldLock);
    }, 10);

    await expect(resultPromise).resolves.toBe(binaryPath);
    process.env.PATH = originalPath;
    rmSync(binaryPath);
  });
});
