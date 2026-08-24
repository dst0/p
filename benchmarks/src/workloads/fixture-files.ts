import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

export function fixtureDirectory(taskId: string): string {
  return join(fixturesRoot, taskId);
}

export function listFixtureFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...listFixtureFiles(root, path));
    else files.push(relative(root, path));
  }
  return files.sort();
}

export function readFixtureFiles(
  taskId: string,
  excludedFiles: ReadonlySet<string> = new Set(),
): Readonly<Record<string, string>> {
  const root = fixtureDirectory(taskId);
  return Object.fromEntries(
    listFixtureFiles(root)
      .filter((path) => !excludedFiles.has(path))
      .map((path) => [path, readFileSync(join(root, path), "utf8")]),
  );
}

export function readFixtureText(taskId: string, path: string): string {
  return readFileSync(join(fixtureDirectory(taskId), path), "utf8");
}

export function readWorkspaceText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}
