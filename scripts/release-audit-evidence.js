import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  compareVersions,
  createChangelogEvidence,
  getReleaseBaseTag,
} from "./release-changelog-audit.js";
import {
  createChangeFragmentEvidence,
  previewReleaseChangelogs,
} from "./release-change-fragments.js";

function currentVersion(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
}

function assertBreakingChangeTarget(repoRoot, targetVersion, fragments) {
  if (!fragments.some((fragment) => fragment.type === "Breaking Changes")) {
    return;
  }
  const current = currentVersion(repoRoot).split(".").map(Number);
  const target = targetVersion.split(".").map(Number);
  if (target[0] !== current[0] || target[1] <= current[1]) {
    throw new Error("Breaking Changes release-note fragments require a minor release target");
  }
}

export function createReleaseAuditEvidence(repoRoot, targetVersion) {
  const baseTag = getReleaseBaseTag(repoRoot);
  const changeFragments = createChangeFragmentEvidence(repoRoot, baseTag);
  const preview = previewReleaseChangelogs(repoRoot);
  assertBreakingChangeTarget(repoRoot, targetVersion, preview.fragments);
  const changelogs = createChangelogEvidence(repoRoot, {
    baseTag,
    requiredEntryPackages: changeFragments.legacyAffectedPackages,
  });
  for (const changelog of changelogs.changelogs) {
    const newestRelease = changelog.releaseVersions[0];
    if (newestRelease && compareVersions(targetVersion, newestRelease) <= 0) {
      throw new Error(`${changelog.path}: target ${targetVersion} must be greater than ${newestRelease}`);
    }
  }
  return {
    changelogs,
    changeFragments,
    releasePreview: {
      changelogs: preview.changelogs.map(({ path, contentHash }) => ({ path, contentHash })),
    },
  };
}
