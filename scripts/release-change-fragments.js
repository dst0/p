import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  affectedChangelogPackages,
  getChangelogPaths,
  getReleaseBaseTag,
  validateChangelogContent,
} from "./release-changelog-audit.js";

const CONFIG_PATH = ".changes/config.json";
const FRAGMENT_POLICY_PATH = "scripts/release-change-fragments.js";
const NONE_REASON_ENFORCEMENT_MARKER = "release-none-reason-enforcement-v2";
const FRAGMENT_TYPES = new Set(["Added", "Changed", "Fixed", "Removed", "Breaking Changes", "None"]);
const CHANGELOG_PREFIX = "# Changelog\n\n## [Unreleased]\n";

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseFragment(path, content, allowLegacyNoneSummary = false) {
  let fragment;
  try {
    fragment = JSON.parse(content);
  } catch {
    throw new Error(`${path}: release-note fragment must be valid JSON`);
  }
  if (fragment.schemaVersion !== 1) {
    throw new Error(`${path}: unsupported release-note fragment schema`);
  }
  if (!Array.isArray(fragment.packages) || fragment.packages.length === 0) {
    throw new Error(`${path}: release-note fragment must name at least one package`);
  }
  const packages = [...new Set(fragment.packages)];
  if (packages.some((name) => !["agent", "ai", "coding-agent", "tui"].includes(name))) {
    throw new Error(`${path}: release-note fragment names an unknown changelog package`);
  }
  if (!FRAGMENT_TYPES.has(fragment.type)) {
    throw new Error(`${path}: release-note fragment type is invalid`);
  }
  if (fragment.type === "None") {
    const justification = fragment.reason ?? (allowLegacyNoneSummary ? fragment.summary : undefined);
    if (typeof justification !== "string" || justification.trim().length < 10) {
      throw new Error(`${path}: None fragments require a specific reason`);
    }
    if (/[\u0000-\u001f\u007f]/.test(justification)) {
      throw new Error(`${path}: None fragment reason must be single-line text`);
    }
  } else if (typeof fragment.summary !== "string" || fragment.summary.trim().length < 10) {
    throw new Error(`${path}: release-note fragment requires a specific summary`);
  } else if (/[\u0000-\u001f\u007f]/.test(fragment.summary)) {
    throw new Error(`${path}: release-note fragment requires a single-line summary`);
  }
  return {
    path,
    id: path.slice(".changes/".length, -".json".length),
    packages: packages.sort(),
    type: fragment.type,
    summary: fragment.summary?.trim(),
    reason: fragment.reason?.trim(),
    contentHash: sha256(content),
  };
}

function materialPaths(paths) {
  return paths.filter(
    (path) =>
      !path.startsWith(".changes/") &&
      !path.startsWith("release-certificates/") &&
      !/\/CHANGELOG\.md$/.test(path),
  );
}

function policyCommit(repoRoot) {
  const commits = git(repoRoot, ["rev-list", "--first-parent", "--reverse", "HEAD"])
    .split("\n")
    .filter(Boolean);
  for (const commit of commits) {
    if (!existsAtRevision(repoRoot, commit, CONFIG_PATH)) {
      continue;
    }
    if (existsAtRevision(repoRoot, `${commit}^`, CONFIG_PATH)) {
      continue;
    }
    return commit;
  }
  throw new Error(`${CONFIG_PATH} must be committed before release audit certification`);
}

