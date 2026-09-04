import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { TEST_PATH_PATTERN } from "../constants.ts";
import { WORKSPACE_EFFECT_SKIPPED_SEGMENTS } from "../workspace-effect-state.ts";

export type TestWorkspaceSnapshot = Map<string, string>;

const SKIPPED_DIRECTORIES = new Set(WORKSPACE_EFFECT_SKIPPED_SEGMENTS);
const MAX_VISITED_ENTRIES = 50_000;
const MAX_TEST_FILES = 2_000;
const execFileAsync = promisify(execFile);

export async function captureTestWorkspaceSnapshot(cwd: string): Promise<TestWorkspaceSnapshot | undefined> {
  const snapshot = new Map<string, string>();
  let visitedEntries = 0;
  try {
    const [gitPaths, ignoredPaths] = await Promise.all([gitChangedTestPaths(cwd), gitIgnoredTestPaths(cwd)]);
    if (gitPaths && ignoredPaths) {
      const relevantPaths = [...new Set([...gitPaths, ...ignoredPaths])];
      if (relevantPaths.length > MAX_TEST_FILES) throw new Error("workspace snapshot test-file limit exceeded");
      await Promise.all(relevantPaths.map((filePath) => recordPath(filePath)));
    } else {
      await walk(cwd, "");
    }
    return snapshot;
  } catch {
    return undefined;
  }

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > MAX_VISITED_ENTRIES) throw new Error("workspace snapshot entry limit exceeded");
      if (entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !TEST_PATH_PATTERN.test(relativePath)) continue;
      await recordPath(relativePath, absolutePath);
    }
  }

  async function recordPath(relativePath: string, absolutePath = join(cwd, relativePath)): Promise<void> {
    if (snapshot.size >= MAX_TEST_FILES) throw new Error("workspace snapshot test-file limit exceeded");
    try {
      const metadata = await stat(absolutePath, { bigint: true });
      snapshot.set(relativePath, `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`);
    } catch {
      snapshot.set(relativePath, "missing");
    }
  }
}

async function gitIgnoredTestPaths(cwd: string): Promise<string[] | undefined> {
  try {
    const skippedPathspecs = WORKSPACE_EFFECT_SKIPPED_SEGMENTS.map((segment) => `:(exclude,glob)**/${segment}/**`);
    const result = await execFileAsync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".", ...skippedPathspecs],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return String(result.stdout)
      .split("\0")
      .filter((filePath) => TEST_PATH_PATTERN.test(filePath.replaceAll("\\", "/")))
      .slice(0, MAX_TEST_FILES + 1);
  } catch {
    return undefined;
  }
}

async function gitChangedTestPaths(cwd: string): Promise<string[] | undefined> {
  try {
    const result = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const records = String(result.stdout).split("\0").filter(Boolean);
    const paths = new Set<string>();
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      const status = record.slice(0, 2);
      const filePath = record.slice(3).replaceAll("\\", "/");
      if (TEST_PATH_PATTERN.test(filePath)) paths.add(filePath);
      if (/[RC]/u.test(status)) {
        const sourcePath = records[index + 1]?.replaceAll("\\", "/");
        if (sourcePath && TEST_PATH_PATTERN.test(sourcePath)) paths.add(sourcePath);
        index += 1;
      }
    }
    return [...paths].slice(0, MAX_TEST_FILES + 1);
  } catch {
    return undefined;
  }
}

export function changedTestPaths(before: TestWorkspaceSnapshot, after: TestWorkspaceSnapshot): string[] {
  const allPaths = new Set([...before.keys(), ...after.keys()]);
  return [...allPaths].filter((filePath) => before.get(filePath) !== after.get(filePath)).sort();
}
