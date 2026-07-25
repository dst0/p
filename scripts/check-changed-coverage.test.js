import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	LINE_COVERAGE_THRESHOLD,
	evaluateChangedCoverage,
	findReports,
	mergeCoverage,
	parseChangedLines,
	parseLcov,
} from "./check-changed-coverage.js";

test("parses added and replaced line ranges from a zero-context diff", () => {
	const changed = parseChangedLines(
		[
			"diff --git a/packages/demo/src/example.ts b/packages/demo/src/example.ts",
			"--- a/packages/demo/src/example.ts",
			"+++ b/packages/demo/src/example.ts",
			"@@ -2 +2,2 @@",
			"-old",
			"+new",
			"+another",
			"@@ -10,2 +11,0 @@",
			"-removed",
		].join("\n"),
	);

	assert.deepEqual([...changed.get("packages/demo/src/example.ts")], [2, 3]);
});

test("normalizes relative LCOV sources against the package root", () => {
	const coverage = parseLcov(
		["TN:", "SF:src/example.ts", "DA:2,1", "DA:3,0", "end_of_record"].join("\n"),
		"/repo/packages/demo/coverage/lcov.info",
		"/repo",
	);

	assert.deepEqual([...coverage.get("packages/demo/src/example.ts")], [
		[2, 1],
		[3, 0],
	]);
});

test("merges duplicate line records using the highest hit count", () => {
	const target = new Map([["packages/demo/src/example.ts", new Map([[2, 0]])]]);
	const source = new Map([["packages/demo/src/example.ts", new Map([[2, 3]])]]);

	mergeCoverage(target, source);

	assert.equal(target.get("packages/demo/src/example.ts").get(2), 3);
});

test("passes exactly 99 percent changed executable line coverage", () => {
	const changed = new Map([
		["packages/demo/src/example.ts", new Set(Array.from({ length: 100 }, (_, index) => index + 1))],
	]);
	const lineCoverage = new Map(Array.from({ length: 100 }, (_, index) => [index + 1, index === 99 ? 0 : 1]));
	const result = evaluateChangedCoverage(
		changed,
		new Map([["packages/demo/src/example.ts", lineCoverage]]),
		LINE_COVERAGE_THRESHOLD,
	);

	assert.equal(result.percentage, 99);
	assert.equal(result.passed, true);
	assert.deepEqual(result.uncoveredLines, ["packages/demo/src/example.ts:100"]);
});

test("fails below 99 percent and reports uncovered executable lines", () => {
	const changed = new Map([["packages/demo/src/example.ts", new Set([1, 2])]]);
	const coverage = new Map([["packages/demo/src/example.ts", new Map([[1, 1], [2, 0]])]]);

	const result = evaluateChangedCoverage(changed, coverage);

	assert.equal(result.percentage, 50);
	assert.equal(result.passed, false);
	assert.deepEqual(result.uncoveredLines, ["packages/demo/src/example.ts:2"]);
});

test("ignores changed lines that LCOV does not classify as executable", () => {
	const changed = new Map([["packages/demo/src/example.ts", new Set([1, 2, 3])]]);
	const coverage = new Map([["packages/demo/src/example.ts", new Map([[2, 1]])]]);

	const result = evaluateChangedCoverage(changed, coverage);

	assert.equal(result.total, 1);
	assert.equal(result.covered, 1);
	assert.equal(result.passed, true);
});

test("fails when a changed source file has no LCOV record", () => {
	const changed = new Map([["packages/demo/src/missing.ts", new Set([1])]]);

	const result = evaluateChangedCoverage(changed, new Map());

	assert.equal(result.passed, false);
	assert.deepEqual(result.missingFiles, ["packages/demo/src/missing.ts"]);
});

test("does not require coverage for test and non-TypeScript changes", () => {
	const changed = new Map([
		["packages/demo/test/example.test.ts", new Set([1])],
		["packages/demo/src/readme.md", new Set([1])],
		["packages/demo/src/generated.d.ts", new Set([1])],
	]);

	const result = evaluateChangedCoverage(changed, new Map());

	assert.equal(result.total, 0);
	assert.equal(result.passed, true);
});

test("requires an LCOV report from every configured package", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "p-coverage-reports-"));
	try {
		const reportPath = path.join(directory, "packages", "demo", "coverage", "lcov.info");
		mkdirSync(path.dirname(reportPath), { recursive: true });
		writeFileSync(reportPath, "TN:\n");

		assert.deepEqual(findReports(directory, ["demo"]), [reportPath]);
		assert.throws(() => findReports(directory, ["demo", "missing"]), /packages\/missing\/coverage\/lcov\.info/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
