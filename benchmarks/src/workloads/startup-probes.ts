import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  benchmarkStartupProbeFailure,
  finalizeBenchmarkStartupEvidence,
  finalizeKiloStartupEvidence,
} from "../harness/startup-probe-finalization.ts";
import { benchmarkStderrLogName, writeBenchmarkStderrLog } from "../harness/stderr-log.ts";
import { commandForAgent, commandForKiloModelResolution } from "./agent-command.ts";
import { type AgentTaskResult, type CommandRunOptions, runRecordedCommand } from "./agent-turn-runner.ts";
import { parseRecording, type RecordingMetrics } from "./recording-metrics.ts";
import type { RunnerOptions } from "./runner-options.ts";

type JsonRecord = Record<string, unknown>;

export type CommandProbeEvidence = {
  status: "timed_out" | "passed" | "failed";
  elapsedMs: number;
  exitCode: number | null | undefined;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  error?: string;
  captureOverflow?: unknown;
  recordingCapture?: unknown;
  rawEventCount: number;
  recording: string;
  stderr: string;
};

export type KiloStartupEvidence = {
  [key: string]: unknown;
  status: string;
  expectedResolvedModel?: string;
  kiloModelAlias?: string;
  timeoutSeconds: number;
  diagnostics: string;
  modelResolution?: CommandProbeEvidence;
  resolvedModel?: string;
  request?: CommandProbeEvidence & { responseMatched: boolean; errors: string[] };
  error?: string;
  runtimeFiles?: { data: string[]; state: string[] };
};

export type AgyStartupEvidence = Partial<Omit<CommandProbeEvidence, "status">> & {
  [key: string]: unknown;
  status: string;
  requestedModel?: string;
  responseMatched?: boolean;
  modelMatched?: boolean;
  resolvedModel?: string;
  errors?: string[];
};

function parseJsonObjectAfterLine(output: string, line: string): JsonRecord | undefined {
  const lines = output.split(/\r?\n/u);
  const lineStart = lines.findIndex((candidate) => candidate.trim() === line);
  if (lineStart === -1) return undefined;
  const jsonStart = output.indexOf("{", lines.slice(0, lineStart + 1).join("\n").length);
  if (jsonStart === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = jsonStart; index < output.length; index += 1) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(output.slice(jsonStart, index + 1)) as JsonRecord;
    }
  }
  return undefined;
}

function commandProbeEvidence(
  result: Pick<
    AgentTaskResult,
    "elapsedMs" | "code" | "signal" | "timedOut" | "error" | "captureOverflow" | "recordingCapture" | "rawEventCount"
  >,
  recording: string,
  stderr: string,
): CommandProbeEvidence {
  return {
    status: result.timedOut ? "timed_out" : result.code === 0 ? "passed" : "failed",
    elapsedMs: result.elapsedMs,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    error: result.error,
    captureOverflow: result.captureOverflow,
    recordingCapture: result.recordingCapture,
    rawEventCount: result.rawEventCount,
    recording,
    stderr,
  };
}

