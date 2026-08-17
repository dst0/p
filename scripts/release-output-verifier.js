import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createReleaseAuditEvidence } from "./release-audit-evidence.js";
import { getChangelogPaths } from "./release-changelog-audit.js";
import { getCurrentChangeFragments, previewReleaseChangelogs } from "./release-change-fragments.js";
import {
  versionLockfileContent,
  versionPackageContent,
  workspacePackageNames,
} from "./release-version-content.js";
import { readWorkspacePackages } from "./release-workspaces.js";

const CHANGELOG_HEADER = /^# Changelog\n\n## \[Unreleased\]\n\n/;
const RELEASED_MODELS = [
  "packages/ai/src/models.generated.ts",
  "packages/ai/src/image-models.generated.ts",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isValidUtcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function withBaseWorktree(repoRoot, baseSha, fn) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "p-release-base-"));
  const worktreeRoot = join(temporaryRoot, "base");
  let added = false;
  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreeRoot, baseSha], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    added = true;
    return fn(worktreeRoot);
  } finally {
    if (added) {
      execFileSync("git", ["worktree", "remove", "--force", worktreeRoot], {
        cwd: repoRoot,
        stdio: "ignore",
      });
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function bumpWorkspaceVersions(repoRoot, targetVersion) {
  const rootPackagePath = join(repoRoot, "package.json");
  const rootPackage = readJson(rootPackagePath);
  const workspacePackages = readWorkspacePackages(repoRoot);
  const internalPackageNames = workspacePackageNames(workspacePackages);

  for (const { path, packageJson } of workspacePackages) {
    writeJson(
      join(repoRoot, path),
      versionPackageContent(packageJson, targetVersion, internalPackageNames),
    );
  }

  rootPackage.version = targetVersion;
  writeJson(rootPackagePath, rootPackage);

  const lockfilePath = join(repoRoot, "package-lock.json");
  writeJson(
    lockfilePath,
    versionLockfileContent(readJson(lockfilePath), targetVersion, internalPackageNames),
  );
}

function regenerateCodingAgentShrinkwrap(repoRoot) {
  const shrinkwrapPath = join(repoRoot, "packages/coding-agent/npm-shrinkwrap.json");
  if (!existsSync(shrinkwrapPath)) {
    return;
  }
  execFileSync("node", [join(repoRoot, "scripts", "generate-coding-agent-shrinkwrap.js")], {
    cwd: repoRoot,
    stdio: "ignore",
  });
}

function mutateReleaseChangelogs(repoRoot, targetVersion, releaseDate) {
  const preview = previewReleaseChangelogs(repoRoot);
  for (const { path, content } of preview.changelogs) {
    writeFileSync(join(repoRoot, path), content);
  }

  const changelogPaths = getChangelogPaths(repoRoot);
  for (const path of changelogPaths) {
    const pathAbsolute = join(repoRoot, path);
    const content = readFileSync(pathAbsolute, "utf8");
    if (!CHANGELOG_HEADER.test(content)) {
      throw new Error(`${path}: missing canonical [Unreleased] header`);
    }
    writeFileSync(
      pathAbsolute,
      content.replace(
        CHANGELOG_HEADER,
        `# Changelog\n\n## [${targetVersion}] - ${releaseDate}\n\n`,
      ),
    );
  }

  for (const fragment of getCurrentChangeFragments(repoRoot)) {
    unlinkSync(join(repoRoot, fragment.path));
  }
}

function readGeneratedModelSource(repoRoot) {
  const paths = RELEASED_MODELS.filter((path) => existsSync(join(repoRoot, path)));
  return new Map(paths.map((path) => [path, readFileSync(join(repoRoot, path))]));
}

export function computeExpectedReleaseMutation(repoRoot, baseSha, targetVersion, releaseDate) {
  if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
    throw new Error(`Invalid release target: ${targetVersion}`);
  }
  if (!isValidUtcDate(releaseDate)) {
    throw new Error(`Invalid release date: ${releaseDate}`);
  }

  return withBaseWorktree(repoRoot, baseSha, (baseRoot) => {
    const workspacePackages = readWorkspacePackages(baseRoot);
    const workspacePackagePaths = workspacePackages.map(({ path }) => path).sort();
    const changelogPaths = getChangelogPaths(baseRoot);
    const baseFragments = getCurrentChangeFragments(baseRoot);
    const deletedPaths = baseFragments.map((fragment) => fragment.path).sort();

    bumpWorkspaceVersions(baseRoot, targetVersion);
    regenerateCodingAgentShrinkwrap(baseRoot);
    mutateReleaseChangelogs(baseRoot, targetVersion, releaseDate);

    const changedContents = new Map();
    for (const path of ["package.json", "package-lock.json"]) {
      if (existsSync(join(baseRoot, path))) {
        changedContents.set(path, readFileSync(join(baseRoot, path)));
      }
    }

    const expectedWorkspacePaths = [...new Set([...workspacePackagePaths, ...changelogPaths])];
    for (const path of expectedWorkspacePaths) {
      changedContents.set(path, readFileSync(join(baseRoot, path)));
    }

    const shrinkwrapPath = "packages/coding-agent/npm-shrinkwrap.json";
    if (existsSync(join(baseRoot, shrinkwrapPath))) {
      changedContents.set(shrinkwrapPath, readFileSync(join(baseRoot, shrinkwrapPath)));
    }

    return {
      expectedPaths: [...changedContents.keys()].sort(),
      changedContents,
      deletedPaths,
      unchangedContents: readGeneratedModelSource(baseRoot),
    };
  });
}

export function computeReleaseAuditEvidenceAtRevision(repoRoot, baseSha, targetVersion) {
  return withBaseWorktree(repoRoot, baseSha, (baseRoot) =>
    createReleaseAuditEvidence(baseRoot, targetVersion),
  );
}
