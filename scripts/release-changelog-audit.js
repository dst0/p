import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CHANGELOG_PREFIX = "# Changelog\n\n## [Unreleased]\n";
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const DIRECT_CHANGELOG_PACKAGES = new Set(["agent", "ai", "coding-agent", "tui"]);
const RELEASE_TOOL_PATH = /^(AGENTS\.md|package(?:-lock)?\.json|scripts\/(?:release|version-bump)|\.github\/workflows\/(?:build-binaries|ci)\.yml)/;

function git(repoRoot, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return null;
    }
    throw error;
  }
}

function isValidUtcDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function unreleasedEntries(content) {
  const nextSection = content.indexOf("\n## [", CHANGELOG_PREFIX.length);
  const body = content.slice(CHANGELOG_PREFIX.length, nextSection === -1 ? undefined : nextSection);
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

function releasedHistory(content) {
  const releaseStart = /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/m.exec(content)?.index;
  return releaseStart === undefined ? "" : content.slice(releaseStart).trimEnd();
}

export function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

export function validateChangelogContent(path, content) {
  const unreleasedCount = content.match(/^## \[Unreleased\]$/gm)?.length ?? 0;
  if (unreleasedCount !== 1) {
    throw new Error(`${path}: [Unreleased] must appear exactly once`);
  }
  if (!content.startsWith(CHANGELOG_PREFIX)) {
    throw new Error(`${path}: [Unreleased] must be the first section after # Changelog`);
  }

  const headings = content.split("\n").filter((line) => line.startsWith("## "));
  const releases = headings.slice(1).map((heading) => {
    const match = RELEASE_HEADING.exec(heading);
    if (!match) {
      throw new Error(`${path}: malformed release heading: ${heading}`);
    }
    return { version: match[1], date: match[2] };
  });
  for (const release of releases) {
    if (!isValidUtcDate(release.date)) {
      throw new Error(`${path}: ${release.date} must be a valid UTC date`);
    }
  }
  if (releases.length >= 2 && compareVersions(releases[0].version, releases[1].version) <= 0) {
    throw new Error(
      `${path}: newest release ${releases[0].version} must be greater than previous release ${releases[1].version}`,
    );
  }

  return {
    path,
    unreleasedEntries: unreleasedEntries(content),
    releaseVersions: releases.map((release) => release.version),
  };
}

export function affectedChangelogPackages(changedPaths) {
  const affected = new Set();
  for (const path of changedPaths) {
    const packageMatch = /^packages\/([^/]+)\//.exec(path);
    if (packageMatch && DIRECT_CHANGELOG_PACKAGES.has(packageMatch[1])) {
      affected.add(packageMatch[1]);
    } else if (packageMatch?.[1] === "code-index" || RELEASE_TOOL_PATH.test(path)) {
      affected.add("coding-agent");
    }
  }
  return [...affected].sort();
}

export function getChangelogPaths(repoRoot) {
  const packagesRoot = join(repoRoot, "packages");
  return readdirSync(packagesRoot)
    .map((name) => `packages/${name}/CHANGELOG.md`)
    .filter((path) => existsSync(join(repoRoot, path)))
    .sort();
}

function readBaseChangelog(repoRoot, baseTag, path) {
  return git(repoRoot, ["show", `${baseTag}:${path}`], { allowFailure: true });
}

function hashStrings(values) {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(`${Buffer.byteLength(value)}:`);
    hash.update(value);
  }
  return hash.digest("hex");
}

export function getReleaseBaseTag(repoRoot) {
  const tagOutput = git(repoRoot, ["tag", "--merged", "HEAD", "--list", "v[0-9]*", "--sort=-version:refname"]);
  const baseTag = tagOutput
    .split("\n")
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (!baseTag || !/^v\d+\.\d+\.\d+$/.test(baseTag)) {
    throw new Error("A semantic-version release tag is required as the changelog audit base");
  }
  return baseTag;
}

export function createChangelogEvidence(repoRoot, options = {}) {
  const baseTag = options.baseTag ?? getReleaseBaseTag(repoRoot);
  const changedOutput = git(repoRoot, ["diff", "--name-only", `${baseTag}..HEAD`]);
  const changedPaths = changedOutput ? changedOutput.split("\n").filter(Boolean).sort() : [];
  const affectedPackages = affectedChangelogPackages(changedPaths);
  const changelogs = getChangelogPaths(repoRoot).map((path) => {
    const currentContent = readFileSync(join(repoRoot, path), "utf8");
    const current = validateChangelogContent(path, currentContent);
    const baseContent = readBaseChangelog(repoRoot, baseTag, path);
    if (baseContent !== null && releasedHistory(currentContent) !== releasedHistory(baseContent)) {
      throw new Error(`${path}: released history is immutable after ${baseTag}`);
    }
    const baseEntries = baseContent?.startsWith(CHANGELOG_PREFIX) ? unreleasedEntries(baseContent) : [];
    const baseEntrySet = new Set(baseEntries);
    return {
      path,
      packageName: path.split("/")[1],
      unreleasedEntries: current.unreleasedEntries,
      addedEntries: current.unreleasedEntries.filter((entry) => !baseEntrySet.has(entry)),
      releaseVersions: current.releaseVersions,
      releasedHistoryHash: hashStrings([releasedHistory(currentContent)]),
    };
  });

  const requiredEntryPackages = options.requiredEntryPackages ?? affectedPackages;
  for (const packageName of requiredEntryPackages) {
    const changelog = changelogs.find((entry) => entry.packageName === packageName);
    if (!changelog) {
      throw new Error(`No changelog owns release changes for package ${packageName}`);
    }
    if (changelog.addedEntries.length === 0) {
      throw new Error(`${changelog.path}: changed package ${packageName} needs a new [Unreleased] entry`);
    }
  }

  return {
    baseTag,
    affectedPackages,
    changedPathCount: changedPaths.length,
    changedPathsHash: hashStrings(changedPaths),
    changelogs,
  };
}
