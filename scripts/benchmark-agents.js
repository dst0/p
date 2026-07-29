#!/usr/bin/env node

import {
	copyFileSync,
	createWriteStream,
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
import { createGzip } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codingAgentCli = join(repoRoot, "packages", "coding-agent", "dist", "cli.js");
const codingAgentPackage = join(repoRoot, "packages", "coding-agent", "package.json");
const defaultModelsFile = join(homedir(), ".p", "agent", "models.json");
const defaultAuthFile = join(homedir(), ".p", "agent", "auth.json");
const defaultKiloConfigFile = join(homedir(), ".config", "kilo", "kilo.jsonc");
const defaultPiVersion = "0.82.1";
const defaultKiloVersion = "7.4.16";
const supportedAgents = ["pi", "p", "kilo"];
const defaultTimeoutSeconds = 300;
const defaultMaxRuntimeSeconds = 900;

function printHelp() {
	console.log(`Usage:
  npm run benchmark:agents -- --model <provider/id> [options]

Compare this checkout (p) with PI and optionally Kilo Code CLI using the same
underlying model and three deterministic TypeScript coding fixtures, including
a 30-minute transactional event-sourcing challenge.

Options:
  --model <provider/id>       PI/P model alias (required when either is selected)
  --agents <list>             Comma-separated sequential order
                              (default: pi,p; supported: ${supportedAgents.join(",")})
  --models-file <path>        Custom models.json copied into temporary agent dirs
                              (default: ~/.p/agent/models.json)
  --pi-version <ver>          PI package version (default: ${defaultPiVersion})
  --kilo-model <provider/id>  Kilo model alias (required when Kilo is selected)
  --kilo-version <ver>        Required installed Kilo version
                              (default: ${defaultKiloVersion})
  --kilo-config <path>        Kilo config copied into an isolated temporary XDG home
                              (default: ~/.config/kilo/kilo.jsonc)
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
		agents: ["pi", "p"],
		modelsFile: defaultModelsFile,
		piVersion: defaultPiVersion,
		kiloModel: process.env.KILO_BENCHMARK_MODEL,
		kiloVersion: defaultKiloVersion,
		kiloConfig: defaultKiloConfigFile,
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
		if (
			arg === "--model"
			|| arg === "--agents"
			|| arg === "--models-file"
			|| arg === "--pi-version"
			|| arg === "--kilo-model"
			|| arg === "--kilo-version"
			|| arg === "--kilo-config"
			|| arg === "--task"
			|| arg === "--output"
		) {
			if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
			const value = argv[++index];
			if (arg === "--model") options.model = value;
			if (arg === "--agents") options.agents = value.split(",").map((agent) => agent.trim()).filter(Boolean);
			if (arg === "--models-file") options.modelsFile = resolve(value);
			if (arg === "--pi-version") options.piVersion = value;
			if (arg === "--kilo-model") options.kiloModel = value;
			if (arg === "--kilo-version") options.kiloVersion = value;
			if (arg === "--kilo-config") options.kiloConfig = resolve(value);
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

	if (options.help) return options;
	if (options.agents.length === 0) throw new Error("--agents must include at least one agent");
	if (new Set(options.agents).size !== options.agents.length) throw new Error("--agents must not contain duplicates");
	for (const agent of options.agents) {
		if (!supportedAgents.includes(agent)) throw new Error(`Unsupported agent: ${agent}`);
	}
	if (options.agents.some((agent) => agent === "pi" || agent === "p") && !options.model) {
		throw new Error("--model is required when PI or P is selected");
	}
	if (options.agents.includes("kilo") && !options.kiloModel) {
		throw new Error("--kilo-model is required when Kilo is selected");
	}
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

const inventoryContract = `import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConcurrencyError, InventoryEngine, ValidationError } from "../src/index.ts";

test("executes the basic inventory lifecycle", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "BOOK" }, { commandId: "create", expectedVersion: 0 });
  engine.execute({ type: "receive", sku: "BOOK", quantity: 10 }, { commandId: "receive", expectedVersion: 1 });
  engine.execute({ type: "reserve", sku: "BOOK", orderId: "order-1", quantity: 4 }, { commandId: "reserve", expectedVersion: 2 });
  engine.execute({ type: "ship", sku: "BOOK", orderId: "order-1", quantity: 3 }, { commandId: "ship", expectedVersion: 3 });

  assert.deepEqual(engine.state("BOOK"), {
    sku: "BOOK",
    onHand: 7,
    reserved: 1,
    available: 6,
    reservations: { "order-1": 1 },
    version: 4,
  });
});

