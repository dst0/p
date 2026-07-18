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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codingAgentCli = join(repoRoot, "packages", "coding-agent", "dist", "cli.js");
const defaultModelsFile = join(homedir(), ".p", "agent", "models.json");
const defaultAuthFile = join(homedir(), ".p", "agent", "auth.json");
const defaultOriginalVersion = "0.73.1";
const defaultTimeoutSeconds = 120;
const defaultMaxRuntimeSeconds = 900;

function printHelp() {
	console.log(`Usage:
  npm run benchmark:agents -- --model <provider/id> [options]

Compare this checkout (p) with the upstream pi-coding-agent package using
the same model and three deterministic coding fixtures.

Options:
  --model <provider/id>       Model to use for both agents (required)
  --models-file <path>        Custom models.json copied into temporary agent dirs
                              (default: ~/.p/agent/models.json)
  --original-version <ver>    Upstream package version (default: ${defaultOriginalVersion})
  --runs <n>                  Complete repetitions (default: 1)
  --timeout-seconds <n>       Per-agent task timeout (default: ${defaultTimeoutSeconds})
  --max-runtime-seconds <n>   Overall deadline (default: ${defaultMaxRuntimeSeconds})
  --output <dir>              Results directory
                              (default: benchmarks/results/<timestamp>)
  --help                      Show this help

Each result directory contains JSONL session recordings, stderr logs, the
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
		if (arg === "--model" || arg === "--models-file" || arg === "--original-version" || arg === "--output") {
			if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
			const value = argv[++index];
			if (arg === "--model") options.model = value;
			if (arg === "--models-file") options.modelsFile = resolve(value);
			if (arg === "--original-version") options.originalVersion = value;
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

const tasks = [
	{
		id: "read-only",
		description: "Read a small repository and answer without modifying it",
		files: {
			"README.md": `# Service fixture\n\nThe service exposes 7 HTTP endpoints.\nThe current schema version is 3.\nOperational risk: retries can duplicate writes.\n`,
			"package.json": `{"name":"fixture-service","version":"3.0.0","private":true}\n`,
		},
		prompt: `Read README.md and package.json. Reply with exactly one short paragraph that includes the endpoint count, schema version, and the operational risk. Do not create or modify any files.`,
		verify(workspace, baseline, finalText) {
			const files = listFiles(workspace);
			const unchanged = files.length === Object.keys(baseline).length && files.every((file) => readText(join(workspace, file)) === baseline[file]);
			const hasFacts = /7/.test(finalText) && /3/.test(finalText) && /duplicate writes/i.test(finalText);
			return taskResult(unchanged && hasFacts, [
				{ name: "workspace unchanged", passed: unchanged },
				{ name: "answer contains required facts", passed: hasFacts },
			]);
		},
	},
	{
		id: "report",
		description: "Inspect notes and create a concise report",
		files: {
			"notes.txt": `Finding A: cache hits reduce latency.\nFinding B: retries improve transient reliability.\nFinding C: verbose logs increase storage cost.\nRecommendation: keep retries bounded and sample verbose logs.\n`,
		},
		prompt: `Read notes.txt and create report.md. The report must have a Markdown heading, a three-item list preserving Finding A, Finding B, and Finding C, and a final recommendation. Do not modify notes.txt.`,
		verify(workspace, baseline) {
			const report = readText(join(workspace, "report.md")) ?? "";
			const notesUnchanged = readText(join(workspace, "notes.txt")) === baseline["notes.txt"];
			const hasReport = /^#\s+/m.test(report) && /Finding A/i.test(report) && /Finding B/i.test(report) && /Finding C/i.test(report) && /recommendation/i.test(report);
			return taskResult(notesUnchanged && hasReport, [
				{ name: "source notes unchanged", passed: notesUnchanged },
				{ name: "report has heading, findings, recommendation", passed: hasReport },
			]);
		},
	},
	{
		id: "debug",
		description: "Fix a failing test without editing the test",
		files: {
			"package.json": `{"name":"score-fixture","private":true,"type":"commonjs"}\n`,
			"src/score.js": `function average(values) {\n  if (values.length === 0) return 0;\n  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);\n}\n\nmodule.exports = { average };\n`,
			"test/score.test.js": `const test = require("node:test");\nconst assert = require("node:assert/strict");\nconst { average } = require("../src/score.js");\n\ntest("keeps fractional averages", () => {\n  assert.equal(average([1, 2, 4]), 7 / 3);\n});\n\ntest("handles empty input", () => {\n  assert.equal(average([]), 0);\n});\n`,
		},
		prompt: `Run node --test test/score.test.js to reproduce the failure. Read the test and fix the bug in src/score.js. Modify only src/score.js, leave the test unchanged, and rerun the same test command until it passes.`,
		verify(workspace, baseline) {
			const testRun = spawnSync(process.execPath, ["--test", "test/score.test.js"], {
				cwd: workspace,
				encoding: "utf8",
				timeout: 15000,
			});
			const sourceChanged = readText(join(workspace, "src/score.js")) !== baseline["src/score.js"];
			const testUnchanged = readText(join(workspace, "test/score.test.js")) === baseline["test/score.test.js"];
			const testsPass = testRun.status === 0;
			return taskResult(sourceChanged && testUnchanged && testsPass, [
				{ name: "score implementation changed", passed: sourceChanged },
				{ name: "test unchanged", passed: testUnchanged },
				{ name: "node test passes", passed: testsPass },
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

function createAgentDirs(modelsFile) {
	const root = mkdtempSync(join(tmpdir(), "pi-agent-benchmark-config-"));
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
	if (agent === "p") {
		return { executable: process.execPath, args: [codingAgentCli, ...commonArgs], env, cwd: workspace };
	}
	return {
		executable: "npm",
		args: [
			"exec",
			"--yes",
			`--package=@mariozechner/pi-coding-agent@${options.originalVersion}`,
			"--",
			"pi",
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

function createReport(options, results, output) {
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
	report += `Upstream: \`@mariozechner/pi-coding-agent@${options.originalVersion}\`\n\n`;
	report += `Runs: ${options.runs} repetition${options.runs === 1 ? "" : "s"} across ${tasks.length} fixtures; lower time/tokens/tool calls are better.\n\n`;
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
	report += `- Session recordings are the JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.\n`;
	report += `- Fixture checks measure observable task quality: read-only preservation, report creation, and a passing regression test with the test file untouched.\n`;
	report += `- The run uses one model, one repetition by default, fresh fixture workspaces, and sequential execution. Repeat with \`--runs 3\` before treating small differences as meaningful.\n`;
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
	console.log(`Upstream: @mariozechner/pi-coding-agent@${options.originalVersion}`);
	try {
		for (let run = 1; run <= options.runs; run += 1) {
			for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
				const task = tasks[taskIndex];
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
					const result = await runCommand(command, Math.min(options.timeoutSeconds * 1000, remainingMs));
					const recordingName = `${agent}-run-${run}-${task.id}.jsonl`;
					const stderrName = `${agent}-run-${run}-${task.id}.log`;
					writeFileSync(join(output, "recordings", recordingName), result.stdout, "utf8");
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
	const summaries = createReport(options, results, output);
	const resultDocument = {
		generatedAt: new Date().toISOString(),
		model: options.model,
		originalVersion: options.originalVersion,
		runs: options.runs,
		timeoutSeconds: options.timeoutSeconds,
		maxRuntimeSeconds: options.maxRuntimeSeconds,
		tasks: tasks.map(({ id, description }) => ({ id, description })),
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
