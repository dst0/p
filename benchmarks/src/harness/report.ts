import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BenchmarkUsage {
  input: number;
  output: number;
  totalTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface BenchmarkQuality {
  passed: boolean;
  score: number;
  maxScore: number;
  rawScore?: number;
  penalty?: number;
  checks: readonly { passed: boolean }[];
}

interface CompletedBenchmarkResult {
  run: number;
  agent: string;
  task: string;
  status: "passed" | "failed" | "timed_out";
  elapsedMs: number;
  nudges?: number;
  metrics: { usage: BenchmarkUsage; toolCalls: number; toolErrors: number };
  quality: BenchmarkQuality;
}

interface SkippedBenchmarkResult {
  run: number;
  agent: string;
  task: string;
  status: "skipped";
}

export type BenchmarkResult = CompletedBenchmarkResult | SkippedBenchmarkResult;

interface BenchmarkReportOptions {
  agents: readonly string[];
  model?: string;
  codexModel?: string;
  kiloModel?: string;
  agyModel?: string;
  runs: number;
}

interface StartupProbe {
  resolvedModel: string;
  status: string;
}

interface BenchmarkSummary {
  runs: number;
  passed: number;
  qualityPassed: number;
  qualityScore: number;
  qualityRawScore: number;
  qualityMaxScore: number;
  totalNudges: number;
  totalPenalties: number;
  timedOut: number;
  failed: number;
  averageWallMs: number;
  averageInputTokens: number;
  averageCachedTokens: number;
  averageCacheWriteTokens: number;
  averageOutputTokens: number;
  averageTotalTokens: number;
  averageToolCalls: number;
  averageToolErrors: number;
}

export interface BenchmarkReportOutcome {
  winner: string | undefined;
  [agent: string]: BenchmarkSummary | string | undefined;
}

function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function average<T>(rows: readonly T[], selector: (row: T) => number): number {
  if (rows.length === 0) return 0;
  return rows.reduce((total, row) => total + selector(row), 0) / rows.length;
}

export function formatCacheHitPercentage(usage: Partial<BenchmarkUsage>): string {
  const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return promptTokens > 0 ? `${(((usage.cacheRead ?? 0) / promptTokens) * 100).toFixed(1)}%` : "0.0%";
}

export function createBenchmarkReport(
  options: BenchmarkReportOptions,
  versions: Readonly<Record<string, string>>,
  results: readonly BenchmarkResult[],
  output: string,
  benchmarkTasks: readonly { id: string }[],
  startupProbes: { kilo?: StartupProbe; agy?: StartupProbe } = {},
  nudgePenaltyPerNudge = 15,
  generatedAt = new Date().toISOString(),
): BenchmarkReportOutcome {
  const completed = results.filter((result): result is CompletedBenchmarkResult => result.status !== "skipped");
  const byAgent = (agent: string): CompletedBenchmarkResult[] => completed.filter((result) => result.agent === agent);
  const summary = (rows: readonly CompletedBenchmarkResult[]): BenchmarkSummary => ({
    runs: rows.length,
    passed: rows.filter((row) => row.status === "passed").length,
    qualityPassed: rows.filter((row) => row.quality.passed).length,
    qualityScore: rows.reduce((total, row) => total + row.quality.score, 0),
    qualityRawScore: rows.reduce((total, row) => total + (row.quality.rawScore ?? row.quality.score), 0),
    qualityMaxScore: rows.reduce((total, row) => total + row.quality.maxScore, 0),
    totalNudges: rows.reduce((total, row) => total + (row.nudges ?? 0), 0),
    totalPenalties: rows.reduce((total, row) => total + (row.quality.penalty ?? 0), 0),
    timedOut: rows.filter((row) => row.status === "timed_out").length,
    failed: rows.filter((row) => row.status === "failed").length,
    averageWallMs: average(rows, (row) => row.elapsedMs),
    averageInputTokens: average(rows, (row) => row.metrics.usage.input),
    averageCachedTokens: average(rows, (row) => row.metrics.usage.cacheRead ?? 0),
    averageCacheWriteTokens: average(rows, (row) => row.metrics.usage.cacheWrite ?? 0),
    averageOutputTokens: average(rows, (row) => row.metrics.usage.output),
    averageTotalTokens: average(rows, (row) => row.metrics.usage.totalTokens),
    averageToolCalls: average(rows, (row) => row.metrics.toolCalls),
    averageToolErrors: average(rows, (row) => row.metrics.toolErrors),
  });
  const summaries: Record<string, BenchmarkSummary> = Object.fromEntries(
    options.agents.map((agent) => [agent, summary(byAgent(agent))]),
  );
  const rankedAgents = [...options.agents]
    .filter((agent) => summaries[agent].runs > 0)
    .sort((leftAgent, rightAgent) => {
      const left = summaries[leftAgent];
      const right = summaries[rightAgent];
      return (
        right.passed - left.passed ||
        right.qualityPassed - left.qualityPassed ||
        right.qualityScore / right.qualityMaxScore - left.qualityScore / left.qualityMaxScore ||
        left.totalNudges - right.totalNudges ||
        left.averageTotalTokens - right.averageTotalTokens ||
        left.averageWallMs - right.averageWallMs
      );
    });
  const winner = rankedAgents[0];

  let report = "# Agent benchmark report\n\n";
  report += `Generated: ${generatedAt}\n\n`;
  report += `PI/P model alias: \`${options.model ?? "not selected"}\`\n\n`;
  if (options.agents.includes("codex")) report += `Codex model alias: \`${options.codexModel}\`\n\n`;
  if (options.agents.includes("kilo")) report += `Kilo model alias: \`${options.kiloModel}\`\n\n`;
  if (options.agents.includes("agy")) report += `AGY model: \`${options.agyModel}\`\n\n`;
  if (startupProbes.kilo) {
    report += `Kilo resolved backend model: \`${startupProbes.kilo.resolvedModel}\` (startup probe: ${startupProbes.kilo.status})\n\n`;
  }
  if (startupProbes.agy) {
    report += `AGY resolved model: \`${startupProbes.agy.resolvedModel}\` (startup probe: ${startupProbes.agy.status})\n\n`;
  }
  report += `Versions: ${options.agents.map((agent) => `\`${agent} ${versions[agent]}\``).join(", ")}\n\n`;
  report += `Sequential agent order: ${options.agents.map((agent) => `\`${agent}\``).join(" → ")}\n\n`;
  report += `Runs: ${options.runs} repetition${options.runs === 1 ? "" : "s"} across ${benchmarkTasks.length} fixture${benchmarkTasks.length === 1 ? "" : "s"}; lower time/tokens/tool calls are better.\n\n`;
  report += "## Summary\n\n";
  report +=
    "| Agent | Completed passes | Quality passes | Weighted score | Nudges | Timed out | Failed | Avg wall time | Avg input tokens | Avg cached tokens | Cache hit % | Avg output tokens | Avg total tokens | Avg tool calls | Tool errors |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n";
  for (const agent of options.agents) {
    const data = summaries[agent];
    const cacheHitPct = formatCacheHitPercentage({
      input: data.averageInputTokens,
      cacheRead: data.averageCachedTokens,
      cacheWrite: data.averageCacheWriteTokens,
    });
    report += `| ${agent} | ${data.passed}/${data.runs} | ${data.qualityPassed}/${data.runs} | ${data.qualityScore}/${data.qualityMaxScore} | ${data.totalNudges} | ${data.timedOut} | ${data.failed} | ${formatMs(data.averageWallMs)} | ${formatNumber(data.averageInputTokens)} | ${formatNumber(data.averageCachedTokens)} | ${cacheHitPct} | ${formatNumber(data.averageOutputTokens)} | ${formatNumber(data.averageTotalTokens)} | ${data.averageToolCalls.toFixed(1)} | ${data.averageToolErrors.toFixed(1)} |\n`;
  }
  report += `\nSimple winner by completed pass count, then quality pass count, tokens, and time: **${winner ?? "none"}**. This is a directional result, not a general model or agent ranking.\n\n`;
  report += "## Per-task results\n\n";
  report +=
    "| Run | Agent | Task | Status | Wall time | Input tokens | Cached tokens | Cache hit % | Output tokens | Total tokens | Tool calls | Nudges | Checks | Weighted score |\n| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |\n";
  for (const result of results) {
    const skipped = result.status === "skipped";
    const checks = skipped
      ? "skipped"
      : `${result.quality.checks.filter((check) => check.passed).length}/${result.quality.checks.length}`;
    const weightedScore = skipped
      ? "—"
      : (result.quality?.penalty ?? 0) > 0
        ? `${result.quality.score}/${result.quality.maxScore} (-${result.quality.penalty})`
        : `${result.quality.score}/${result.quality.maxScore}`;
    const nudges = skipped ? "—" : (result.nudges ?? 0);
    const inputTokens = skipped ? "—" : formatNumber(result.metrics.usage.input);
    const cachedTokens = skipped ? "—" : formatNumber(result.metrics.usage.cacheRead ?? 0);
    const cacheHitPct = skipped ? "—" : formatCacheHitPercentage(result.metrics.usage);
    const outputTokens = skipped ? "—" : formatNumber(result.metrics.usage.output);
    report += `| ${result.run} | ${result.agent} | ${result.task} | ${result.status} | ${skipped ? "—" : formatMs(result.elapsedMs)} | ${inputTokens} | ${cachedTokens} | ${cacheHitPct} | ${outputTokens} | ${skipped ? "—" : formatNumber(result.metrics.usage.totalTokens)} | ${skipped ? "—" : result.metrics.toolCalls} | ${nudges} | ${checks} | ${weightedScore} |\n`;
  }
  report += "\n## Interpretation\n\n";
  report +=
    "- Session recordings are the compressed JSONL files under [recordings](./recordings). They contain the event stream used to calculate these metrics.\n";
  report +=
    "- Cache hit percentage is cached-read tokens divided by input, cached-read, and cache-write prompt tokens.\n";
  report +=
    "- Completed passes require a clean agent exit before the timeout. Quality passes report the final workspace checks independently, so a timed-out agent can still leave a passing artifact.\n";
  report += `- Nudge watchdog monitors agent task completion: if an agent exits before timeout without creating \`finish_notes.md\`, a reminder is sent to continue. Each nudge incurs a ${nudgePenaltyPerNudge}-point penalty from the raw weighted score.\n`;
  report +=
    "- Fixture checks run the TypeScript test suite and typecheck; advanced fixtures score each hidden invariant independently. Inventory emphasizes atomicity and tamper safety; durable workflow adds DAG scheduling, lease fencing, retry timing, compensation, and adversarial recovery.\n";
  report +=
    "- Agents run in the displayed order with fresh fixture workspaces and isolated configuration/session directories. Repeat with `--runs 2` and a sufficient overall deadline before treating small differences as meaningful.\n";
  if (options.agents.includes("kilo")) {
    report +=
      "- Kilo fixtures start only after bounded model-resolution and request probes pass. Probe recordings, stderr, runtime logs, and state evidence are under [diagnostics/kilo-startup](./diagnostics/kilo-startup).\n";
    report +=
      "- Kilo currently emits duplicate JSONL events. Raw recordings preserve them; calculated Kilo metrics deduplicate events by event type, part ID, and state.\n";
  }
  if (options.agents.includes("agy")) {
    report +=
      "- AGY fixtures start only after a bounded request probe confirms the exact requested model. Probe recording, stderr, and state evidence are under [diagnostics/agy-startup](./diagnostics/agy-startup).\n";
  }
  report +=
    "- Provider latency, model sampling, cache state, agent order, and package versions can dominate this small sample.\n";
  writeFileSync(join(output, "report.md"), report, "utf8");
  return { ...summaries, winner };
}