test("enforces optimistic concurrency and inventory invariants", () => {
  const engine = new InventoryEngine();
  engine.execute({ type: "create-sku", sku: "CHAIR" }, { commandId: "create", expectedVersion: 0 });
  assert.throws(
    () => engine.execute({ type: "receive", sku: "CHAIR", quantity: 2 }, { commandId: "stale", expectedVersion: 0 }),
    ConcurrencyError,
  );
  assert.throws(
    () => engine.execute({ type: "reserve", sku: "CHAIR", orderId: "order-2", quantity: 1 }, { commandId: "reserve", expectedVersion: 1 }),
    ValidationError,
  );
});

test("replays an exported log", () => {
  const original = new InventoryEngine();
  original.execute({ type: "create-sku", sku: "LAMP" }, { commandId: "create", expectedVersion: 0 });
  original.execute({ type: "receive", sku: "LAMP", quantity: 5 }, { commandId: "receive", expectedVersion: 1 });

  const restored = InventoryEngine.fromLog(original.exportLog());
  assert.deepEqual(restored.state("LAMP"), original.state("LAMP"));
  assert.deepEqual(restored.history("LAMP"), original.history("LAMP"));
});
`;

const inventoryHiddenVerification = `import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ConcurrencyError, InventoryEngine, ValidationError } from "../src/index.ts";

function execute(engine, command, commandId, expectedVersion) {
  return engine.execute(command, { commandId, expectedVersion });
}

test("idempotency is exact and conflicting command reuse is rejected", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "same", 0);
  const first = execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  const before = engine.exportLog();
  const retried = execute(engine, { type: "receive", sku: "A", quantity: 8 }, "receive", 1);
  assert.deepEqual(retried, first);
  assert.equal(engine.exportLog(), before);
  assert.equal(engine.state("A").version, 2);
  assert.throws(
    () => execute(engine, { type: "receive", sku: "A", quantity: 9 }, "receive", 2),
    ValidationError,
  );
  assert.throws(
    () => execute(engine, { type: "receive", sku: "A", quantity: 8 }, "same", 2),
    ValidationError,
  );
});

test("batch execution commits all commands or rolls back every observable effect", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create-a", 0);
  execute(engine, { type: "create-sku", sku: "B" }, "create-b", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 10 }, "receive-a", 1);
  execute(engine, { type: "receive", sku: "B", quantity: 3 }, "receive-b", 1);
  const beforeStateA = engine.state("A");
  const beforeStateB = engine.state("B");
  const beforeLog = engine.exportLog();

  assert.throws(
    () => engine.executeBatch([
      {
        command: { type: "reserve", sku: "A", orderId: "batch-order", quantity: 4 },
        commandId: "batch-a",
        expectedVersion: 2,
      },
      {
        command: { type: "reserve", sku: "B", orderId: "batch-order", quantity: 4 },
        commandId: "batch-b",
        expectedVersion: 2,
      },
    ]),
    ValidationError,
  );
  assert.deepEqual(engine.state("A"), beforeStateA);
  assert.deepEqual(engine.state("B"), beforeStateB);
  assert.equal(engine.exportLog(), beforeLog);

  const results = engine.executeBatch([
    {
      command: { type: "reserve", sku: "A", orderId: "batch-order", quantity: 4 },
      commandId: "batch-a",
      expectedVersion: 2,
    },
    {
      command: { type: "reserve", sku: "B", orderId: "batch-order", quantity: 2 },
      commandId: "batch-b",
      expectedVersion: 2,
    },
  ]);
  assert.equal(results.length, 2);
  assert.equal(engine.state("A").available, 6);
  assert.equal(engine.state("B").available, 1);
});

