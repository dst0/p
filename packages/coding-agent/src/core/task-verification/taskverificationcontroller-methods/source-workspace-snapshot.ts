import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, lstatSync, openSync, readlinkSync, readSync } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  isSkippedWorkspaceEffectPath,
  normalizeWorkspaceEffectPath,
  WORKSPACE_EFFECT_SKIPPED_SEGMENTS,
} from "../workspace-effect-state.ts";

export interface SourceWorkspaceSnapshot extends Map<string, string> {
  gitRepository: boolean;
}

const MAX_WORKSPACE_PATHS = 5_000;
const execFileAsync = promisify(execFile);

export async function captureSourceWorkspaceSnapshot(
  cwd: string,
  hintedPaths: readonly string[] = [],
  excludedPaths: readonly string[] = [],
): Promise<SourceWorkspaceSnapshot | undefined> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  } catch {
    return captureFallbackSourceSnapshot(cwd, hintedPaths, excludedPaths);
  }
  try {
    const [statusPaths, ignoredPaths] = await Promise.all([gitChangedPaths(cwd), gitIgnoredPaths(cwd)]);
    const exclusions = new Set(excludedPaths.map(normalizeWorkspaceEffectPath).filter(isString));
    const paths = [
      ...new Set([...statusPaths, ...ignoredPaths, ...hintedPaths.map(normalizeWorkspaceEffectPath).filter(isString)]),
    ].filter((filePath) => !exclusions.has(filePath));
    if (paths.length > MAX_WORKSPACE_PATHS) return undefined;
    const entries = await Promise.all(
      paths.map(async (filePath) => [filePath, await readPathState(cwd, filePath)] as const),
    );
    const snapshot = new Map(entries) as SourceWorkspaceSnapshot;
    snapshot.gitRepository = true;
    return snapshot;
  } catch {
    return undefined;
  }
}

export function changedSourcePaths(before: SourceWorkspaceSnapshot, after: SourceWorkspaceSnapshot): string[] {
  const allPaths = new Set([...before.keys(), ...after.keys()]);
  return [...allPaths].filter((filePath) => before.get(filePath) !== after.get(filePath)).sort();
}

export function computeWorkspaceEffectHash(cwd: string, paths: readonly string[]): string | undefined {
  try {
    const hash = createHash("sha256");
    for (const filePath of [...paths].sort()) {
      const normalized = normalizeWorkspaceEffectPath(filePath);
      if (!normalized || normalized !== filePath) return undefined;
      hash.update(normalized).update("\0").update(readPathStateSync(cwd, normalized)).update("\0");
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

async function gitChangedPaths(cwd: string): Promise<string[]> {
  const result = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  const records = decodeGitOutput(result.stdout).split("\0").filter(Boolean);
  const paths = new Set<string>();
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const status = record.slice(0, 2);
    addPath(paths, record.slice(3));
    if (/[RC]/u.test(status)) {
      addPath(paths, records[index + 1] ?? "");
      index += 1;
    }
  }
  return [...paths];
}

async function gitIgnoredPaths(cwd: string): Promise<string[]> {
  const skippedPathspecs = WORKSPACE_EFFECT_SKIPPED_SEGMENTS.map((segment) => `:(exclude,glob)**/${segment}/**`);
  const result = await execFileAsync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".", ...skippedPathspecs],
    { cwd, maxBuffer: 16 * 1024 * 1024 },
  );
  const paths = new Set<string>();
  for (const filePath of decodeGitOutput(result.stdout).split("\0")) addPath(paths, filePath);
  return [...paths];
}

function addPath(paths: Set<string>, value: string): void {
  if (!value) return;
  const normalized = normalizeWorkspaceEffectPath(value);
  if (normalized) {
    paths.add(normalized);
    return;
  }
  if (!isSkippedWorkspaceEffectPath(value)) throw new Error("unrepresentable workspace path");
}

function decodeGitOutput(value: string | Buffer): string {
  if (typeof value === "string") return value;
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

async function readPathState(cwd: string, filePath: string): Promise<string> {
  const absolutePath = join(cwd, filePath);
  try {
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) return `symlink:${digest(await readlink(absolutePath))}`;
    if (metadata.isFile()) return `file:${metadata.mode & 0o111 ? "x" : "-"}:${await digestFile(absolutePath)}`;
    if (metadata.isDirectory()) return "directory";
    return `other:${metadata.mode}`;
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
}

function readPathStateSync(cwd: string, filePath: string): string {
  const absolutePath = join(cwd, filePath);
  try {
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) return `symlink:${digest(readlinkSync(absolutePath))}`;
    if (metadata.isFile()) return `file:${metadata.mode & 0o111 ? "x" : "-"}:${digestFileSync(absolutePath)}`;
    if (metadata.isDirectory()) return "directory";
    return `other:${metadata.mode}`;
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
}

export function readWorkspaceEffectPathState(cwd: string, filePath: string): string | undefined {
  try {
    return readPathStateSync(cwd, filePath);
  } catch {
    return undefined;
  }
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function digestFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function digestFileSync(filePath: string): string {
  const descriptor = openSync(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      hash.update(buffer.subarray(0, bytesRead));
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

async function captureFallbackSourceSnapshot(
  cwd: string,
  hintedPaths: readonly string[],
  excludedPaths: readonly string[],
): Promise<SourceWorkspaceSnapshot | undefined> {
  const exclusions = new Set(excludedPaths.map(normalizeWorkspaceEffectPath).filter(isString));
  const paths = new Set(
    hintedPaths
      .map(normalizeWorkspaceEffectPath)
      .filter(isString)
      .filter((filePath) => !exclusions.has(filePath)),
  );
  if (paths.size > MAX_WORKSPACE_PATHS) return undefined;
  let visited = 0;
  try {
    await walk(cwd, "");
    const entries = await Promise.all(
      [...paths]
        .filter((filePath) => !exclusions.has(filePath))
        .map(async (filePath) => [filePath, await readPathState(cwd, filePath)] as const),
    );
    const snapshot = new Map(entries) as SourceWorkspaceSnapshot;
    snapshot.gitRepository = false;
    return snapshot;
  } catch {
    return undefined;
  }

  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      visited += 1;
      if (visited > 50_000 || paths.size > MAX_WORKSPACE_PATHS) throw new Error("workspace snapshot limit exceeded");
      const filePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const normalized = normalizeWorkspaceEffectPath(filePath);
      if (!normalized) {
        if (isSkippedWorkspaceEffectPath(filePath)) continue;
        throw new Error("unrepresentable workspace path");
      }
      if (entry.isDirectory()) await walk(join(directory, entry.name), normalized);
      else if ((entry.isFile() || entry.isSymbolicLink()) && !exclusions.has(normalized)) {
        paths.add(normalized);
        if (paths.size > MAX_WORKSPACE_PATHS) throw new Error("workspace snapshot path limit exceeded");
      }
    }
  }
}
