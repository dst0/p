import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, parse, relative } from "node:path";
import { assertSnapshotSymlinksContained } from "../harness/runtime-snapshot.ts";
import { hashFile } from "./certification-binding.ts";

export interface CertifiedExternalSymlinkProvenance {
  linkPath: string;
  targetPath: string;
  sha256: string;
}

export interface CertifiedExecutableSnapshotOptions {
  allowedExternalSymlinks?: readonly { link: string; target: string }[];
}

export interface CertifiedExecutableSnapshot {
  executablePath: string;
  sourcePath: string;
  externalSymlinks: CertifiedExternalSymlinkProvenance[];
}

type CertifiedExternalSymlinkTarget = Omit<CertifiedExternalSymlinkProvenance, "sha256">;

export function snapshotCertifiedExecutableRuntime(
  executable: string | undefined,
  defaultName: string,
  destination: string,
  options: CertifiedExecutableSnapshotOptions = {},
): CertifiedExecutableSnapshot {
  const sourcePath = resolveExecutable(executable, defaultName);
  const packageRoot = findPackageRoot(sourcePath);
  if (packageRoot) {
    const externalTargets = validatePackageSymlinks(packageRoot, options);
    const externalSymlinks: CertifiedExternalSymlinkProvenance[] = [];
    cpSync(packageRoot, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
    for (const target of externalTargets) {
      const copiedPath = join(destination, target.linkPath);
      rmSync(copiedPath, { force: true });
      cpSync(target.targetPath, copiedPath);
      const copiedStat = lstatSync(copiedPath);
      if (!copiedStat.isFile() || copiedStat.isSymbolicLink() || copiedStat.nlink !== 1) {
        throw new Error(`Certified runtime external link did not freeze to a regular file: ${target.linkPath}`);
      }
      externalSymlinks.push({ ...target, sha256: hashFile(copiedPath) });
    }
    assertSnapshotSymlinksContained(destination);
    return { executablePath: join(destination, relative(packageRoot, sourcePath)), sourcePath, externalSymlinks };
  }
  if (!isNativeExecutable(sourcePath)) {
    throw new Error(
      `Unable to freeze ${defaultName} runtime closure for ${sourcePath}; use an executable inside its package root`,
    );
  }
  const executablePath = join(destination, "bin", defaultName);
  mkdirSync(dirname(executablePath), { recursive: true });
  cpSync(sourcePath, executablePath);
  return { executablePath, sourcePath, externalSymlinks: [] };
}

function validatePackageSymlinks(
  packageRoot: string,
  options: CertifiedExecutableSnapshotOptions,
): CertifiedExternalSymlinkTarget[] {
  const root = realpathSync(packageRoot);
  const allowlist = new Map(
    (options.allowedExternalSymlinks ?? []).map((entry) => [entry.link, realpathSync(entry.target)]),
  );
  const targets: CertifiedExternalSymlinkTarget[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const relativePath = relative(root, path);
      if (lstatSync(path).isSymbolicLink()) {
        const targetPath = realpathSync(path);
        if (targetPath === root || targetPath.startsWith(`${root}/`)) continue;
        const allowedTarget = allowlist.get(relativePath);
        if (allowedTarget !== targetPath || !lstatSync(targetPath).isFile()) {
          throw new Error(`Certified runtime contains an external symbolic link: ${relativePath}`);
        }
        targets.push({ linkPath: relativePath, targetPath });
      } else if (entry.isDirectory()) visit(path);
    }
  };
  visit(root);
  return targets;
}

function resolveExecutable(executable: string | undefined, defaultName: string): string {
  if (executable && existsSync(executable)) return realpathSync(executable);
  if (!executable) {
    const result = spawnSync("which", [defaultName], { encoding: "utf8" });
    const candidate = result.status === 0 ? result.stdout.trim() : "";
    if (candidate && existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(`Missing ${defaultName} executable; certified mode requires an installed runtime`);
}

function findPackageRoot(executable: string): string | undefined {
  let current = dirname(executable);
  const filesystemRoot = parse(current).root;
  while (current !== filesystemRoot) {
    if (existsSync(join(current, "package.json"))) return current;
    current = dirname(current);
  }
  return undefined;
}

function isNativeExecutable(path: string): boolean {
  const header = readFileSync(path).subarray(0, 4).toString("hex");
  return new Set(["cafebabe", "feedface", "feedfacf", "cefaedfe", "cffaedfe"]).has(header);
}
