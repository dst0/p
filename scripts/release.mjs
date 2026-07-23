#!/usr/bin/env node
/**
 * Release script for p-mono
 *
 * Usage:
 *   node scripts/release.mjs <major|minor|patch>
 *   node scripts/release.mjs <x.y.z>
 *
 * Steps:
 * 1. Check for uncommitted changes
 * 2. Bump version via npm run version:xxx or set an explicit version
 * 3. Update CHANGELOG.md files: [Unreleased] -> [version] - date
 * 4. Regenerate release artifacts
 * 5. Run checks
 * 6. Commit and tag the release
 * 7. Add new [Unreleased] section to changelogs
 * 8. Commit next-cycle changelog updates
 * 9. Push main and the tag to trigger CI publishing
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const RELEASE_TARGET = process.argv[2];
const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CHANGELOG_HEADER = "# Changelog\n\n## [Unreleased]\n\n";
const RELEASE_HEADING_RE = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm;

if (!RELEASE_TARGET || (!BUMP_TYPES.has(RELEASE_TARGET) && !SEMVER_RE.test(RELEASE_TARGET))) {
	console.error("Usage: node scripts/release.mjs <major|minor|patch|x.y.z>");
	process.exit(1);
}

function run(cmd, options = {}) {
	console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: options.silent ? "pipe" : "inherit", ...options });
	} catch (e) {
		if (!options.ignoreError) {
			console.error(`Command failed: ${cmd}`);
			process.exit(1);
		}
		return null;
	}
}

function getVersion() {
	const pkg = JSON.parse(readFileSync("packages/ai/package.json", "utf-8"));
	return pkg.version;
}

function compareVersions(a, b) {
	const aParts = a.split(".").map(Number);
	const bParts = b.split(".").map(Number);

	for (let i = 0; i < 3; i++) {
		const diff = (aParts[i] || 0) - (bParts[i] || 0);
		if (diff !== 0) {
			return diff;
		}
	}

	return 0;
}

function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stageChangedFiles() {
	const output = run("git ls-files -m -o -d --exclude-standard", { silent: true });
	const paths = [...new Set((output || "").split("\n").map((line) => line.trim()).filter(Boolean))];
	if (paths.length === 0) {
		return;
	}

	run(`git add -- ${paths.map(shellQuote).join(" ")}`);
}

function bumpOrSetVersion(target) {
	const currentVersion = getVersion();

	if (BUMP_TYPES.has(target)) {
		console.log(`Bumping version (${target})...`);
		run(`npm run version:${target}`);
		return getVersion();
	}

	if (compareVersions(target, currentVersion) <= 0) {
		console.error(`Error: explicit version ${target} must be greater than current version ${currentVersion}.`);
		process.exit(1);
	}

	console.log(`Setting explicit version (${target})...`);
	run(`npm version ${target} -ws --no-git-tag-version && node scripts/sync-versions.js && npm install --package-lock-only --ignore-scripts`);
	return getVersion();
}

function getUtcDate() {
	return new Date().toISOString().slice(0, 10);
}

function getChangelogs() {
	const packagesDir = "packages";
	const packages = readdirSync(packagesDir);
	return packages
		.map((pkg) => join(packagesDir, pkg, "CHANGELOG.md"))
		.filter((path) => existsSync(path));
}

function validateChangelogs() {
	for (const changelog of getChangelogs()) {
		const content = readFileSync(changelog, "utf-8");
		const unreleasedCount = content.match(/^## \[Unreleased\]$/gm)?.length ?? 0;
		if (unreleasedCount !== 1 || !content.startsWith(CHANGELOG_HEADER)) {
			throw new Error(`${changelog}: [Unreleased] must appear exactly once as the first section after # Changelog`);
		}

		const versions = [...content.matchAll(RELEASE_HEADING_RE)].map((match) => match[1]);
		for (let index = 1; index < versions.length; index++) {
			if (compareVersions(versions[index - 1], versions[index]) <= 0) {
				throw new Error(`${changelog}: released versions must be strictly descending (${versions[index - 1]} before ${versions[index]})`);
			}
		}
	}
}

function updateChangelogsForRelease(version) {
	const date = getUtcDate();
	const changelogs = getChangelogs();

	for (const changelog of changelogs) {
		const content = readFileSync(changelog, "utf-8");
		const updated = content.replace(
			CHANGELOG_HEADER,
			`# Changelog\n\n## [${version}] - ${date}\n\n`,
		);
		writeFileSync(changelog, updated);
		console.log(`  Updated ${changelog}`);
	}
}

function addUnreleasedSection() {
	const changelogs = getChangelogs();
	const unreleasedSection = "## [Unreleased]\n\n";

	for (const changelog of changelogs) {
		const content = readFileSync(changelog, "utf-8");

		// Insert after "# Changelog\n\n"
		const updated = content.replace(
			/^(# Changelog\n\n)/,
			`$1${unreleasedSection}`
		);
		writeFileSync(changelog, updated);
		console.log(`  Added [Unreleased] to ${changelog}`);
	}
}

// Main flow
console.log("\n=== Release Script ===\n");

// 1. Check for uncommitted changes
console.log("Checking for uncommitted changes...");
const status = run("git status --porcelain", { silent: true });
if (status && status.trim()) {
	console.error("Error: Uncommitted changes detected. Commit or stash first.");
	console.error(status);
	process.exit(1);
}
console.log("  Working directory clean\n");

// 2. Validate changelogs before mutating versions
console.log("Validating changelogs...");
validateChangelogs();
console.log("  Changelog structure valid\n");

// 3. Bump or set version
const version = bumpOrSetVersion(RELEASE_TARGET);
console.log(`  New version: ${version}\n`);

// 4. Update changelogs
console.log("Updating CHANGELOG.md files...");
updateChangelogsForRelease(version);
console.log();

// 5. Regenerate release artifacts
console.log("Regenerating release artifacts...");
run("npm --prefix packages/ai run generate-models");
run("npm --prefix packages/ai run generate-image-models");
run("npm run shrinkwrap:coding-agent");
console.log();

// 6. Run checks
console.log("Running checks...");
run("npm run check");
console.log();

// 7. Commit and tag
console.log("Committing and tagging...");
stageChangedFiles();
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
console.log();

// 8. Add new [Unreleased] sections
console.log("Adding [Unreleased] sections for next cycle...");
addUnreleasedSection();
console.log();

// 9. Commit
console.log("Committing changelog updates...");
stageChangedFiles();
run(`git commit -m "Add [Unreleased] section for next cycle"`);
console.log();

// 10. Push
console.log("Pushing to remote...");
run("git push origin main");
run(`git push origin v${version}`);
console.log();

console.log(`=== Prepared release v${version}; CI publishing starts after the tag push ===`);
