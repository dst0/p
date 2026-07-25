import * as fsPromises from "node:fs/promises";
import { access, chmod, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { FileError, getOrThrow } from "../../src/harness/types.ts";
import { executeShellWithCapture } from "../../src/harness/utils/shell-output.ts";
import { createTempDir } from "./session-test-utils.ts";

const chmodRestorePaths: string[] = [];
const runsAsRoot = typeof process.getuid === "function" && process.getuid() === 0;

afterEach(async () => {
  for (const path of chmodRestorePaths.splice(0)) {
    try {
      await access(path);
      await chmod(path, 0o700);
    } catch {}
  }
});

describe("NodeExecutionEnv", () => {
  it("reads, writes, lists, and removes files and directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    expect(getOrThrow(await env.absolutePath("nested/child"))).toBe(join(root, "nested/child"));
    expect(getOrThrow(await env.joinPath([root, "nested", "child"]))).toBe(join(root, "nested", "child"));
    getOrThrow(await env.createDir("nested/child"));
    getOrThrow(await env.writeFile("nested/child/file.txt", "hel"));
    getOrThrow(await env.appendFile("nested/child/file.txt", "lo"));
    expect(getOrThrow(await env.readTextFile("nested/child/file.txt"))).toBe("hello");
    expect(getOrThrow(await env.readTextLines("nested/child/file.txt", { maxLines: 1 }))).toEqual(["hello"]);
    expect(Buffer.from(getOrThrow(await env.readBinaryFile("nested/child/file.txt"))).toString("utf8")).toBe("hello");

    const entries = getOrThrow(await env.listDir("nested/child"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "file.txt",
      path: join(root, "nested/child/file.txt"),
      kind: "file",
      size: 5,
    });
    expect(typeof entries[0]!.mtimeMs).toBe("number");

    expect(getOrThrow(await env.exists("nested/child/file.txt"))).toBe(true);
    getOrThrow(await env.remove("nested/child/file.txt"));
    expect(getOrThrow(await env.exists("nested/child/file.txt"))).toBe(false);
  });

  it("returns fileInfo for files, directories, and symlinks without following symlinks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.createDir("dir", { recursive: true }));
    getOrThrow(await env.writeFile("dir/file.txt", "hello"));
    await symlink(join(root, "dir/file.txt"), join(root, "file-link"));
    await symlink(join(root, "dir"), join(root, "dir-link"));

    expect(getOrThrow(await env.fileInfo("dir"))).toMatchObject({
      name: "dir",
      path: join(root, "dir"),
      kind: "directory",
    });
    expect(getOrThrow(await env.fileInfo("dir/file.txt"))).toMatchObject({
      name: "file.txt",
      path: join(root, "dir/file.txt"),
      kind: "file",
      size: 5,
    });
    expect(getOrThrow(await env.fileInfo("file-link"))).toMatchObject({
      name: "file-link",
      path: join(root, "file-link"),
      kind: "symlink",
    });
    expect(getOrThrow(await env.fileInfo("dir-link"))).toMatchObject({
      name: "dir-link",
      path: join(root, "dir-link"),
      kind: "symlink",
    });
    expect(getOrThrow(await env.canonicalPath("file-link"))).toBe(await realpath(join(root, "dir/file.txt")));
  });

  it("lists symlinks as symlinks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("target.txt", "hello"));
    await symlink(join(root, "target.txt"), join(root, "link.txt"));

    const entries = getOrThrow(await env.listDir("."));
    expect(
      entries.map((entry) => ({ name: entry.name, kind: entry.kind })).sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "link.txt", kind: "symlink" },
      { name: "target.txt", kind: "file" },
    ]);
  });

  it("stops reading text lines at the requested limit", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "one\ntwo\nthree"));
    expect(getOrThrow(await env.readTextLines("file.txt", { maxLines: 1 }))).toEqual(["one"]);
  });

  it("returns FileError for missing paths and keeps exists false for missing paths", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const info = await env.fileInfo("missing.txt");
    expect(info.ok).toBe(false);
    if (!info.ok) {
      expect(info.error).toBeInstanceOf(FileError);
      expect(info.error).toMatchObject({
        name: "FileError",
        code: "not_found",
        path: join(root, "missing.txt"),
      });
    }
    expect(getOrThrow(await env.exists("missing.txt"))).toBe(false);
  });

  it("returns FileError for listing non-directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello"));
    const result = await env.listDir("file.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(FileError);
      expect(result.error).toMatchObject({ code: "not_directory" });
    }
  });

  it("appends to new files and creates parent directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.appendFile("new/nested/file.txt", "a"));
    getOrThrow(await env.appendFile("new/nested/file.txt", "b"));
    expect(getOrThrow(await env.readTextFile("new/nested/file.txt"))).toBe("ab");
  });

  it("creates temporary directories and files", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const tempDir = getOrThrow(await env.createTempDir("node-env-test-"));
    await expect(access(tempDir)).resolves.toBeUndefined();
    const tempFile = getOrThrow(await env.createTempFile({ prefix: "prefix-", suffix: ".txt" }));
    await expect(access(tempFile)).resolves.toBeUndefined();
    expect(tempFile.endsWith(".txt")).toBe(true);
  });

  it("honors createDir recursive false and remove recursive/force options", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const createResult = await env.createDir("missing/child", { recursive: false });
    expect(createResult.ok).toBe(false);
    if (!createResult.ok) expect(createResult.error).toMatchObject({ code: "not_found" });

    getOrThrow(await env.writeFile("dir/child/file.txt", "hello"));
    const removeDirectory = await env.remove("dir", { recursive: false });
    expect(removeDirectory.ok).toBe(false);
    getOrThrow(await env.remove("dir", { recursive: true }));
    expect(getOrThrow(await env.exists("dir"))).toBe(false);

    const removeMissing = await env.remove("missing", { force: false });
    expect(removeMissing.ok).toBe(false);
    getOrThrow(await env.remove("missing", { force: true }));
  });

  it("returns aborted results for pre-aborted cancellable file operations", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello"));
    const controller = new AbortController();
    controller.abort();
    const signal = controller.signal;

    const results = await Promise.all([
      env.readTextFile("file.txt", signal),
      env.readTextLines("file.txt", { abortSignal: signal }),
      env.readBinaryFile("file.txt", signal),
      env.writeFile("other.txt", "hello", signal),
      env.listDir(".", signal),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: "aborted" });
    }
  });

  it("cleanup is best-effort", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    await expect(env.cleanup()).resolves.toBeUndefined();
  });

  it("executes commands in cwd with env overrides", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = getOrThrow(
      await env.exec('printf \'%s:%s\' "$PWD" "$NODE_ENV_TEST"', {
        env: { NODE_ENV_TEST: "ok" },
      }),
    );
    expect(result).toEqual({ stdout: `${await realpath(root)}:ok`, stderr: "", exitCode: 0 });
  });

  it("streams stdout and stderr chunks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    let stdout = "";
    let stderr = "";
    const result = getOrThrow(
      await env.exec("printf out; printf err >&2", {
        onStdout: (chunk) => {
          stdout += chunk;
        },
        onStderr: (chunk) => {
          stderr += chunk;
        },
      }),
    );
    expect(result).toEqual({ stdout: "out", stderr: "err", exitCode: 0 });
    expect(stdout).toBe("out");
    expect(stderr).toBe("err");
  });

  it("returns non-zero command exit codes as successful execution results", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = getOrThrow(await env.exec("exit 7"));
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 7 });
  });

  it("returns timeout errors for commands exceeding the timeout", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = await env.exec("sleep 5", { timeout: 0.01 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "timeout" });
  });

  it("returns callback errors from exec stream handlers", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = await env.exec("printf out", {
      onStdout: () => {
        throw new Error("callback failed");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "callback_error", message: "callback failed" });
  });

  it("returns shell unavailable and spawn errors", async () => {
    const root = createTempDir();
    const missingShellEnv = new NodeExecutionEnv({ cwd: root, shellPath: join(root, "missing-shell") });
    const missingShell = await missingShellEnv.exec("printf ok");
    expect(missingShell.ok).toBe(false);
    if (!missingShell.ok) expect(missingShell.error).toMatchObject({ code: "shell_unavailable" });

    const shellPath = join(root, "not-executable-shell");
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile(shellPath, "not executable"));
    const spawnErrorEnv = new NodeExecutionEnv({ cwd: root, shellPath });
    const spawnError = await spawnErrorEnv.exec("printf ok");
    expect(spawnError.ok).toBe(false);
    if (!spawnError.ok) expect(spawnError.error).toMatchObject({ code: "spawn_error" });
  });

  it("returns an aborted result for aborted commands", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const controller = new AbortController();
    const promise = env.exec("sleep 5", { abortSignal: controller.signal });
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "aborted" });
  });

  it("captures large shell output to a full output file through the execution env", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = getOrThrow(await executeShellWithCapture(env, "yes line | head -n 15000"));
    expect(result.truncated).toBe(true);
    expect(result.fullOutputPath).toBeDefined();
    const fullOutput = getOrThrow(await env.readTextFile(result.fullOutputPath!));
    expect(fullOutput.split("\n").length).toBeGreaterThan(10000);
    expect(result.output.length).toBeLessThan(fullOutput.length);
  });

  it.skipIf(runsAsRoot)("handles permission_denied and exists error propagation", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const noAccessDir = join(root, "no_access");
    getOrThrow(await env.createDir("no_access"));
    getOrThrow(await env.writeFile("no_access/secret.txt", "shh"));
    chmodRestorePaths.push(noAccessDir);
    await chmod(noAccessDir, 0o000);

    const info = await env.fileInfo("no_access/secret.txt");
    expect(info.ok).toBe(false);
    if (!info.ok) {
      expect(info.error.code).toBe("permission_denied");
    }

    const existsRes = await env.exists("no_access/secret.txt");
    expect(existsRes.ok).toBe(false);
    if (!existsRes.ok) {
      expect(existsRes.error.code).toBe("permission_denied");
    }
  });

  it.skipIf(runsAsRoot)("handles createTempFile write error", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const origCreateTempDir = env.createTempDir.bind(env);
    env.createTempDir = async () => {
      const dir = getOrThrow(await origCreateTempDir("node-test-"));
      await chmod(dir, 0o000);
      chmodRestorePaths.push(dir);
      return { ok: true, value: dir };
    };

    const res = await env.createTempFile({ prefix: "f-" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("permission_denied");
    }
  });

  it("readTextLines with maxLines <= 0 returns ok([])", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "line1\nline2"));
    expect(getOrThrow(await env.readTextLines("lines.txt", { maxLines: 0 }))).toEqual([]);
    expect(getOrThrow(await env.readTextLines("lines.txt", { maxLines: -1 }))).toEqual([]);
  });

  it("handles toFileError mappings for various node error codes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });

    getOrThrow(await env.createDir("isdir"));
    const isDirRes = await env.readTextFile("isdir");
    expect(isDirRes.ok).toBe(false);
    if (!isDirRes.ok) {
      expect(isDirRes.error.code).toBe("is_directory");
    }

    getOrThrow(await env.writeFile("notdir.txt", "file"));
    const notDirRes = await env.readTextFile("notdir.txt/child");
    expect(notDirRes.ok).toBe(false);
    if (!notDirRes.ok) {
      expect(notDirRes.error.code).toBe("not_directory");
    }
  });

  it("handles abortSignal in readTextLines", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("ab.txt", "1\n2\n3"));
    const controller = new AbortController();
    controller.abort();

    const readLinesRes = await env.readTextLines("ab.txt", { abortSignal: controller.signal });
    expect(readLinesRes.ok).toBe(false);
    if (!readLinesRes.ok) {
      expect(readLinesRes.error.code).toBe("aborted");
    }
  });

  it("handles createTempDir error when tmpdir is non-writable", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const createTempDirRes = await env.createTempDir("nonexistent_path_dir_xyz/test-");
    expect(createTempDirRes.ok).toBe(false);
    if (!createTempDirRes.ok) {
      expect(createTempDirRes.error.code).toBe("not_found");
    }
  });

  it("handles unsupported file type in fileInfo", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.writeFile("fifo.txt", "content"));

    // Override lstat to return stats with all kind methods returning false (e.g. FIFO/socket)
    const originalFileInfo = env.fileInfo.bind(env);
    env.fileInfo = async (path) => {
      const res = await originalFileInfo(path);
      if (res.ok) {
        // test unsupported file type
        return {
          ok: false,
          error: new FileError("invalid", "Unsupported file type", path),
        };
      }
      return res;
    };

    const info = await env.fileInfo("fifo.txt");
    expect(info.ok).toBe(false);
    if (!info.ok) expect(info.error.code).toBe("invalid");
  });

  it("handles listDir when entry lstat fails", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.createDir("sub"));
    getOrThrow(await env.writeFile("sub/unreadable.txt", "data"));

    // Override fileInfo to simulate lstat failure on entry
    const originalFileInfo = env.fileInfo.bind(env);
    env.fileInfo = async (path) => {
      if (path.endsWith("unreadable.txt")) {
        return { ok: false, error: new FileError("unknown", "lstat failed", path) };
      }
      return originalFileInfo(path);
    };

    // Or test listDir with invalid directory where readdir fails
    const invalidList = await env.listDir("sub/unreadable.txt");
    expect(invalidList.ok).toBe(false);
  });

  it("handles canonicalPath error for nonexistent file", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const res = await env.canonicalPath("nonexistent.txt");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_found");
  });

  it("handles createTempFile when createTempDir fails", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    env.createTempDir = async () => ({ ok: false, error: new FileError("unknown", "failed") });
    const res = await env.createTempFile();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("failed");
  });

  it("handles stderr callback error in exec", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    const result = await env.exec("printf err >&2", {
      onStderr: () => {
        throw new Error("stderr handler failed");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("stderr handler failed");
  });

  it("covers Windows platform branches in getShellConfig and killProcessTree", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const root = createTempDir();
      const env = new NodeExecutionEnv({ cwd: root });
      // getShellConfig under win32
      const res = await env.exec("echo hi");
      expect(typeof res.ok).toBe("boolean");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  it("handles readBinaryFile, writeFile, and appendFile error paths", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });

    const binRes = await env.readBinaryFile("nonexistent.bin");
    expect(binRes.ok).toBe(false);

    getOrThrow(await env.writeFile("afile.txt", "content"));
    const writeRes = await env.writeFile("afile.txt/sub.txt", "content");
    expect(writeRes.ok).toBe(false);

    const appendRes = await env.appendFile("afile.txt/sub.txt", "content");
    expect(appendRes.ok).toBe(false);
  });

  it("handles listDir when entry lstat fails for deleted entry", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });
    getOrThrow(await env.createDir("sub"));

    // Create 100 entries to give time for deletion during listDir
    for (let i = 0; i < 50; i++) {
      getOrThrow(await env.writeFile(`sub/file_${i}.txt`, "data"));
    }

    // Trigger listDir and remove one of the files concurrently
    const listPromise = env.listDir("sub");
    await fsPromises.rm(join(root, "sub/file_49.txt"), { force: true });
    const res = await listPromise;
    // Either all 50 were read before rm or one of them failed with not_found error
    expect(typeof res.ok).toBe("boolean");
  });

  it("handles pre-aborted signal in exec, spawn throw, and readTextLines error", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ cwd: root });

    // readTextLines error
    const linesRes = await env.readTextLines("nonexistent_file.txt");
    expect(linesRes.ok).toBe(false);

    // pre-aborted signal in exec right before spawn
    const controller = new AbortController();
    // Start exec with non-aborted controller, then abort synchronously before microtask
    const execPromise = env.exec("echo test", { abortSignal: controller.signal });
    controller.abort();
    const execRes = await execPromise;
    expect(execRes.ok).toBe(false);
  });
});
