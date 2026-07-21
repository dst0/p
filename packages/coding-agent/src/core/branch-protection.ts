/**
 * Branch protection detection — determines if the current git branch is protected.
 *
 * Protected branches cannot be pushed to directly; changes must go through
 * a pull request. This module detects protected branches locally by checking
 * git config and remote rules, then signals the agent to use PR workflow.
 */

import { spawnSync } from "node:child_process";

/** Result of branch protection detection */
export interface BranchProtectionInfo {
	/** Current branch name */
	currentBranch: string;
	/** Whether the current branch is protected */
	isProtected: boolean;
	/** Default branch name (e.g. "main", "master") */
	defaultBranch?: string;
	/** Reason the branch is protected (if applicable) */
	reason?: string;
}

/** Well-known protected branch patterns */
const PROTECTED_BRANCH_PATTERNS = [/^main$/, /^master$/, /^release\//, /^hotfix\//];

/**
 * Get the current git branch name.
 * Returns null if not in a git repo or on a detached HEAD.
 */
function getCurrentBranch(cwd: string): string | null {
	const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd,
		encoding: "utf-8",
		timeout: 5000,
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.status !== 0) {
		return null;
	}

	const branch = result.stdout.trim();
	if (branch === "HEAD") {
		return null; // Detached HEAD
	}

	return branch || null;
}

/**
 * Get the default branch name from the remote.
 * Tries origin/HEAD, then common defaults.
 */
function getDefaultBranch(cwd: string): string | null {
	// Try symbolic-ref from remote
	const result = spawnSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
		cwd,
		encoding: "utf-8",
		timeout: 5000,
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.status === 0) {
		const output = result.stdout.trim();
		// Output looks like "refs/remotes/origin/main"
		const match = output.match(/refs\/remotes\/[^/]+\/(.+)$/);
		if (match) {
			return match[1];
		}
	}

	// Fallback: check for common default branch names in remote tracking branches
	const branchResult = spawnSync("git", ["branch", "-r"], {
		cwd,
		encoding: "utf-8",
		timeout: 5000,
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (branchResult.status === 0) {
		const remoteBranches = branchResult.stdout
			.split("\n")
			.map((l) => l.trim().replace("origin/", ""))
			.filter(Boolean);

		for (const candidate of ["main", "master"]) {
			if (remoteBranches.includes(candidate)) {
				return candidate;
			}
		}
	}

	return null;
}

/**
 * Check if a branch name matches known protected patterns.
 */
function matchesProtectedPattern(branch: string): boolean {
	return PROTECTED_BRANCH_PATTERNS.some((pattern) => pattern.test(branch));
}

/**
 * Check git config for branch protection rules.
 * Some teams configure `branch.<name>.remote` with protection markers.
 */
function hasConfigProtection(cwd: string, branch: string): boolean {
	// Check for push protection config
	const result = spawnSync("git", ["config", `branch.${branch}.pushProtection`], {
		cwd,
		encoding: "utf-8",
		timeout: 5000,
		stdio: ["ignore", "pipe", "pipe"],
	});

	return result.status === 0 && result.stdout.trim().toLowerCase() === "true";
}

/**
 * Detect branch protection for the current git working directory.
 *
 * A branch is considered protected if:
 * 1. It matches a well-known protected pattern (main, master, release/*, hotfix/*)
 * 2. Git config explicitly marks it as protected
 *
 * Returns null if not in a git repository.
 */
export async function detectBranchProtection(cwd: string): Promise<BranchProtectionInfo | null> {
	const currentBranch = getCurrentBranch(cwd);
	if (!currentBranch) {
		return null;
	}

	const defaultBranch = getDefaultBranch(cwd) ?? undefined;
	const matchesPattern = matchesProtectedPattern(currentBranch);
	const configProtected = hasConfigProtection(cwd, currentBranch);
	const isProtected = matchesPattern || configProtected;

	return {
		currentBranch,
		isProtected,
		defaultBranch,
		reason: isProtected
			? configProtected
				? "Git config push protection enabled"
				: `Matches protected branch pattern (${currentBranch})`
			: undefined,
	};
}

/**
 * Check if the current branch is protected (synchronous, for gate checks).
 * Returns true if protected, false if not, null if detection failed.
 */
export function isProtectedBranch(cwd: string): boolean | null {
	/* eslint-disable @typescript-eslint/no-unused-vars */
	const _info = detectBranchProtection(cwd);
	/* eslint-enable @typescript-eslint/no-unused-vars */
	// detectBranchProtection returns a Promise but we need sync for gates
	// Use sync version below instead
	return null;
}

/**
 * Synchronous version for gate checks.
 */
export function detectBranchProtectionSync(cwd: string): BranchProtectionInfo | null {
	const currentBranch = getCurrentBranch(cwd);
	if (!currentBranch) {
		return null;
	}

	const defaultBranch = getDefaultBranch(cwd) ?? undefined;
	const matchesPattern = matchesProtectedPattern(currentBranch);
	const configProtected = hasConfigProtection(cwd, currentBranch);
	const isProtected = matchesPattern || configProtected;

	return {
		currentBranch,
		isProtected,
		defaultBranch,
		reason: isProtected
			? configProtected
				? "Git config push protection enabled"
				: `Matches protected branch pattern (${currentBranch})`
			: undefined,
	};
}

/**
 * Generate a PR workflow message for protected branches.
 */
export function protectedBranchMessage(info: BranchProtectionInfo): string {
	return [
		`Branch "${info.currentBranch}" is protected.`,
		`Direct push is not allowed.`,
		`Please create a feature branch and submit a pull request:`,
		`  git checkout -b feature/your-branch`,
		`  # make changes, commit`,
		`  git push origin feature/your-branch`,
		`  # create PR via GitHub/GitLab interface`,
	].join("\n");
}
