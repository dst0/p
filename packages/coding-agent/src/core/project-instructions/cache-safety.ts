import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export function assertCacheDirectorySafe(cacheDir: string, workspaceRoot: string, create: boolean): void {
  const trustedRoot = realpathSync(workspaceRoot);
  const resolvedCache = resolve(cacheDir);
  const fromRoot = relative(trustedRoot, resolvedCache);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Project instruction cache must stay inside the workspace: ${cacheDir}`);
  }
  assertExistingComponentsNotSymlinks(trustedRoot, fromRoot);
  if (create) ensurePrivateDirectory(resolvedCache);
  if (!existsSync(resolvedCache)) throw new Error("Project instruction cache does not exist");
  assertExistingComponentsNotSymlinks(trustedRoot, fromRoot);
}

export function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNotSymlink(directory);
  chmodSync(directory, 0o700);
}

export function writePrivateFile(filePath: string, content: string): void {
  writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function readRegularFile(filePath: string): string {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Expected a regular cache file");
  return readFileSync(filePath, "utf8");
}

export function assertNotSymlink(filePath: string): void {
  if (lstatSync(filePath).isSymbolicLink()) throw new Error(`Refusing symlinked cache path: ${filePath}`);
}

export function assertPathComponentsNotSymlinks(root: string, relativePath: string): void {
  let current = root;
  for (const part of relativePath.split(/[\\/]/u)) {
    current = join(current, part);
    assertNotSymlink(current);
  }
}

export function hasFileSystemCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as Error & { code?: unknown }).code === code;
}

function assertExistingComponentsNotSymlinks(root: string, relativePath: string): void {
  let current = root;
  for (const part of relativePath.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) return;
    assertNotSymlink(current);
  }
}
