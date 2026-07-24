#!/usr/bin/env node

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codingAgentCli = join(repoRoot, "packages", "coding-agent", "dist", "cli.js");
const defaultModelsFile = join(homedir(), ".p", "agent", "models.json");
const defaultAuthFile = join(homedir(), ".p", "agent", "auth.json");
const defaultOriginalVersion = "0.73.1";
const defaultTimeoutSeconds = 300;
const defaultMaxRuntimeSeconds = 900;

function printHelp() {
	console.log(`Usage:
  npm run benchmark:agents -- --model <provider/id> [options]

Compare this checkout (p) with the upstream p-coding-agent package using
the same model and two deterministic, long-form TypeScript coding fixtures.

Options:
  --model <provider/id>       Model to use for both agents (required)
  --models-file <path>        Custom models.json copied into temporary agent dirs
                              (default: ~/.p/agent/models.json)
  --original-version <ver>    Upstream package version (default: ${defaultOriginalVersion})
  --task <id>                 Run only one fixture (optional)
  --runs <n>                  Complete repetitions (default: 1)
  --timeout-seconds <n>       Per-agent task timeout (default: ${defaultTimeoutSeconds})
  --max-runtime-seconds <n>   Overall deadline (default: ${defaultMaxRuntimeSeconds})
  --output <dir>              Results directory
                              (default: benchmarks/results/<timestamp>)
  --help                      Show this help

Each result directory contains compressed JSONL session recordings, stderr logs, the
final fixture workspaces, results.json, and report.md. No real session files
are created; auth and model configuration are copied only to a temporary
directory and removed when the benchmark exits.
`);
}

function parsePositiveInteger(value, name) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function parseArgs(argv) {
	const options = {
		model: process.env.PI_BENCHMARK_MODEL,
		modelsFile: defaultModelsFile,
		originalVersion: defaultOriginalVersion,
		task: undefined,
		runs: 1,
		timeoutSeconds: defaultTimeoutSeconds,
		maxRuntimeSeconds: defaultMaxRuntimeSeconds,
		output: undefined,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		if (arg === "--model" || arg === "--models-file" || arg === "--original-version" || arg === "--task" || arg === "--output") {
			if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
			const value = argv[++index];
			if (arg === "--model") options.model = value;
			if (arg === "--models-file") options.modelsFile = resolve(value);
			if (arg === "--original-version") options.originalVersion = value;
			if (arg === "--task") options.task = value;
			if (arg === "--output") options.output = resolve(value);
			continue;
		}
		if (arg === "--runs" || arg === "--timeout-seconds" || arg === "--max-runtime-seconds") {
			if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
			const value = parsePositiveInteger(argv[++index], arg);
			if (arg === "--runs") options.runs = value;
			if (arg === "--timeout-seconds") options.timeoutSeconds = value;
			if (arg === "--max-runtime-seconds") options.maxRuntimeSeconds = value;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	if (!options.model && !options.help) throw new Error("--model is required");
	return options;
}

function timestampLabel() {
	return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function ensureDir(path) {
	mkdirSync(path, { recursive: true });
}

function writeFixture(workspace, files) {
	for (const [relativePath, content] of Object.entries(files)) {
		const path = join(workspace, relativePath);
		ensureDir(join(path, ".."));
		writeFileSync(path, content, "utf8");
	}
}

function listFiles(root, current = root) {
	const files = [];
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		const path = join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(root, path));
		} else {
			files.push(path.slice(root.length + 1));
		}
	}
	return files.sort();
}

function readText(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function taskResult(passed, checks) {
	return { passed, checks };
}

const fixturePackageJson = `{
  "name": "typescript-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test test/*.test.ts",
    "typecheck": "tsc --noEmit",
    "calc": "node --import tsx src/cli.ts"
  },
  "devDependencies": {
    "@types/node": "22.19.19",
    "tsx": "4.20.3",
    "typescript": "5.9.3"
  }
}
`;

const fixtureTsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
`;

const calculatorContract = `import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

test("respects operator precedence", () => {
  assert.equal(evaluate("2 + 3 * 4"), 14);
});

test("supports parentheses and decimals", () => {
  assert.equal(evaluate(" 7.5 / 2.5 "), 3);
  assert.equal(evaluate("(2 + 3) * 4"), 20);
});

test("supports unary minus", () => {
  assert.equal(evaluate("-2 * -3 + 1"), 7);
});

test("rejects division by zero", () => {
  assert.throws(() => evaluate("2 / 0"), /division by zero/i);
});

test("rejects incomplete expressions", () => {
  assert.throws(() => evaluate("2 +"), /unexpected|invalid|expression/i);
});
`;

const monolithSource = `export type TaskStatus = "todo" | "doing" | "done";
export type SortKey = "id" | "title" | "estimate";

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  estimate: number;
  tags: string[];
}