function existsAtRevision(repoRoot, revision, path) {
  try {
    execFileSync("git", ["cat-file", "-e", `${revision}:${path}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function noneReasonEnforcementCutoff(repoRoot) {
  const commit = git(repoRoot, [
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H",
    `-S${NONE_REASON_ENFORCEMENT_MARKER}`,
    "--",
    FRAGMENT_POLICY_PATH,
  ]).split("\n")[0];
  if (commit) {
    return git(repoRoot, ["rev-parse", `${commit}^`]);
  }
  try {
    if (readFileSync(join(repoRoot, FRAGMENT_POLICY_PATH), "utf8").includes(NONE_REASON_ENFORCEMENT_MARKER)) {
      return git(repoRoot, ["rev-parse", "HEAD"]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function contentAtRevision(repoRoot, revision, path) {
  try {
    return execFileSync("git", ["show", `${revision}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

export function createChangeFragmentEvidence(repoRoot, baseTag = getReleaseBaseTag(repoRoot)) {
  const startCommit = policyCommit(repoRoot);
  const noneReasonCutoff = noneReasonEnforcementCutoff(repoRoot);
  const parent = git(repoRoot, ["rev-parse", `${startCommit}^`]);
  const policyPredatesBase = isAncestor(repoRoot, startCommit, baseTag);
  const rangeStart = policyPredatesBase ? baseTag : parent;
  const legacyPaths = policyPredatesBase
    ? []
    : git(repoRoot, ["diff", "--name-only", `${baseTag}..${parent}`]).split("\n").filter(Boolean);
  const commits = git(repoRoot, ["rev-list", "--first-parent", "--reverse", `${rangeStart}..HEAD`])
    .split("\n")
    .filter(Boolean);
  const evidence = [];
  const introducedFragments = new Map();
  for (const commit of commits) {
    const changedPaths = git(repoRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", `${commit}^`, commit])
      .split("\n")
      .filter(Boolean)
      .sort();
    const affectedPackages = affectedChangelogPackages(materialPaths(changedPaths));
    const fragmentPaths = changedPaths.filter(
      (path) =>
        path.startsWith(".changes/") &&
        path.endsWith(".json") &&
        path !== CONFIG_PATH &&
        existsAtRevision(repoRoot, commit, path),
    );
    const allowLegacyNoneSummary = noneReasonCutoff !== undefined && isAncestor(repoRoot, commit, noneReasonCutoff);
    const fragments = fragmentPaths.map((path) =>
      parseFragment(path, git(repoRoot, ["show", `${commit}:${path}`]), allowLegacyNoneSummary),
    );
    for (const fragment of fragments) {
      if (introducedFragments.has(fragment.id)) {
        throw new Error(
          `${fragment.path}: release-note fragment ${fragment.id} was introduced in a previous commit and cannot be modified`,
        );
      }
      introducedFragments.set(fragment.id, fragment);
    }
    if (affectedPackages.length > 0 && fragments.length === 0) {
      throw new Error(`${commit}: material release changes require a release-note fragment in the same commit`);
    }
    const coveredPackages = new Set(fragments.flatMap((fragment) => fragment.packages));
    const missingPackages = affectedPackages.filter((name) => !coveredPackages.has(name));
    if (missingPackages.length > 0) {
      throw new Error(`${commit}: release-note fragments do not cover ${missingPackages.join(", ")}`);
    }
    if (affectedPackages.length > 0) {
      evidence.push({
        commit,
        affectedPackages,
        changedPathsHash: sha256(changedPaths.join("\0")),
        fragments,
      });
    }
  }
  const currentFragments = new Map(getCurrentChangeFragments(repoRoot).map((fragment) => [fragment.id, fragment]));
  if (currentFragments.size !== introducedFragments.size) {
    throw new Error("Material release evidence requires current release-note fragments to match introductions");
  }
  for (const [id, expected] of introducedFragments) {
    if (!currentFragments.has(id)) {
      throw new Error(`Material release evidence requires current release-note fragment ${expected.path}`);
    }
  }
  return {
    policyCommit: startCommit,
    baseTag,
    legacyAffectedPackages: affectedChangelogPackages(materialPaths(legacyPaths)),
    commits: evidence,
  };
}

export function getCurrentChangeFragments(repoRoot) {
  const changesRoot = join(repoRoot, ".changes");
  const noneReasonCutoff = noneReasonEnforcementCutoff(repoRoot);
  return readdirSync(changesRoot)
    .filter((name) => name.endsWith(".json") && name !== "config.json")
    .sort()
    .map((name) => {
      const path = `.changes/${name}`;
      const content = readFileSync(join(repoRoot, path), "utf8");
      const legacyContent = noneReasonCutoff && contentAtRevision(repoRoot, noneReasonCutoff, path);
      return parseFragment(path, content, legacyContent === content);
    });
}

function addSummaries(content, type, summaries) {
  if (!content.startsWith(CHANGELOG_PREFIX)) {
    throw new Error("Cannot aggregate fragments into a malformed changelog");
  }
  const heading = `### ${type}\n\n`;
  const bullets = `${summaries.map((summary) => `- ${summary}`).join("\n")}\n`;
  const nextRelease = content.indexOf("\n## [", CHANGELOG_PREFIX.length);
  const boundary = nextRelease === -1 ? content.length : nextRelease;
  const unreleased = content.slice(0, boundary);
  const releasedHistory = content.slice(boundary);
  if (unreleased.includes(heading)) {
    return `${unreleased.replace(heading, `${heading}${bullets}`)}${releasedHistory}`;
  }
  return `${unreleased.trimEnd()}\n\n${heading}${bullets}\n${releasedHistory.replace(/^\n/, "")}`;
}

export function previewReleaseChangelogs(repoRoot) {
  const fragments = getCurrentChangeFragments(repoRoot);
  const grouped = new Map();
  for (const fragment of fragments) {
    if (fragment.type === "None") {
      continue;
    }
    for (const packageName of fragment.packages) {
      const key = `${packageName}\0${fragment.type}`;
      const summaries = grouped.get(key) ?? [];
      summaries.push(fragment.summary);
      grouped.set(key, summaries);
    }
  }
  const contents = new Map(
    getChangelogPaths(repoRoot).map((path) => [path, readFileSync(join(repoRoot, path), "utf8")]),
  );
  for (const [key, summaries] of grouped) {
    const [packageName, type] = key.split("\0");
    const path = `packages/${packageName}/CHANGELOG.md`;
    if (!contents.has(path)) {
      throw new Error(`Release-note fragment targets missing changelog package ${packageName}`);
    }
    contents.set(path, addSummaries(contents.get(path), type, summaries));
  }
  const changelogs = [...contents].map(([path, content]) => {
    validateChangelogContent(path, content);
    return { path, content, contentHash: sha256(content) };
  });
  return { fragments, changelogs };
}

export function applyReleaseFragments(repoRoot) {
  const preview = previewReleaseChangelogs(repoRoot);
  for (const { path, content } of preview.changelogs) {
    writeFileSync(join(repoRoot, path), content);
  }
  for (const fragment of preview.fragments) {
    unlinkSync(join(repoRoot, fragment.path));
  }
  return preview.fragments;
}
