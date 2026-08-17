import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function workspacePatterns(rootPackage) {
  if (Array.isArray(rootPackage.workspaces)) {
    return rootPackage.workspaces;
  }
  if (Array.isArray(rootPackage.workspaces?.packages)) {
    return rootPackage.workspaces.packages;
  }
  throw new Error("Root package.json must declare npm workspaces");
}

export function resolveWorkspacePackagePaths(rootPackage, availablePaths) {
  const available = new Set(availablePaths);
  const paths = new Set();
  for (const pattern of workspacePatterns(rootPackage)) {
    if (pattern.endsWith("/*")) {
      const relativeRoot = pattern.slice(0, -2);
      const prefix = `${relativeRoot}/`;
      for (const path of available) {
        if (path.startsWith(prefix) && path.endsWith("/package.json")) {
          const relative = path.slice(prefix.length);
          if (!relative.slice(0, -"/package.json".length).includes("/")) {
            paths.add(path);
          }
        }
      }
    } else {
      const path = pattern.endsWith("package.json") ? pattern : `${pattern}/package.json`;
      if (!available.has(path)) {
        throw new Error(`Configured workspace is missing package.json: ${pattern}`);
      }
      paths.add(path);
    }
  }
  return [...paths].sort();
}

export function discoverWorkspacePackagePaths(repoRoot) {
  const rootPackage = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const availablePaths = [];
  for (const pattern of workspacePatterns(rootPackage)) {
    if (pattern.endsWith("/*")) {
      const relativeRoot = pattern.slice(0, -2);
      const absoluteRoot = join(repoRoot, relativeRoot);
      if (!existsSync(absoluteRoot)) {
        continue;
      }
      for (const name of readdirSync(absoluteRoot)) {
        const path = `${relativeRoot}/${name}/package.json`;
        if (existsSync(join(repoRoot, path))) {
          availablePaths.push(path);
        }
      }
    } else {
      const path = pattern.endsWith("package.json") ? pattern : `${pattern}/package.json`;
      if (existsSync(join(repoRoot, path))) {
        availablePaths.push(path);
      }
    }
  }
  return resolveWorkspacePackagePaths(rootPackage, availablePaths);
}

export function readWorkspacePackages(repoRoot) {
  return discoverWorkspacePackagePaths(repoRoot).map((path) => ({
    path,
    packageJson: JSON.parse(readFileSync(join(repoRoot, path), "utf8")),
  }));
}