export interface TaskSummary {
  total: number;
  completed: number;
  completionRate: number;
  totalEstimate: number;
  byStatus: Record<TaskStatus, number>;
  tagCounts: Record<string, number>;
}

export interface ReportOptions {
  query?: string;
  status?: TaskStatus;
  tag?: string;
  sort?: SortKey;
}

const STATUS_ORDER: readonly TaskStatus[] = ["todo", "doing", "done"];

function requireField(value: string | undefined, field: string): string {
  const result = value?.trim() ?? "";
  if (!result) throw new Error("Missing " + field);
  return result;
}

function parseId(value: string | undefined): number {
  const parsed = Number.parseInt(requireField(value, "id"), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Invalid task id");
  return parsed;
}

function parseStatus(value: string | undefined): TaskStatus {
  const status = requireField(value, "status").toLowerCase();
  if (!STATUS_ORDER.includes(status as TaskStatus)) throw new Error("Invalid task status");
  return status as TaskStatus;
}

function parseEstimate(value: string | undefined): number {
  const estimate = Number(requireField(value, "estimate"));
  if (!Number.isFinite(estimate) || estimate < 0) throw new Error("Invalid estimate");
  return estimate;
}

function parseTags(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function normalizeTitle(value: string | undefined): string {
  return requireField(value, "title").replaceAll(/\\s+/g, " ");
}

export function parseTaskLine(line: string): Task {
  const fields = line.split("|");
  if (fields.length < 5) throw new Error("Invalid task line");
  return {
    id: parseId(fields[0]),
    title: normalizeTitle(fields[1]),
    status: parseStatus(fields[2]),
    estimate: parseEstimate(fields[3]),
    tags: parseTags(fields.slice(4).join("|")),
  };
}

export function parseTaskFile(input: string): Task[] {
  return input
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(parseTaskLine);
}

function cloneTask(task: Task): Task {
  return { ...task, tags: [...task.tags] };
}

function normalizeTask(task: Task): Task {
  return {
    id: task.id,
    title: normalizeTitle(task.title),
    status: parseStatus(task.status),
    estimate: parseEstimate(String(task.estimate)),
    tags: parseTags(task.tags.join(",")),
  };
}

function matchesStatus(task: Task, status: TaskStatus | undefined): boolean {
  return status === undefined || task.status === status;
}

function matchesTag(task: Task, tag: string | undefined): boolean {
  return tag === undefined || task.tags.includes(tag.toLowerCase());
}

function matchesQuery(task: Task, query: string | undefined): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return task.title.toLowerCase().includes(needle) || task.tags.some((tag) => tag.includes(needle));
}

export function filterTasks(tasks: readonly Task[], options: ReportOptions = {}): Task[] {
  return tasks
    .map(normalizeTask)
    .filter((task) => matchesStatus(task, options.status))
    .filter((task) => matchesTag(task, options.tag))
    .filter((task) => matchesQuery(task, options.query))
    .map(cloneTask);
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareTasks(left: Task, right: Task, key: SortKey): number {
  if (key === "title") return compareText(left.title, right.title) || compareNumbers(left.id, right.id);
  if (key === "estimate") return compareNumbers(left.estimate, right.estimate) || compareNumbers(left.id, right.id);
  return compareNumbers(left.id, right.id);
}

export function sortTasks(tasks: readonly Task[], key: SortKey = "id"): Task[] {
  return tasks.map(cloneTask).sort((left, right) => compareTasks(left, right, key));
}

function countStatuses(tasks: readonly Task[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function countTags(tasks: readonly Task[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    for (const tag of task.tags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

function calculateCompletionRate(total: number, completed: number): number {
  return total === 0 ? 0 : Math.round((completed / total) * 100);
}

export function summarizeTasks(tasks: readonly Task[]): TaskSummary {
  const normalized = tasks.map(normalizeTask);
  const byStatus = countStatuses(normalized);
  const completed = byStatus.done;
  return {
    total: normalized.length,
    completed,
    completionRate: calculateCompletionRate(normalized.length, completed),
    totalEstimate: normalized.reduce((total, task) => total + task.estimate, 0),
    byStatus,
    tagCounts: countTags(normalized),
  };
}

function formatPercent(value: number): string {
  return value.toFixed(0) + "%";
}

function formatStatusLine(status: TaskStatus, count: number): string {
  return status.toUpperCase() + ": " + count;
}

function formatTagLine(tag: string, count: number): string {
  return "- " + tag + ": " + count;
}

export function formatSummary(summary: TaskSummary): string {
  const statusLines = STATUS_ORDER.map((status) => formatStatusLine(status, summary.byStatus[status]));
  const tagLines = Object.keys(summary.tagCounts).sort().map((tag) => formatTagLine(tag, summary.tagCounts[tag]));
  return [
    "## Summary",
    "Total tasks: " + summary.total,
    "Completed: " + summary.completed + " (" + formatPercent(summary.completionRate) + ")",
    "Total estimate: " + summary.totalEstimate,
    ...statusLines,
    tagLines.length > 0 ? "Tags:\\n" + tagLines.join("\\n") : "Tags: none",
  ].join("\\n");
}

function formatTask(task: Task): string {
  const tags = task.tags.length > 0 ? " [" + task.tags.join(", ") + "]" : "";
  return "- #" + task.id + " " + task.title + " (" + task.status + ", " + task.estimate + ")" + tags;
}

function formatTaskTable(tasks: readonly Task[]): string {
  if (tasks.length === 0) return "## Tasks\\nNo matching tasks.";
  return "## Tasks\\n" + tasks.map(formatTask).join("\\n");
}

function buildReportTitle(options: ReportOptions): string {
  const scope = options.query ? " for \\\"" + options.query + "\\\"" : "";
  return "# Task report" + scope;
}

function normalizeOptions(options: ReportOptions): ReportOptions {
  return {
    query: options.query?.trim() || undefined,
    status: options.status,
    tag: options.tag?.trim().toLowerCase() || undefined,
    sort: options.sort ?? "id",
  };
}

function checksum(tasks: readonly Task[]): number {
  return tasks.reduce((total, task) => total + task.id * 31 + task.title.length + task.estimate, 0);
}

function buildMetadata(tasks: readonly Task[]): string {
  return "Dataset checksum: " + checksum(tasks);
}

export function serializeTasks(tasks: readonly Task[]): string {
  return JSON.stringify(tasks.map(cloneTask), null, 2) + "\\n";
}

export function renderDashboard(tasks: readonly Task[]): string {
  const ordered = sortTasks(tasks, "title");
  return ["# Task dashboard", buildMetadata(ordered), formatTaskTable(ordered)].join("\\n\\n") + "\\n";
}

export function runReport(input: string, options: ReportOptions = {}): string {
  const normalizedOptions = normalizeOptions(options);
  const parsed = parseTaskFile(input);
  const selected = filterTasks(parsed, normalizedOptions);
  const ordered = sortTasks(selected, normalizedOptions.sort);
  const summary = summarizeTasks(ordered);
  return [buildReportTitle(normalizedOptions), formatSummary(summary), buildMetadata(ordered), formatTaskTable(ordered)].join("\\n\\n") + "\\n";
}

export function groupTasksByStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const groups: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
  for (const task of tasks) groups[task.status].push(cloneTask(task));
  return groups;
}

export function selectLargest(tasks: readonly Task[], limit: number): Task[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Invalid limit");
  return sortTasks(tasks, "estimate").slice(-limit).reverse();
}
`;

const tasks = [
	{
		id: "typescript-calculator",
		timeoutSeconds: 300,
		description: "Build a tested TypeScript calculator library and CLI from a written specification",
		files: {
			"requirements.md": `# TypeScript calculator\n\nBuild a small calculator library and CLI.\n\n- Export evaluate(expression: string): number from src/calculator.ts.\n- Support decimal literals, whitespace, binary +, -, *, /, unary minus, and parentheses.\n- Use normal precedence and left associativity.\n- Throw an Error for malformed expressions and division by zero.\n- Add src/cli.ts. npm run calc -- \"2 + 3 * (4 - 1)\" must print 11. Invalid input must exit nonzero and write a useful message to stderr.\n- Add meaningful tests in test/calculator.test.ts without changing the contract test.\n- Run npm test and npm run typecheck before finishing.\n`,
			"package.json": fixturePackageJson,
			"tsconfig.json": fixtureTsconfig,
			"test/calculator.contract.test.ts": calculatorContract,
		},
		prompt: `Read requirements.md, package.json, tsconfig.json, and the contract test. Implement the complete TypeScript calculator library and CLI, including a real parser with precedence and unary minus, useful error handling, and your own meaningful unit tests in test/calculator.test.ts. Do not modify the contract test or project configuration. Use the existing toolchain; do not install dependencies. Run npm test, npm run typecheck, and npm run calc -- "2 + 3 * (4 - 1)" before finishing.`,
		verify(workspace, baseline) {
			const preservedFiles = ["requirements.md", "package.json", "tsconfig.json", "test/calculator.contract.test.ts"];
			const preserved = preservedFiles.every((file) => readText(join(workspace, file)) === baseline[file]);
			const sourceFiles = ["src/calculator.ts", "src/cli.ts"].every((file) => existsSync(join(workspace, file)));
			const ownTests = existsSync(join(workspace, "test/calculator.test.ts")) && /test\(/.test(readText(join(workspace, "test/calculator.test.ts")) ?? "");
			const tests = runFixtureCommand(workspace, ["test"]);
			const typecheck = runFixtureCommand(workspace, ["run", "typecheck"]);
			const cli = runFixtureCommand(workspace, ["run", "calc", "--", "2 + 3 * (4 - 1)"]);
			const testsPass = tests.status === 0;
			const typecheckPasses = typecheck.status === 0;
			const cliOutput = cli.stdout.trim().split(/\r?\n/).at(-1) ?? "";
			const cliWorks = cli.status === 0 && cliOutput === "11";
			return taskResult(preserved && sourceFiles && ownTests && testsPass && typecheckPasses && cliWorks, [
				{ name: "requirements, config, and contract preserved", passed: preserved },
				{ name: "library and CLI source files exist", passed: sourceFiles },
				{ name: "agent added calculator unit tests", passed: ownTests },
				{ name: "npm test passes", passed: testsPass },
				{ name: "npm run typecheck passes", passed: typecheckPasses },
				{ name: "CLI evaluates the acceptance expression", passed: cliWorks },
			]);
		},
	},
	{
		id: "monolith-split",
		timeoutSeconds: 600,
		description: "Split a large existing TypeScript module into focused files without changing its public behavior",
		files: {
			"README.md": `# Task report repository\n\nThis is an existing TypeScript repository. The public API currently lives in src/monolith.ts, which has grown into a large mixed-responsibility module.\n\nSplit it into focused modules for parsing, querying, and reporting. Keep src/monolith.ts as a compatibility facade so existing consumers do not change their import path. Preserve behavior, exports, and output. Do not change the contract tests. Add tests for the extracted modules and run npm test and npm run typecheck.\n`,
			"package.json": fixturePackageJson,
			"tsconfig.json": fixtureTsconfig,
			"src/monolith.ts": monolithSource,
			"test/monolith.contract.test.ts": `import * as assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { filterTasks, parseTaskFile, runReport, summarizeTasks } from "../src/monolith.ts";\n\nconst input = [\n  "101|Write release notes|todo|2|docs,release",\n  "102|Ship parser refactor|doing|5|code,release",\n  "103|Review dashboard|done|3|docs",\n  "104|Add regression tests|todo|4|code,test",\n].join("\\n");\n\ntest("public parser and query behavior remains stable", () => {\n  const tasks = parseTaskFile(input);\n  assert.equal(tasks.length, 4);\n  assert.deepEqual(filterTasks(tasks, { tag: "release" }).map((task) => task.id), [101, 102]);\n  assert.deepEqual(filterTasks(tasks, { status: "todo" }).map((task) => task.id), [101, 104]);\n});\n\ntest("public summary behavior remains stable", () => {\n  const summary = summarizeTasks(parseTaskFile(input));\n  assert.equal(summary.total, 4);\n  assert.equal(summary.completed, 1);\n  assert.equal(summary.totalEstimate, 14);\n  assert.equal(summary.tagCounts.code, 2);\n});\n\ntest("public report output retains its key sections", () => {\n  const report = runReport(input, { sort: "title" });\n  assert.match(report, /^# Task report/m);\n  assert.match(report, /## Summary/);\n  assert.match(report, /## Tasks/);\n  assert.match(report, /Ship parser refactor/);\n});\n`,
		},
		prompt: `Treat this as an existing TypeScript repository. Read README.md, package.json, tsconfig.json, the large src/monolith.ts, and the contract tests. Split the monolith into focused modules named src/parser.ts, src/query.ts, and src/report.ts (additional shared modules are fine). Keep src/monolith.ts as a small compatibility facade that preserves every public export and the existing import path. Do not modify the contract test or project configuration, do not change behavior, and add tests for the extracted modules. Use the existing toolchain; do not install dependencies. Run npm test and npm run typecheck until both pass.`,
		verify(workspace, baseline) {
			const preservedFiles = ["README.md", "package.json", "tsconfig.json", "src/monolith.ts", "test/monolith.contract.test.ts"];
			const contractPreserved = preservedFiles.filter((file) => file !== "src/monolith.ts").every((file) => readText(join(workspace, file)) === baseline[file]);
			const monolithLines = (readText(join(workspace, "src/monolith.ts")) ?? "").split(/\r?\n/).length;
			const facadeReduced = monolithLines <= 100 && monolithLines < baseline["src/monolith.ts"].split(/\r?\n/).length / 2;
			const focusedModules = ["src/parser.ts", "src/query.ts", "src/report.ts"].every((file) => existsSync(join(workspace, file)));
			const testFiles = listFiles(join(workspace, "test")).filter((file) => file !== "monolith.contract.test.ts");
			const addedTests = testFiles.some((file) => /test\(/.test(readText(join(workspace, "test", file)) ?? ""));
			const tests = runFixtureCommand(workspace, ["test"]);
			const typecheck = runFixtureCommand(workspace, ["run", "typecheck"]);
			const testsPass = tests.status === 0;
			const typecheckPasses = typecheck.status === 0;
			return taskResult(contractPreserved && facadeReduced && focusedModules && addedTests && testsPass && typecheckPasses, [
				{ name: "README, config, and contract preserved", passed: contractPreserved },
				{ name: "monolith reduced to a compatibility facade", passed: facadeReduced },
				{ name: "parser, query, and report modules exist", passed: focusedModules },
				{ name: "agent added extracted-module tests", passed: addedTests },
				{ name: "npm test passes", passed: testsPass },
				{ name: "npm run typecheck passes", passed: typecheckPasses },
			]);
		},
	},
];

function createWorkspace(root, agent, runNumber, task) {
	const workspace = join(root, "workspaces", agent, `run-${runNumber}`, task.id);
	ensureDir(workspace);
	writeFixture(workspace, task.files);
	return workspace;
}

function createBaseline(task) {
	return Object.fromEntries(Object.entries(task.files));
}

function cleanupGeneratedWorkspaceState(workspace) {
	// p persists project memory and state under the workspace. It is useful during
	// a real run but is not part of any fixture's user-visible deliverable.
	rmSync(join(workspace, ".pdev"), { recursive: true, force: true });
}

function fixtureCommandEnv() {
	const separator = process.platform === "win32" ? ";" : ":";
	return {
		...process.env,
		PATH: `${join(repoRoot, "node_modules", ".bin")}${separator}${process.env.PATH ?? ""}`,
		NO_COLOR: "1",
	};
}

function runFixtureCommand(workspace, args) {
	return spawnSync("npm", args, {
		cwd: workspace,
		env: fixtureCommandEnv(),
		encoding: "utf8",
		timeout: 60000,
	});
}

function createAgentDirs(modelsFile) {
	const root = mkdtempSync(join(tmpdir(), "p-agent-benchmark-config-"));
	const dirs = {};
	for (const agent of ["p", "original"]) {
		const dir = join(root, agent);
		ensureDir(dir);
		if (existsSync(modelsFile)) copyFileSync(modelsFile, join(dir, "models.json"));
		if (existsSync(defaultAuthFile)) copyFileSync(defaultAuthFile, join(dir, "auth.json"));
		dirs[agent] = dir;
	}
	return { root, dirs };
}

function commandFor(agent, options, task, configDir, workspace) {
	const commonArgs = [
		"--mode",
		"json",
		"--model",
		options.model,
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-context-files",
		"--no-themes",
		task.prompt,
	];
	const env = { ...process.env };
	env.P_CODING_AGENT_DIR = configDir;
	env.PI_CODING_AGENT_DIR = configDir;
	env.P_SKIP_VERSION_CHECK = "1";
	env.PI_SKIP_VERSION_CHECK = "1";
	env.NO_COLOR = "1";
	const separator = process.platform === "win32" ? ";" : ":";
	env.PATH = `${join(repoRoot, "node_modules", ".bin")}${separator}${env.PATH ?? ""}`;
	if (agent === "p") {
		return { executable: process.execPath, args: [codingAgentCli, ...commonArgs], env, cwd: workspace };
	}
	return {
		executable: "npm",
		args: [
			"exec",
			"--yes",
			`--package=@mariozechner/p-coding-agent@${options.originalVersion}`,
			"--",
			"p",
			...commonArgs,
		],
		env,
		cwd: workspace,
	};
}

function runCommand(command, timeoutMs) {
	return new Promise((resolveResult) => {
		const startedAt = performance.now();
		const child = spawn(command.executable, command.args, {
			cwd: command.cwd,
			env: command.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let killTimer;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
		}, timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const finish = (error, code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			resolveResult({
				stdout,
				stderr,
				code,
				signal,
				error: error ? String(error.message ?? error) : undefined,
				timedOut,
				elapsedMs: performance.now() - startedAt,
			});
		};
		child.once("error", (error) => finish(error, undefined, undefined));
		child.once("close", (code, signal) => finish(undefined, code, signal));
	});
}

function extractText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function parseRecording(stdout) {
	const events = [];
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event && typeof event === "object") events.push(event);
		} catch {
			// Preserve malformed lines in the recording while ignoring them in metrics.
		}
	}

	const counts = {};
	const toolNames = {};
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	const stopReasons = {};
	const assistantTexts = [];
	const finishSummaries = [];
	let assistantMessageCount = 0;
	let model;
	let responseModel;
	let toolErrors = 0;
	for (const event of events) {
		if (typeof event.type === "string") counts[event.type] = (counts[event.type] ?? 0) + 1;
		if (event.type === "request_start" && event.model) model = event.model;
		if (event.message?.responseModel) responseModel = event.message.responseModel;
		if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
			toolNames[event.toolName] = (toolNames[event.toolName] ?? 0) + 1;
			if (event.toolName === "finish_work" && typeof event.args?.summary === "string") finishSummaries.push(event.args.summary);
		}
		if (event.type === "tool_execution_end" && event.isError === true) toolErrors += 1;
		if (event.type === "message_end" && event.message?.role === "assistant") {
			const message = event.message;
			assistantMessageCount += 1;
			assistantTexts.push(extractText(message.content));
			if (message.stopReason) stopReasons[message.stopReason] = (stopReasons[message.stopReason] ?? 0) + 1;
			for (const key of Object.keys(usage)) usage[key] += Number(message.usage?.[key] ?? 0);
		}
	}
	const errors = [];
	for (const event of events) {
		if (event.type === "message_end" && event.message?.stopReason === "error") {
			errors.push(event.message.errorMessage ?? "assistant error");
		}
		if (event.type === "auto_retry_end" && event.success === false) errors.push(event.finalError ?? "retry failed");
	}
	return {
		eventCount: events.length,
		eventTypes: counts,
		model: model ? { provider: model.provider, id: model.id, api: model.api } : undefined,
		responseModel,
		usage,
		turns: counts.turn_end ?? 0,
		assistantMessages: assistantMessageCount,
		toolCalls: counts.tool_execution_start ?? 0,
		toolErrors,
		toolNames,
		stopReasons,
		errors,
		finalText: assistantTexts.at(-1) || finishSummaries.at(-1) || "",
	};
}

function formatMs(value) {
	return `${Math.round(value)} ms`;
}

function formatNumber(value) {
	return Math.round(value).toLocaleString("en-US");
}

function average(rows, selector) {
	if (rows.length === 0) return 0;
	return rows.reduce((total, row) => total + selector(row), 0) / rows.length;
}

function createReport(options, results, output, benchmarkTasks = tasks) {
	const completed = results.filter((result) => result.status !== "skipped");
	const byAgent = (agent) => completed.filter((result) => result.agent === agent);
	const pResults = byAgent("p");
	const originalResults = byAgent("original");
	const summary = (rows) => ({
		runs: rows.length,
		passed: rows.filter((row) => row.quality.passed).length,
		averageWallMs: average(rows, (row) => row.elapsedMs),
		averageInputTokens: average(rows, (row) => row.metrics.usage.input),
		averageOutputTokens: average(rows, (row) => row.metrics.usage.output),
		averageTotalTokens: average(rows, (row) => row.metrics.usage.totalTokens),
		averageToolCalls: average(rows, (row) => row.metrics.toolCalls),
		averageToolErrors: average(rows, (row) => row.metrics.toolErrors),
	});
	const pSummary = summary(pResults);
	const originalSummary = summary(originalResults);
	const winner = (pSummary.passed !== originalSummary.passed)
		? (pSummary.passed > originalSummary.passed ? "p" : "original")
		: pSummary.averageTotalTokens !== originalSummary.averageTotalTokens
			? (pSummary.averageTotalTokens < originalSummary.averageTotalTokens ? "p" : "original")
			: pSummary.averageWallMs <= originalSummary.averageWallMs
				? "p"
				: "original";

	let report = `# Agent benchmark report\n\n`;
	report += `Generated: ${new Date().toISOString()}\n\n`;
	report += `Model: \`${options.model}\`\n\n`;
	report += `Upstream: \`@mariozechner/p-coding-agent@${options.originalVersion}\`\n\n`;
	report += `Runs: ${options.runs} repetition${options.runs === 1 ? "" : "s"} across ${benchmarkTasks.length} fixture${benchmarkTasks.length === 1 ? "" : "s"}; lower time/tokens/tool calls are better.\n\n`;
	report += `## Summary\n\n`;
	report += `| Agent | Passed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
	for (const [agent, data] of [["p", pSummary], ["original", originalSummary]]) {
		report += `| ${agent} | ${data.passed}/${data.runs} | ${formatMs(data.averageWallMs)} | ${formatNumber(data.averageInputTokens)} | ${formatNumber(data.averageOutputTokens)} | ${formatNumber(data.averageTotalTokens)} | ${data.averageToolCalls.toFixed(1)} | ${data.averageToolErrors.toFixed(1)} |\n`;
	}
	report += `\nSimple winner by pass count, then tokens, then time: **${winner}**. This is a directional result, not a general model or agent ranking.\n\n`;
	report += `## Per-task results\n\n`;
	report += `| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |\n| ---: | --- | --- | --- | ---: | ---: | ---: | --- |\n`;
	for (const result of results) {
		const checks = result.status === "skipped" ? "skipped" : `${result.quality.checks.filter((check) => check.passed).length}/${result.quality.checks.length}`;
		report += `| ${result.run} | ${result.agent} | ${result.task} | ${result.status} | ${result.status === "skipped" ? "—" : formatMs(result.elapsedMs)} | ${result.status === "skipped" ? "—" : formatNumber(result.metrics.usage.totalTokens)} | ${result.status === "skipped" ? "—" : result.metrics.toolCalls} | ${checks} |\n`;
	}
	report += `\n## Interpretation\n\n`;
	report += `- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.\n`;
	report += `- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, while the refactor checks its focused modules, added tests, reduced facade, and unchanged contract files.\n`;
	report += `- The run uses one model, one repetition by default, fresh fixture workspaces, and sequential execution. Repeat with \`--runs 2 --max-runtime-seconds 1800\` before treating small differences as meaningful.\n`;
	report += `- Provider latency, model sampling, cache state, and upstream version can dominate this small sample.\n`;
	writeFileSync(join(output, "report.md"), report, "utf8");
	return { p: pSummary, original: originalSummary, winner };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}
	if (!existsSync(codingAgentCli)) {
		throw new Error(`Missing ${codingAgentCli}; build packages/coding-agent before running the benchmark`);
	}
	if (!existsSync(options.modelsFile)) {
		console.warn(`Warning: models file not found at ${options.modelsFile}; built-in provider configuration will be used`);
	}
	const benchmarkTasks = options.task ? tasks.filter((task) => task.id === options.task) : tasks;
	if (benchmarkTasks.length === 0) throw new Error(`Unknown task: ${options.task}`);
	const output = options.output ?? join(repoRoot, "benchmarks", "results", timestampLabel());
	ensureDir(output);
	ensureDir(join(output, "recordings"));
	ensureDir(join(output, "stderr"));
	const agentDirs = createAgentDirs(options.modelsFile);
	const results = [];
	const startedAt = performance.now();
	const deadline = startedAt + options.maxRuntimeSeconds * 1000;
	console.log(`Benchmark output: ${output}`);
	console.log(`Model: ${options.model}`);
	console.log(`Upstream: @mariozechner/p-coding-agent@${options.originalVersion}`);
	try {
		for (let run = 1; run <= options.runs; run += 1) {
			for (let taskIndex = 0; taskIndex < benchmarkTasks.length; taskIndex += 1) {
				const task = benchmarkTasks[taskIndex];
				const agentOrder = (run + taskIndex) % 2 === 1 ? ["p", "original"] : ["original", "p"];
				for (const agent of agentOrder) {
					const remainingMs = deadline - performance.now();
					if (remainingMs <= 0) {
						results.push({ run, agent, task: task.id, status: "skipped" });
						console.log(`[run ${run}] ${agent}/${task.id}: skipped (overall deadline reached)`);
						continue;
					}
					const workspace = createWorkspace(output, agent, run, task);
					const baseline = createBaseline(task);
					const command = commandFor(agent, options, task, agentDirs.dirs[agent], workspace);
					const taskTimeout = task.timeoutSeconds ?? options.timeoutSeconds;
				const result = await runCommand(command, Math.min(taskTimeout * 1000, remainingMs));
					const recordingName = `${agent}-run-${run}-${task.id}.jsonl.gz`;
					const stderrName = `${agent}-run-${run}-${task.id}.log`;
					writeFileSync(join(output, "recordings", recordingName), gzipSync(result.stdout), "utf8");
					writeFileSync(join(output, "stderr", stderrName), result.stderr, "utf8");
					const metrics = parseRecording(result.stdout);
					cleanupGeneratedWorkspaceState(workspace);
					const quality = task.verify(workspace, baseline, metrics.finalText);
					const status = result.timedOut ? "timed_out" : result.code === 0 && metrics.errors.length === 0 && quality.passed ? "passed" : "failed";
					const row = {
						run,
						agent,
						task: task.id,
						description: task.description,
						status,
						elapsedMs: result.elapsedMs,
						exitCode: result.code,
						signal: result.signal,
						timedOut: result.timedOut,
						error: result.error,
						recording: join("recordings", recordingName),
						stderr: join("stderr", stderrName),
						workspace: workspace.slice(output.length + 1),
						metrics,
						quality,
					};
					results.push(row);
					console.log(`[run ${run}] ${agent}/${task.id}: ${status}, ${formatMs(result.elapsedMs)}, ${formatNumber(metrics.usage.totalTokens)} tokens, ${metrics.toolCalls} tool calls`);
				}
			}
		}
	} finally {
		rmSync(agentDirs.root, { recursive: true, force: true });
	}
	const summaries = createReport(options, results, output, benchmarkTasks);
	const resultDocument = {
		generatedAt: new Date().toISOString(),
		model: options.model,
		originalVersion: options.originalVersion,
		runs: options.runs,
		timeoutSeconds: options.timeoutSeconds,
		maxRuntimeSeconds: options.maxRuntimeSeconds,
		tasks: benchmarkTasks.map(({ id, description }) => ({ id, description })),
		summaries,
		results,
	};
	writeFileSync(join(output, "results.json"), `${JSON.stringify(resultDocument, null, 2)}\n`, "utf8");
	console.log(`Report: ${join(output, "report.md")}`);
	if (!results.some((result) => result.status !== "skipped")) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
