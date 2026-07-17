import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import fg from "fast-glob";
import ignore from "ignore";

import { EXCLUDE_DIRS, EXCLUDE_EXTS, LANG_MAP } from "./config.ts";

export interface DiscoverFilesOptions {
	maxFileSize: number;
	denyGlobs?: string[];
}

const SENSITIVE_DIRECTORY_NAMES = new Set([".ssh", "secrets", "credentials"]);
const SENSITIVE_FILE_NAMES = new Set([
	"id_rsa",
	"id_ed25519",
	"credentials.json",
	"service-account.json",
	".npmrc",
	".pypirc",
	".netrc",
]);

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
	return discoverFilesWithOptions(repoPath, { maxFileSize });
}

/**
 * Discover source files with explicit safety options.
 */
export function discoverFilesWithOptions(repoPath: string, options: DiscoverFilesOptions): string[] {
	const rootPath = path.resolve(repoPath);
	const canonicalRoot = fs.realpathSync(repoPath);
	const gitignore = loadGitignore(repoPath);

	// Build glob patterns: include all files, exclude directories and extensions
	const ignorePatterns: string[] = [];
	ignorePatterns.push(".gitignore");

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
	ignorePatterns.push(...(options.denyGlobs ?? []));

	const files = fg.sync(["**/*"], {
		cwd: rootPath,
		onlyFiles: true,
		ignore: ignorePatterns,
		absolute: true,
		dot: true,
		followSymbolicLinks: false,
	});

	// Filter by size and readability
	return files
		.filter((fpath) => {
			try {
				const fileStat = fs.lstatSync(fpath);
				if (fileStat.isSymbolicLink() || !fileStat.isFile()) return false;
				const canonicalPath = fs.realpathSync(fpath);
				const containmentPath = path.relative(canonicalRoot, canonicalPath);
				if (
					containmentPath === ".." ||
					containmentPath.startsWith(`..${path.sep}`) ||
					path.isAbsolute(containmentPath)
				) {
					return false;
				}
				const relativePath = path.relative(canonicalRoot, canonicalPath).split(path.sep).join("/");
				if (gitignore.ignores(relativePath)) return false;
				if (isSensitivePath(relativePath)) return false;
				if (fileStat.size > options.maxFileSize) return false;

				const fd = fs.openSync(canonicalPath, "r");
				const buf = Buffer.alloc(Math.min(4096, fileStat.size));
				const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
				fs.closeSync(fd);
				const preview = buf.subarray(0, bytesRead);
				if (preview.includes(0)) return false;

				const text = preview.toString("utf-8");
				const replacementCharacters = [...text].filter((character) => character === "�").length;
				return text.trim().length > 0 && replacementCharacters <= Math.max(1, text.length * 0.01);
			} catch {
				return false;
			}
		})
		.sort();
}

function isSensitivePath(relativePath: string): boolean {
	const segments = relativePath.split("/");
	if (segments.some((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment.toLowerCase()))) return true;
	const basename = segments.at(-1)?.toLowerCase() ?? "";
	if (SENSITIVE_FILE_NAMES.has(basename)) return true;
	if (basename.endsWith(".pem") || basename.endsWith(".key")) return true;
	if (basename === ".env") return true;
	if (basename.startsWith(".env.")) {
		return ![".env.example", ".env.sample", ".env.template"].includes(basename);
	}
	return false;
}

/**
 * Detect language from file extension.
 */
export function detectLanguage(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	return LANG_MAP[ext] || "text";
}
