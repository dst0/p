import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import fg from "fast-glob";
import ignore from "ignore";

import { EXCLUDE_DIRS, EXCLUDE_EXTS, LANG_MAP } from "./config.ts";

/**
 * Load and parse a .gitignore file.
 */
export function loadGitignore(repoPath: string): ignore.Ignore {
	const ig = ignore();
	const gitignorePath = path.join(repoPath, ".gitignore");

	if (fs.existsSync(gitignorePath)) {
		const content = fs.readFileSync(gitignorePath, "utf-8");
		ig.add(content);
	}

	return ig;
}

/**
 * Get git info for a repository.
 */
export function getGitInfo(repoPath: string): { branch: string; commit: string; remote: string } {
	const info = { branch: "", commit: "", remote: "" };

	try {
		info.branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
		info.commit = runGit(["rev-parse", "HEAD"], repoPath);
		info.remote = runGit(["remote", "get-url", "origin"], repoPath);
	} catch {
		// Not a git repo or git unavailable
	}

	return info;
}

function runGit(args: string[], cwd: string): string {
	try {
		return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch {
		return "";
	}
}

/**
 * Find git repositories in a workspace directory.
 */
export function findRepos(workspace: string): string[] {
	const repos: string[] = [];

	try {
		for (const item of fs.readdirSync(workspace, { withFileTypes: true })) {
			if (!item.isDirectory()) continue;

			const itemPath = path.join(workspace, item.name);

			if (fs.existsSync(path.join(itemPath, ".git"))) {
				repos.push(itemPath);
			} else {
				try {
					for (const sub of fs.readdirSync(itemPath, { withFileTypes: true })) {
						if (sub.isDirectory() && fs.existsSync(path.join(itemPath, sub.name, ".git"))) {
							repos.push(path.join(itemPath, sub.name));
						}
					}
				} catch {
					// Permission error, skip
				}
			}
		}
	} catch {
		// Workspace unreadable
	}

	return repos.sort();
}

/**
 * Discover source files in a repository, respecting .gitignore and exclusion rules.
 */
export function discoverFiles(repoPath: string, maxFileSize: number): string[] {
	const gitignore = loadGitignore(repoPath);

	// Build glob patterns: include all files, exclude directories and extensions
	const ignorePatterns: string[] = [];

	// Add excluded directories
	for (const dir of EXCLUDE_DIRS) {
		if (dir.startsWith("*")) {
			ignorePatterns.push(`**/*${dir.slice(1)}/**`);
		} else {
			ignorePatterns.push(`**/${dir}/**`);
		}
	}

	// Add excluded extensions
	for (const ext of EXCLUDE_EXTS) {
		ignorePatterns.push(`**/*${ext}`);
	}

	const files = fg.sync(["**/*"], {
		cwd: repoPath,
		onlyFiles: true,
		ignore: ignorePatterns,
		absolute: true,
		dot: false,
	});

	// Filter by size and readability
	return files.filter((fpath) => {
		try {
			const relativePath = path.relative(repoPath, fpath).split(path.sep).join("/");
			if (gitignore.ignores(relativePath)) return false;
			const stat = fs.statSync(fpath);
			if (stat.size > maxFileSize) return false;
			if (!stat.isFile()) return false;

			// Quick readability check
			const fd = fs.openSync(fpath, "r");
			const buf = Buffer.alloc(1024);
			fs.readSync(fd, buf, 0, 1024, 0);
			fs.closeSync(fd);

			const preview = buf.toString("utf-8").trim();
			return preview.length > 0;
		} catch {
			return false;
		}
	});
}

/**
 * Detect language from file extension.
 */
export function detectLanguage(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	return LANG_MAP[ext] || "text";
}
