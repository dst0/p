import { discoverWorkspacePackagePaths } from "./release-workspaces.js";

export function versionMutationPaths(repoRoot) {
  return new Set([
    "package.json",
    "package-lock.json",
    "packages/coding-agent/npm-shrinkwrap.json",
    ...discoverWorkspacePackagePaths(repoRoot),
  ]);
}

export function isAllowedReleaseMutationPath(repoRoot, path) {
  if (versionMutationPaths(repoRoot).has(path)) {
    return true;
  }
  if (/^packages\/(?:agent|ai|coding-agent|tui)\/CHANGELOG\.md$/.test(path)) {
    return true;
  }
  if (/^packages\/ai\/src\/(?:image-)?models\.generated\.ts$/.test(path)) {
    return true;
  }
  if (/^\.changes\/[^/]+\.json$/.test(path) && path !== ".changes/config.json") {
    return true;
  }
  return /^release-certificates\/v\d+\.\d+\.\d+\.json\.br$/.test(path);
}