test("release and ship validate reservations without overselling", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 10 }, "receive", 1);
  execute(engine, { type: "reserve", sku: "A", orderId: "one", quantity: 6 }, "reserve-one", 2);
  execute(engine, { type: "reserve", sku: "A", orderId: "two", quantity: 4 }, "reserve-two", 3);
  assert.throws(
    () => execute(engine, { type: "reserve", sku: "A", orderId: "three", quantity: 1 }, "oversell", 4),
    ValidationError,
  );
  assert.throws(
    () => execute(engine, { type: "release", sku: "A", orderId: "one", quantity: 7 }, "over-release", 4),
    ValidationError,
  );
  assert.throws(
    () => execute(engine, { type: "ship", sku: "A", orderId: "two", quantity: 5 }, "over-ship", 4),
    ValidationError,
  );
  execute(engine, { type: "release", sku: "A", orderId: "one", quantity: 2 }, "release", 4);
  execute(engine, { type: "ship", sku: "A", orderId: "two", quantity: 3 }, "ship", 5);
  assert.deepEqual(engine.state("A"), {
    sku: "A",
    onHand: 7,
    reserved: 5,
    available: 2,
    reservations: { one: 4, two: 1 },
    version: 6,
  });
});

test("reads are deeply isolated and histories have contiguous versions and positions", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create-a", 0);
  execute(engine, { type: "create-sku", sku: "B" }, "create-b", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 3 }, "receive-a", 1);
  execute(engine, { type: "reserve", sku: "A", orderId: "one", quantity: 1 }, "reserve-a", 2);
  const state = engine.state("A");
  state.reservations.one = 99;
  assert.equal(engine.state("A").reservations.one, 1);
  const history = engine.history("A");
  history[0].sku = "MUTATED";
  assert.equal(engine.history("A")[0].sku, "A");
  assert.deepEqual(engine.history("A").map((event) => event.version), [1, 2, 3]);
  assert.deepEqual(engine.history("A").map((event) => event.position), [1, 3, 4]);
  assert.deepEqual(engine.history("B").map((event) => event.position), [2]);
});

