#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LINE_COVERAGE_THRESHOLD = 99;
export const COVERAGE_PACKAGES = ["agent", "ai", "code-index", "coding-agent", "tui"];

function normalizeRepoPath(filePath) {
	return filePath.split(path.sep).join("/");
}

export function parseChangedLines(diff) {
	const changedLines = new Map();
	let currentFile;

	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const target = line.slice(4);
			currentFile = target === "/dev/null" ? undefined : target.replace(/^b\//, "");
			continue;
		}

		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (!hunk || !currentFile) continue;

		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		let lines = changedLines.get(currentFile);
		if (!lines) {
			lines = new Set();
			changedLines.set(currentFile, lines);
		}
		for (let offset = 0; offset < count; offset++) lines.add(start + offset);
	}

	return changedLines;
}

export function parseLcov(content, reportPath, repoRoot) {
	const packageRoot = path.dirname(path.dirname(reportPath));
	const files = new Map();
	let currentFile;

	for (const line of content.split("\n")) {
		if (line.startsWith("SF:")) {
			const sourcePath = line.slice(3);
			const absolutePath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(packageRoot, sourcePath);
			currentFile = normalizeRepoPath(path.relative(repoRoot, absolutePath));
			if (!files.has(currentFile)) files.set(currentFile, new Map());
			continue;
		}

		if (!line.startsWith("DA:") || !currentFile) continue;
		const [lineNumberText, hitsText] = line.slice(3).split(",");
		const lineNumber = Number(lineNumberText);
		const hits = Number(hitsText);
		const coverage = files.get(currentFile);
		coverage.set(lineNumber, Math.max(coverage.get(lineNumber) ?? 0, hits));
	}

	return files;
}

export function mergeCoverage(target, source) {
	for (const [file, sourceLines] of source) {
		let targetLines = target.get(file);
		if (!targetLines) {
			targetLines = new Map();
			target.set(file, targetLines);
		}
		for (const [line, hits] of sourceLines) {
			targetLines.set(line, Math.max(targetLines.get(line) ?? 0, hits));
		}
	}
	return target;
}

export function evaluateChangedCoverage(changedLines, coverage, threshold = LINE_COVERAGE_THRESHOLD) {
	const missingFiles = [];
	const uncoveredLines = [];
	let total = 0;
	let covered = 0;

	for (const [file, changed] of changedLines) {
		if (
			!file.startsWith("packages/") ||
			!file.includes("/src/") ||
			!file.endsWith(".ts") ||
			file.endsWith(".d.ts")
		) {
			continue;
		}

		const fileCoverage = coverage.get(file);
		if (!fileCoverage) {
			missingFiles.push(file);
			continue;
		}

		for (const line of changed) {
			if (!fileCoverage.has(line)) continue;
			total++;
			if ((fileCoverage.get(line) ?? 0) > 0) covered++;
			else uncoveredLines.push(`${file}:${line}`);
		}
	}

	const percentage = total === 0 ? 100 : (covered / total) * 100;
	return {
		covered,
		total,
		percentage,
		threshold,
		missingFiles,
		uncoveredLines,
		passed: missingFiles.length === 0 && percentage >= threshold,
	};
}

function parseBase(argv) {
	const index = argv.indexOf("--base");
	if (index >= 0) {
		const base = argv[index + 1];
		if (!base) throw new Error("--base requires a commit SHA or ref");
		return base;
	}
	return process.env.COVERAGE_BASE_SHA || "HEAD^";
}

export function findReports(repoRoot, packageNames = COVERAGE_PACKAGES) {
	const reports = packageNames.map((packageName) =>
		path.join(repoRoot, "packages", packageName, "coverage", "lcov.info"),
	);
	const missing = reports.filter((reportPath) => !fs.existsSync(reportPath));
	if (missing.length > 0) {
		throw new Error(
			`Missing LCOV reports:\n${missing.map((reportPath) => `- ${normalizeRepoPath(path.relative(repoRoot, reportPath))}`).join("\n")}`,
		);
	}
	return reports;
}

function formatResult(result, base, reportCount) {
	const percentage = result.percentage.toFixed(2);
	const lines = [
		"## Changed-line coverage",
		"",
		`- Base: \`${base}\``,
		`- LCOV reports: ${reportCount}`,
		`- Executable changed lines: ${result.total}`,
		`- Covered changed lines: ${result.covered}`,
		`- Coverage: ${percentage}% (required: ${result.threshold}%)`,
	];
	if (result.missingFiles.length > 0) {
		lines.push("", "Missing LCOV records:", ...result.missingFiles.map((file) => `- \`${file}\``));
	}
	if (result.uncoveredLines.length > 0) {
		lines.push("", "Uncovered changed lines:", ...result.uncoveredLines.map((line) => `- \`${line}\``));
	}
	return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2)) {
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const base = parseBase(argv);
	const diff = execFileSync("git", ["diff", "--unified=0", "--no-color", `${base}...HEAD`, "--", "packages"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	const changedLines = parseChangedLines(diff);
	const reports = findReports(repoRoot);

	const coverage = new Map();
	for (const reportPath of reports) {
		mergeCoverage(coverage, parseLcov(fs.readFileSync(reportPath, "utf8"), reportPath, repoRoot));
	}

	const result = evaluateChangedCoverage(changedLines, coverage);
	const summary = formatResult(result, base, reports.length);
	process.stdout.write(summary);
	if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
