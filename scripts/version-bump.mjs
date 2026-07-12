#!/usr/bin/env node

/**
 * Bumps versions across the monorepo without invoking `npm version -ws`,
 * which fails when workspace packages depend on each other via unpublish
 * versions (e.g. @dst0/p-ai@^0.3.0 not yet on npm).
 *
 * Usage: node scripts/version-bump.mjs [patch|minor|major]
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { inc } from 'semver';

const bump = process.argv[2] || 'minor';
const validBumps = ['patch', 'minor', 'major'];
if (!validBumps.includes(bump)) {
	console.error(`Usage: node scripts/version-bump.mjs [${validBumps.join('|')}]`);
	process.exit(1);
}

// Discover all package.json files (core + example extension workspaces)
const packagePaths = [
	'packages/agent/package.json',
	'packages/ai/package.json',
	'packages/coding-agent/package.json',
	'packages/code-index/package.json',
	'packages/tui/package.json',
	'packages/coding-agent/examples/extensions/with-deps/package.json',
	'packages/coding-agent/examples/extensions/custom-provider-anthropic/package.json',
	'packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/package.json',
	'packages/coding-agent/examples/extensions/sandbox/package.json',
];

const packages = {};
const versionMap = {};

for (const relPath of packagePaths) {
	const fullPath = join(process.cwd(), relPath);
	try {
		const pkg = JSON.parse(readFileSync(fullPath, 'utf8'));
		const oldVersion = pkg.version;
		const newVersion = inc(oldVersion, bump);
		pkg.version = newVersion;
		writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
		packages[relPath] = pkg;
		versionMap[pkg.name] = newVersion;
		console.log(`${pkg.name}: ${oldVersion} → ${newVersion}`);
	} catch (e) {
		console.error(`Failed to read ${fullPath}:`, e.message);
	}
}

// Update inter-package dependencies in core packages
const corePackagePaths = [
	'packages/agent/package.json',
	'packages/ai/package.json',
	'packages/coding-agent/package.json',
	'packages/code-index/package.json',
	'packages/tui/package.json',
];

for (const relPath of corePackagePaths) {
	const fullPath = join(process.cwd(), relPath);
	const pkg = JSON.parse(readFileSync(fullPath, 'utf8'));
	let updated = false;

	for (const section of ['dependencies', 'devDependencies']) {
		if (!pkg[section]) continue;
		for (const depName of Object.keys(pkg[section])) {
			if (versionMap[depName]) {
				const newVersion = `^${versionMap[depName]}`;
				if (pkg[section][depName] !== newVersion) {
					console.log(`  ${pkg.name} ${section}: ${depName} → ${newVersion}`);
					pkg[section][depName] = newVersion;
					updated = true;
				}
			}
		}
	}

	if (updated) {
		writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
	}
}

// Update root package-lock.json
const lockfilePath = join(process.cwd(), 'package-lock.json');
const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));

// Update workspace package entries
for (const [name, version] of Object.entries(versionMap)) {
	if (lockfile.packages) {
		for (const [key, entry] of Object.entries(lockfile.packages)) {
			if (entry.name === name && entry.version !== version) {
				entry.version = version;
			}
			// Also update dependency references
			if (entry.dependencies) {
				for (const depName of Object.keys(entry.dependencies)) {
					if (versionMap[depName]) {
						entry.dependencies[depName] = `^${versionMap[depName]}`;
					}
				}
			}
			if (entry.devDependencies) {
				for (const depName of Object.keys(entry.devDependencies)) {
					if (versionMap[depName]) {
						entry.devDependencies[depName] = `^${versionMap[depName]}`;
					}
				}
			}
		}
	}
}

writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n');

console.log(`\n✅ Bumped all packages to ${Object.values(versionMap)[0]}`);