export async function runKiloStartupProbe(
  options: RunnerOptions,
  configDir: string,
  output: string,
  deadline: number,
): Promise<KiloStartupEvidence> {
  const diagnosticsDir = join(output, "diagnostics", "kilo-startup");
  const workspace = join(configDir, "startup-probe-workspace");
  mkdirSync(diagnosticsDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const evidence: KiloStartupEvidence = {
    status: "running",
    expectedResolvedModel: options.expectedResolvedModel,
    kiloModelAlias: options.kiloModel,
    timeoutSeconds: options.kiloStartupTimeoutSeconds,
    diagnostics: join("diagnostics", "kilo-startup"),
  };
  let probeFailure: unknown;
  try {
    const resolutionRecording = "model-resolution.log.br";
    const resolutionResult = await runRecordedCommand(
      commandForKiloModelResolution(options, configDir, workspace),
      Math.min(options.kiloStartupTimeoutSeconds * 1000, Math.max(1, deadline - performance.now())),
      join(diagnosticsDir, resolutionRecording),
      { collectRawStdout: true, signal: options.signal },
    );
    const resolutionStderr = writeBenchmarkStderrLog(
      diagnosticsDir,
      "model-resolution.stderr",
      resolutionResult.stderr,
    );
    evidence.modelResolution = commandProbeEvidence(resolutionResult, resolutionRecording, resolutionStderr);
    if (resolutionResult.timedOut || resolutionResult.code !== 0) {
      throw new Error(`Kilo model-resolution probe ${evidence.modelResolution.status}`);
    }
    const metadata = parseJsonObjectAfterLine(resolutionResult.rawStdout ?? "", options.kiloModel ?? "");
    const api = typeof metadata?.api === "object" && metadata.api !== null ? (metadata.api as JsonRecord) : undefined;
    if (typeof api?.id !== "string" || !api.id) {
      throw new Error(`Kilo model-resolution probe did not describe ${options.kiloModel}`);
    }
    evidence.resolvedModel = api.id;
    if (api.id !== options.expectedResolvedModel) {
      throw new Error(`Kilo resolved ${api.id}; expected ${options.expectedResolvedModel}`);
    }
    const requestRecording = "request.jsonl.br";
    const marker = "benchmark-startup-ok";
    const requestResult = await runRecordedCommand(
      commandForAgent(
        "kilo",
        options,
        { prompt: `Reply exactly: ${marker}`, timeoutSeconds: options.timeoutSeconds },
        configDir,
        workspace,
      ),
      Math.min(options.kiloStartupTimeoutSeconds * 1000, Math.max(1, deadline - performance.now())),
      join(diagnosticsDir, requestRecording),
      { stopOnMarker: marker, signal: options.signal },
    );
    const requestStderr = writeBenchmarkStderrLog(diagnosticsDir, "request.stderr", requestResult.stderr);
    const metrics = parseRecording(requestResult.stdout, "kilo");
    const responseMatched =
      metrics.finalText.trim() === marker ||
      metrics.finalText.includes(marker) ||
      requestResult.stdout.includes(marker);
    const requestPassed =
      !requestResult.timedOut &&
      (requestResult.code === 0 || responseMatched) &&
      metrics.errors.length === 0 &&
      responseMatched;
    evidence.request = {
      ...commandProbeEvidence(requestResult, requestRecording, requestStderr),
      status: requestPassed ? "passed" : requestResult.timedOut ? "timed_out" : "failed",
      responseMatched,
      errors: metrics.errors,
    };
    evidence.status = "passed";
    return evidence;
  } catch (error) {
    probeFailure = benchmarkStartupProbeFailure(error, evidence, diagnosticsDir);
    throw probeFailure;
  } finally {
    finalizeKiloStartupEvidence(configDir, diagnosticsDir, evidence, probeFailure);
  }
}

export async function runAgyStartupProbe(
  options: RunnerOptions,
  configDir: string,
  output: string,
  deadline: number,
): Promise<AgyStartupEvidence> {
  const diagnosticsDir = join(output, "diagnostics", "agy-startup");
  const workspace = join(configDir, "startup-probe-workspace");
  mkdirSync(diagnosticsDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const recording = "request.jsonl.br";
  const stderr = benchmarkStderrLogName("request.stderr");
  const marker = "benchmark-startup-ok";
  const evidence: AgyStartupEvidence = {
    status: "running",
    requestedModel: options.agyModel,
    recording,
    stderr,
  };
  let probeFailure: unknown;
  try {
    const result = await runRecordedCommand(
      commandForAgent("agy", options, { prompt: `Reply exactly: ${marker}`, timeoutSeconds: 60 }, configDir, workspace),
      Math.min(60_000, Math.max(1, deadline - performance.now())),
      join(diagnosticsDir, recording),
      { signal: options.signal } satisfies CommandRunOptions,
    );
    writeBenchmarkStderrLog(diagnosticsDir, "request.stderr", result.stderr);
    const metrics: RecordingMetrics = parseRecording(result.stdout, "agy");
    const responseMatched = metrics.finalText.trim() === marker;
    const modelMatched = metrics.responseModel === options.agyModel;
    Object.assign(evidence, commandProbeEvidence(result, recording, stderr), {
      responseMatched,
      modelMatched,
      resolvedModel: metrics.responseModel,
      errors: metrics.errors,
    });
    if (result.timedOut || result.code !== 0 || metrics.errors.length > 0 || !responseMatched || !modelMatched) {
      throw new Error("AGY startup probe failed");
    }
    evidence.status = "passed";
    return evidence;
  } catch (error) {
    probeFailure = benchmarkStartupProbeFailure(error, evidence, diagnosticsDir);
    throw probeFailure;
  } finally {
    finalizeBenchmarkStartupEvidence(diagnosticsDir, evidence, probeFailure);
  }
}