test("hash-chained JSONL is deterministic, tamper evident, and resumable", () => {
  const engine = new InventoryEngine();
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  execute(engine, { type: "receive", sku: "A", quantity: 7 }, "receive", 1);
  execute(engine, { type: "reserve", sku: "A", orderId: "one", quantity: 2 }, "reserve", 2);
  const exported = engine.exportLog();
  assert.equal(exported, engine.exportLog());
  assert.ok(exported.endsWith("\\n"));
  const lines = exported.trimEnd().split("\\n").map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).type, "manifest");
  assert.equal(lines.at(-1).eventCount, 3);
  assert.match(lines.at(-1).headHash, /^[a-f0-9]{64}$/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    assert.match(lines[index].hash, /^[a-f0-9]{64}$/);
    assert.equal(lines[index].previousHash, index === 0 ? null : lines[index - 1].hash);
  }

  const restored = InventoryEngine.fromLog(exported);
  assert.equal(restored.exportLog(), exported);
  execute(restored, { type: "receive", sku: "A", quantity: 1 }, "after-restore", 3);
  const resumedLines = restored.exportLog().trimEnd().split("\\n").map((line) => JSON.parse(line));
  assert.equal(resumedLines.at(-1).eventCount, 4);
  assert.equal(resumedLines.at(-2).position, 4);
  assert.equal(resumedLines.at(-2).previousHash, lines.at(-2).hash);

  const tampered = exported.replace('"quantity":7', '"quantity":70');
  assert.notEqual(tampered, exported);
  assert.throws(() => InventoryEngine.fromLog(tampered), ValidationError);
  assert.throws(() => InventoryEngine.fromLog(exported.replace(/.$/, "")), ValidationError);
  assert.throws(() => InventoryEngine.fromLog(exported + "{}\\n"), ValidationError);

  const digest = createHash("sha256").update(exported).digest("hex");
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test("invalid input and stale batches do not consume positions or command IDs", () => {
  const engine = new InventoryEngine();
  assert.throws(
    () => execute(engine, { type: "create-sku", sku: "  " }, "invalid", 0),
    ValidationError,
  );
  execute(engine, { type: "create-sku", sku: "A" }, "create", 0);
  assert.throws(
    () => engine.executeBatch([
      {
        command: { type: "receive", sku: "A", quantity: 2 },
        commandId: "batch-good",
        expectedVersion: 1,
      },
      {
        command: { type: "receive", sku: "A", quantity: 3 },
        commandId: "batch-stale",
        expectedVersion: 1,
      },
    ]),
    ConcurrencyError,
  );
  assert.equal(engine.history("A").length, 1);
  execute(engine, { type: "receive", sku: "A", quantity: 2 }, "batch-good", 1);
  assert.equal(engine.history("A").at(-1).position, 2);
});
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
	{
		id: "event-sourced-inventory",
		timeoutSeconds: 1800,
		description: "Build a transactional event-sourced inventory engine with concurrency, idempotency, replay, and tamper detection",
		files: {
			"README.md": `# Event-sourced inventory engine

Build a production-quality in-memory TypeScript inventory engine. The public API and required behavior are below.

## Public API

Export these from \`src/index.ts\`:

- \`InventoryEngine\`
- \`ConcurrencyError extends Error\`
- \`ValidationError extends Error\`
- all public command, state, event, result, and option types

\`InventoryEngine\` must provide:

- \`execute(command, { commandId, expectedVersion })\`
- \`executeBatch(items)\`, where each item contains \`command\`, \`commandId\`, and \`expectedVersion\`
- \`state(sku)\`
- \`history(sku)\`
- \`exportLog()\`
- \`static fromLog(log)\`

Commands are discriminated unions:

- \`{ type: "create-sku", sku }\`
- \`{ type: "receive", sku, quantity }\`
- \`{ type: "reserve", sku, orderId, quantity }\`
- \`{ type: "release", sku, orderId, quantity }\`
- \`{ type: "ship", sku, orderId, quantity }\`

State has exactly \`sku\`, \`onHand\`, \`reserved\`, \`available\`, \`reservations\`, and \`version\`. A new SKU starts at version 1. Every successful command emits one event and increments that SKU's version. Events have a global one-based \`position\`, per-SKU \`version\`, \`commandId\`, \`type\`, \`sku\`, command-specific data, \`previousHash\`, and \`hash\`.

## Required semantics

- Quantities must be positive integers. SKU, order ID, and command ID must be non-empty after trimming.
- A command's \`expectedVersion\` must equal the current SKU version; creating a SKU expects version 0. Stale commands throw \`ConcurrencyError\`.
- Receiving increases \`onHand\`. Reserving cannot exceed \`available\`. Releasing and shipping cannot exceed that order's reservation. Shipping reduces both \`onHand\` and the reservation.
- Retrying the exact same command with the same command ID and options returns the original result without appending an event. Reusing a command ID for anything different throws \`ValidationError\`.
- A batch is atomic across all SKUs: either all commands and idempotency records commit in order, or no observable state changes. Within a batch, each expected version is checked against effects of earlier items.
- Returned state, results, and history must be deep copies; callers cannot mutate engine state.
- \`exportLog()\` returns deterministic newline-terminated JSONL: one line per event followed by a manifest line with \`type: "manifest"\`, \`eventCount\`, and \`headHash\`. Event hashes are lowercase SHA-256 hashes over a documented canonical representation that includes the preceding hash. The first \`previousHash\` is \`null\`.
- \`fromLog()\` validates structure, positions, stream versions, invariants, every hash link, the manifest, and command-ID consistency before restoring. Any truncation, extra data, malformed JSON, impossible transition, or tampering throws \`ValidationError\`. A restored engine must export byte-for-byte identical JSONL and continue positions and hash links correctly.

Keep storage/event-log concerns in \`src/store.ts\`, domain behavior in \`src/engine.ts\`, and the public facade in \`src/index.ts\`. You may add focused modules. Add substantial tests beyond the contract test. Do not change the README, project configuration, or contract test. Use only Node built-ins and the existing toolchain; do not install dependencies. Run \`npm test\` and \`npm run typecheck\` before finishing.
`,
			"package.json": fixturePackageJson,
			"tsconfig.json": fixtureTsconfig,
			"test/inventory.contract.test.ts": inventoryContract,
		},
		prompt: `Implement the complete production-quality event-sourced inventory engine described in README.md. Read every provided file first. Preserve README.md, package.json, tsconfig.json, and the contract test exactly. Keep event-log storage in src/store.ts, domain behavior in src/engine.ts, and exports in src/index.ts; additional focused modules are allowed. Pay particular attention to exact idempotency, atomic multi-SKU rollback, optimistic concurrency within batches, deep immutability, deterministic hash-chained JSONL, rigorous replay validation, and continuation after restore. Add substantial meaningful tests of your own. Use only Node built-ins and the existing toolchain; do not install dependencies. Run npm test and npm run typecheck until both pass.`,
		verify(workspace, baseline) {
			const preservedFiles = ["README.md", "package.json", "tsconfig.json", "test/inventory.contract.test.ts"];
			const preserved = preservedFiles.every((file) => readText(join(workspace, file)) === baseline[file]);
			const sourceFiles = ["src/index.ts", "src/engine.ts", "src/store.ts"].every((file) => existsSync(join(workspace, file)));
			const testFiles = listFiles(join(workspace, "test")).filter((file) => file !== "inventory.contract.test.ts");
			const addedTests = testFiles.some((file) => /test\(/.test(readText(join(workspace, "test", file)) ?? ""));
			const visibleTests = runFixtureCommand(workspace, ["test"]);
			const typecheck = runFixtureCommand(workspace, ["run", "typecheck"]);
			const hiddenTestPath = join(workspace, "test", "inventory.hidden.test.ts");
			let hiddenTests;
			try {
				writeFileSync(hiddenTestPath, inventoryHiddenVerification, "utf8");
				hiddenTests = runFixtureCommand(workspace, ["test"]);
			} finally {
				rmSync(hiddenTestPath, { force: true });
			}
			const testsPass = visibleTests.status === 0;
			const typecheckPasses = typecheck.status === 0;
			const hiddenTestsPass = hiddenTests.status === 0;
			return taskResult(preserved && sourceFiles && addedTests && testsPass && typecheckPasses && hiddenTestsPass, [
				{ name: "README, config, and contract preserved", passed: preserved },
				{ name: "index, engine, and store modules exist", passed: sourceFiles },
				{ name: "agent added substantial inventory tests", passed: addedTests },
				{ name: "visible npm test passes", passed: testsPass },
				{ name: "npm run typecheck passes", passed: typecheckPasses },
				{ name: "hidden transactional, replay, and tamper checks pass", passed: hiddenTestsPass },
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

function createAgentDirs(options) {
	const root = mkdtempSync(join(tmpdir(), "p-agent-benchmark-config-"));
	const dirs = {};
	for (const agent of ["pi", "p"]) {
		const dir = join(root, agent);
		ensureDir(dir);
		if (existsSync(options.modelsFile)) copyFileSync(options.modelsFile, join(dir, "models.json"));
		if (existsSync(defaultAuthFile)) copyFileSync(defaultAuthFile, join(dir, "auth.json"));
		dirs[agent] = dir;
	}
	const kiloDir = join(root, "kilo");
	const kiloConfigDir = join(kiloDir, "config", "kilo");
	ensureDir(kiloConfigDir);
	if (existsSync(options.kiloConfig)) copyFileSync(options.kiloConfig, join(kiloConfigDir, "kilo.jsonc"));
	dirs.kilo = kiloDir;
	return { root, dirs };
}

function commandFor(agent, options, task, configDir, workspace) {
	if (agent === "kilo") {
		const env = {
			...process.env,
			NO_COLOR: "1",
			XDG_CACHE_HOME: join(configDir, "cache"),
			XDG_CONFIG_HOME: join(configDir, "config"),
			XDG_DATA_HOME: join(configDir, "data"),
			XDG_STATE_HOME: join(configDir, "state"),
		};
		return {
			executable: "kilo",
			args: [
				"run",
				"--model",
				options.kiloModel,
				"--format",
				"json",
				"--pure",
				"--auto",
				"--dir",
				workspace,
				task.prompt,
			],
			env,
			cwd: workspace,
		};
	}
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
			`--package=@earendil-works/pi-coding-agent@${options.piVersion}`,
			"--",
			"pi",
			...commonArgs,
		],
		env,
		cwd: workspace,
	};
}

const metricEventTypes = new Set([
	"auto_retry_end",
	"error",
	"message_end",
	"request_start",
	"step_finish",
	"text",
	"tool_execution_end",
	"tool_execution_start",
	"tool_use",
	"turn_end",
]);

function runCommand(command, timeoutMs, recordingPath) {
	return new Promise((resolveResult) => {
		const startedAt = performance.now();
		const recording = createWriteStream(recordingPath);
		const compressor = createGzip();
		compressor.pipe(recording);
		const child = spawn(command.executable, command.args, {
			cwd: command.cwd,
			env: command.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stdoutBuffer = "";
		let stderr = "";
		let rawEventCount = 0;
		let timedOut = false;
		let settled = false;
		let childResult;
		let killTimer;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
		}, timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			compressor.write(chunk);
			stdoutBuffer += chunk;
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				rawEventCount += 1;
				try {
					const event = JSON.parse(line);
					if (metricEventTypes.has(event?.type)) stdout += `${line}\n`;
				} catch {
					// The complete malformed line remains available in the raw recording.
				}
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const resolveWhenRecorded = () => {
			if (settled) return;
			if (!childResult) return;
			settled = true;
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			resolveResult({
				stdout,
				stderr,
				code: childResult.code,
				signal: childResult.signal,
				error: childResult.error,
				timedOut,
				rawEventCount,
				elapsedMs: performance.now() - startedAt,
			});
		};
		recording.once("finish", resolveWhenRecorded);
		recording.once("error", (error) => {
			childResult ??= { code: undefined, signal: undefined, error: String(error.message ?? error) };
			resolveWhenRecorded();
		});
		child.once("error", (error) => {
			childResult = { code: undefined, signal: undefined, error: String(error.message ?? error) };
			compressor.end();
		});
		child.once("close", (code, signal) => {
			if (stdoutBuffer.trim()) {
				rawEventCount += 1;
				try {
					const event = JSON.parse(stdoutBuffer);
					if (metricEventTypes.has(event?.type)) stdout += `${stdoutBuffer}\n`;
				} catch {
					// The complete malformed line remains available in the raw recording.
				}
			}
			childResult = { code, signal, error: undefined };
			compressor.end();
		});
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

function parseRecording(stdout, agent) {
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
	return agent === "kilo" ? parseKiloRecording(events) : parsePiRecording(events);
}

function parsePiRecording(events) {
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

function parseKiloRecording(rawEvents) {
	const events = [];
	const seenEvents = new Set();
	for (const event of rawEvents) {
		const part = event.part;
		const key = part?.id
			? `${event.type}:${part.id}:${part.state?.status ?? ""}`
			: JSON.stringify(event);
		if (seenEvents.has(key)) continue;
		seenEvents.add(key);
		events.push(event);
	}

	const counts = {};
	const toolNames = {};
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	const stopReasons = {};
	const assistantTexts = [];
	const errors = [];
	const seenToolIds = new Set();
	let toolErrors = 0;
	for (const event of events) {
		if (typeof event.type === "string") counts[event.type] = (counts[event.type] ?? 0) + 1;
		const part = event.part;
		if (event.type === "tool_use" && part?.type === "tool" && !seenToolIds.has(part.id)) {
			seenToolIds.add(part.id);
			const toolName = typeof part.tool === "string" ? part.tool : "unknown";
			toolNames[toolName] = (toolNames[toolName] ?? 0) + 1;
			if (part.state?.status === "error") toolErrors += 1;
		}
		if (event.type === "step_finish" && part?.type === "step-finish") {
			const tokens = part.tokens;
			usage.input += Number(tokens?.input ?? 0);
			usage.output += Number(tokens?.output ?? 0);
			usage.cacheRead += Number(tokens?.cache?.read ?? 0);
			usage.cacheWrite += Number(tokens?.cache?.write ?? 0);
			usage.totalTokens += Number(tokens?.total ?? 0);
			if (part.reason) stopReasons[part.reason] = (stopReasons[part.reason] ?? 0) + 1;
			if (part.reason === "error") errors.push("Kilo step failed");
		}
		if (event.type === "text" && typeof part?.text === "string") assistantTexts.push(part.text);
		if (event.type === "error") errors.push(String(event.error?.message ?? event.message ?? "Kilo error"));
	}
	return {
		eventCount: events.length,
		rawEventCount: rawEvents.length,
		eventTypes: counts,
		model: undefined,
		responseModel: undefined,
		usage,
		turns: counts.step_finish ?? 0,
		assistantMessages: counts.step_finish ?? 0,
		toolCalls: seenToolIds.size,
		toolErrors,
		toolNames,
		stopReasons,
		errors,
		finalText: assistantTexts.at(-1) ?? "",
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

function createReport(options, versions, results, output, benchmarkTasks = tasks) {
	const completed = results.filter((result) => result.status !== "skipped");
	const byAgent = (agent) => completed.filter((result) => result.agent === agent);
	const summary = (rows) => ({
		runs: rows.length,
		passed: rows.filter((row) => row.status === "passed").length,
		qualityPassed: rows.filter((row) => row.quality.passed).length,
		timedOut: rows.filter((row) => row.status === "timed_out").length,
		failed: rows.filter((row) => row.status === "failed").length,
		averageWallMs: average(rows, (row) => row.elapsedMs),
		averageInputTokens: average(rows, (row) => row.metrics.usage.input),
		averageOutputTokens: average(rows, (row) => row.metrics.usage.output),
		averageTotalTokens: average(rows, (row) => row.metrics.usage.totalTokens),
		averageToolCalls: average(rows, (row) => row.metrics.toolCalls),
		averageToolErrors: average(rows, (row) => row.metrics.toolErrors),
	});
	const summaries = Object.fromEntries(options.agents.map((agent) => [agent, summary(byAgent(agent))]));
	const rankedAgents = options.agents
		.filter((agent) => summaries[agent].runs > 0)
		.toSorted((leftAgent, rightAgent) => {
			const left = summaries[leftAgent];
			const right = summaries[rightAgent];
			return right.passed - left.passed
				|| right.qualityPassed - left.qualityPassed
				|| left.averageTotalTokens - right.averageTotalTokens
				|| left.averageWallMs - right.averageWallMs;
		});
	const winner = rankedAgents[0];

	let report = `# Agent benchmark report\n\n`;
	report += `Generated: ${new Date().toISOString()}\n\n`;
	report += `PI/P model alias: \`${options.model ?? "not selected"}\`\n\n`;
	if (options.agents.includes("kilo")) report += `Kilo model alias: \`${options.kiloModel}\`\n\n`;
	report += `Versions: ${options.agents.map((agent) => `\`${agent} ${versions[agent]}\``).join(", ")}\n\n`;
	report += `Sequential agent order: ${options.agents.map((agent) => `\`${agent}\``).join(" → ")}\n\n`;
	report += `Runs: ${options.runs} repetition${options.runs === 1 ? "" : "s"} across ${benchmarkTasks.length} fixture${benchmarkTasks.length === 1 ? "" : "s"}; lower time/tokens/tool calls are better.\n\n`;
	report += `## Summary\n\n`;
	report += `| Agent | Completed passes | Quality passes | Timed out | Failed | Avg wall time | Avg input tokens | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
	for (const agent of options.agents) {
		const data = summaries[agent];
		report += `| ${agent} | ${data.passed}/${data.runs} | ${data.qualityPassed}/${data.runs} | ${data.timedOut} | ${data.failed} | ${formatMs(data.averageWallMs)} | ${formatNumber(data.averageInputTokens)} | ${formatNumber(data.averageOutputTokens)} | ${formatNumber(data.averageTotalTokens)} | ${data.averageToolCalls.toFixed(1)} | ${data.averageToolErrors.toFixed(1)} |\n`;
	}
	report += `\nSimple winner by completed pass count, then quality pass count, tokens, and time: **${winner ?? "none"}**. This is a directional result, not a general model or agent ranking.\n\n`;
	report += `## Per-task results\n\n`;
	report += `| Run | Agent | Task | Status | Wall time | Total tokens | Tool calls | Checks |\n| ---: | --- | --- | --- | ---: | ---: | ---: | --- |\n`;
	for (const result of results) {
		const checks = result.status === "skipped" ? "skipped" : `${result.quality.checks.filter((check) => check.passed).length}/${result.quality.checks.length}`;
		report += `| ${result.run} | ${result.agent} | ${result.task} | ${result.status} | ${result.status === "skipped" ? "—" : formatMs(result.elapsedMs)} | ${result.status === "skipped" ? "—" : formatNumber(result.metrics.usage.totalTokens)} | ${result.status === "skipped" ? "—" : result.metrics.toolCalls} | ${checks} |\n`;
	}
	report += `\n## Interpretation\n\n`;
	report += `- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.\n`;
	report += `- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.\n`;
	report += `- Fixture checks run the TypeScript test suite and typecheck; the calculator also has a CLI acceptance check, the refactor checks its focused modules and reduced facade, and the inventory challenge adds hidden checks for idempotency, atomic rollback, immutability, replay, and hash-chain tamper detection.\n`;
	report += `- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with \`--runs 2\` and a sufficient overall deadline before treating small differences as meaningful.\n`;
	if (options.agents.includes("kilo")) {
		report += `- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.\n`;
	}
	report += `- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.\n`;
	writeFileSync(join(output, "report.md"), report, "utf8");
	return { ...summaries, winner };
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
	if (options.agents.some((agent) => agent === "pi" || agent === "p") && !existsSync(options.modelsFile)) {
		console.warn(`Warning: models file not found at ${options.modelsFile}; built-in provider configuration will be used`);
	}
	if (options.agents.includes("kilo") && !existsSync(options.kiloConfig)) {
		throw new Error(`Kilo config not found at ${options.kiloConfig}`);
	}
	const versions = {
		pi: options.piVersion,
		p: JSON.parse(readFileSync(codingAgentPackage, "utf8")).version,
	};
	if (options.agents.includes("kilo")) {
		const kiloVersionResult = spawnSync("kilo", ["--version"], { encoding: "utf8" });
		if (kiloVersionResult.status !== 0) throw new Error("Unable to run kilo --version");
		const installedKiloVersion = kiloVersionResult.stdout.trim();
		if (installedKiloVersion !== options.kiloVersion) {
			throw new Error(`Installed Kilo version is ${installedKiloVersion}; expected ${options.kiloVersion}`);
		}
		versions.kilo = installedKiloVersion;
	}
	const benchmarkTasks = options.task ? tasks.filter((task) => task.id === options.task) : tasks;
	if (benchmarkTasks.length === 0) throw new Error(`Unknown task: ${options.task}`);
	const output = options.output ?? join(repoRoot, "benchmarks", "results", timestampLabel());
	ensureDir(output);
	ensureDir(join(output, "recordings"));
	ensureDir(join(output, "stderr"));
	const agentDirs = createAgentDirs(options);
	const results = [];
	const startedAt = performance.now();
	const deadline = startedAt + options.maxRuntimeSeconds * 1000;
	console.log(`Benchmark output: ${output}`);
	console.log(`PI/P model: ${options.model ?? "not selected"}`);
	if (options.agents.includes("kilo")) console.log(`Kilo model: ${options.kiloModel}`);
	console.log(`Versions: ${options.agents.map((agent) => `${agent} ${versions[agent]}`).join(", ")}`);
	console.log(`Sequential order: ${options.agents.join(" -> ")}`);
	try {
		for (let run = 1; run <= options.runs; run += 1) {
			for (const agent of options.agents) {
				for (const task of benchmarkTasks) {
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
					const recordingName = `${agent}-run-${run}-${task.id}.jsonl.gz`;
					const stderrName = `${agent}-run-${run}-${task.id}.log`;
					const result = await runCommand(
						command,
						Math.min(taskTimeout * 1000, remainingMs),
						join(output, "recordings", recordingName),
					);
					writeFileSync(join(output, "stderr", stderrName), result.stderr, "utf8");
					const metrics = parseRecording(result.stdout, agent);
					metrics.rawEventCount = result.rawEventCount;
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
						modelAlias: agent === "kilo" ? options.kiloModel : options.model,
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
	const summaries = createReport(options, versions, results, output, benchmarkTasks);
	const resultDocument = {
		generatedAt: new Date().toISOString(),
		agents: options.agents,
		models: {
			pi: options.model,
			p: options.model,
			kilo: options.agents.includes("kilo") ? options.kiloModel : undefined,
		},
		versions,
		runs: options.runs,
		timeoutSeconds: options.timeoutSeconds,
		maxRuntimeSeconds: options.maxRuntimeSeconds,
		tasks: benchmarkTasks.map(({ id, description, timeoutSeconds }) => ({ id, description, timeoutSeconds })),
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
