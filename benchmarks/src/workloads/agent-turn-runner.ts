import { existsSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { abortBenchmarkRecording } from "../agents/resources-finalization.ts";
import { type BenchmarkTimeoutKind, runBenchmarkAgentTurn } from "../agents/turn.ts";
import { didAgentTurnFail } from "../agents/turn-policy.ts";
import { throwIfBenchmarkInterrupted } from "../harness/interruption.ts";
import { captureOverflowEvidence, createBenchmarkTurnAggregate } from "../harness/output-capture.ts";
import { benchmarkRunnerRecordingFactory } from "../harness/runner-recording-factory.ts";
import {
  bindProjectInstructionTurnAuthority,
  createProjectInstructionTurnChallenge,
} from "../project-instructions/turn-authority.ts";
import { type AgentCommand, commandForAgent } from "./agent-command.ts";
import { createAgentTaskCompletionGuard } from "./agent-task-completion.ts";
import type { AgentId, RunnerOptions } from "./runner-options.ts";
import type { BenchmarkTask } from "./task-definition.ts";

const nudgeMessage =
  "Are you done with the task or is there anything left? If you are finished, ensure all requirements are satisfied and create finish_notes.md.";
const terminalRecoveryNudgeMessage =
  "finish_notes.md exists, but P has not completed its terminal verification. Complete fresh verification and its terminal action.";

export const nudgePenaltyPerNudge = 15;

export const metricEventTypes = new Set([
  "auto_retry_end",
  "error",
  "init",
  "message_end",
  "request_start",
  "result",
  "step_finish",
  "step_update",
  "text",
  "tool_execution_end",
  "tool_execution_start",
  "tool_use",
  "turn_end",
]);

const semanticProgressEventTypes = new Set([
  ...metricEventTypes,
  "compaction_end",
  "compaction_progress",
  "compaction_start",
  "message_start",
  "message_update",
  "turn_start",
]);

type TurnResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
  captureOverflow?: unknown;
  recordingCapture?: unknown;
  timedOut: boolean;
  timeoutKind?: BenchmarkTimeoutKind;
  rawEventCount: number;
  metricEventCount: number;
  runtimeContexts: EvidenceInput[];
  userTurns: UserTurn[];
  rawStdout?: string;
  projectInstructionProof?: unknown;
  elapsedMs: number;
};

export type AgentTaskResult = {
  stdout: string;
  stderr: string;
  code: number | null | undefined;
  signal: NodeJS.Signals | null;
  error?: string;
  captureOverflow?: unknown;
  recordingCapture?: unknown;
  timedOut: boolean;
  timeoutKind?: BenchmarkTimeoutKind;
  rawEventCount: number;
  runtimeContexts: EvidenceInput[];
  userTurns: UserTurn[];
  proofReceiptSha256?: string;
  proofExpectedTurnCount: number;
  baseSystemModeProofs: EvidenceInput[];
  elapsedMs: number;
  nudges: number;
};

type EvidenceInput = Record<string, unknown> & {
  actionQueries?: unknown;
  actionQuery?: unknown;
  query?: unknown;
};

type UserTurn = EvidenceInput & {
  bytes?: number;
  eventOrdinal?: number;
  sha256?: string;
};

export type CommandRunOptions = {
  collectRawStdout?: boolean;
  stopOnMarker?: string;
  signal?: AbortSignal;
  outputLimits?: Readonly<Record<string, number>>;
};

export async function runRecordedCommand(
  command: AgentCommand,
  timeoutMs: number,
  recordingPath: string,
  options: CommandRunOptions = {},
): Promise<TurnResult> {
  const recording = benchmarkRunnerRecordingFactory.command(recordingPath, options);
  try {
    const result = (await runBenchmarkAgentTurn(
      command,
      timeoutMs,
      recording,
      metricEventTypes,
      options,
    )) as TurnResult;
    await recording.finalize();
    return result;
  } catch (error) {
    await abortBenchmarkRecording(recording, error);
    throw error;
  }
}

export async function runAgentTask(
  agent: AgentId,
  options: RunnerOptions,
  task: BenchmarkTask,
  configDir: string,
  workspace: string,
  recordingPath: string,
  taskTimeoutSeconds: number,
  overallDeadline: number,
): Promise<AgentTaskResult> {
  const startedAt = performance.now();
  const combined = createBenchmarkTurnAggregate(options.outputLimits);
  const baseSystemModeProofs: EvidenceInput[] = [];
  let totalRawEventCount = 0;
  let proofExpectedTurnCount = 0;
  let lastCode: number | null | undefined = 0;
  let lastSignal: NodeJS.Signals | null = null;
  let lastError: string | undefined;
  let lastCaptureOverflow: unknown;
  let lastRecordingCapture: unknown;
  let timedOut = false;
  let lastTimeoutKind: BenchmarkTimeoutKind | undefined;
  let nudges = 0;
  const maxNudges = 5;
  const taskTimeoutMs = taskTimeoutSeconds * 1000;
  const recording = benchmarkRunnerRecordingFactory.task(recordingPath, options);
  const completion = createAgentTaskCompletionGuard(agent, options.taskVerificationMode);
  try {
    let isContinue = false;
    let currentPrompt = task.prompt;
    while (true) {
      throwIfBenchmarkInterrupted(options.signal);
      const remainingTaskMs = taskTimeoutMs - (performance.now() - startedAt);
      const remainingOverallMs = overallDeadline - performance.now();
      const turnTimeoutMs = Math.min(remainingTaskMs, remainingOverallMs);
      if (turnTimeoutMs <= 0) {
        timedOut = true;
        lastTimeoutKind = remainingOverallMs <= 0 ? "hard_deadline" : "inactivity";
        break;
      }
      const turnOrdinal = nudges + 1;
      const challenge =
        agent === "p" && options.projectInstructions
          ? createProjectInstructionTurnChallenge(
              options.projectInstructionProofReceipt ?? "",
              turnOrdinal,
              currentPrompt,
            )
          : undefined;
      const turnOptions = challenge ? { ...options, projectInstructionProofReceipt: challenge.receiptSha256 } : options;
      if (challenge) proofExpectedTurnCount += 1;
      const command = commandForAgent(agent, turnOptions, task, configDir, workspace, isContinue, currentPrompt);
      const turnResult = (await runBenchmarkAgentTurn(command, turnTimeoutMs, recording, metricEventTypes, {
        ...turnOptions,
        hardTimeoutMs: remainingOverallMs,
        progressEventTypes: semanticProgressEventTypes,
        signal: options.signal,
        timeoutMode: "semantic_progress",
        eventOrdinalBase: totalRawEventCount,
        turn: turnOrdinal,
      })) as TurnResult;
      totalRawEventCount += turnResult.rawEventCount;
      if (challenge) {
        const proof = bindProjectInstructionTurnAuthority(
          turnResult.projectInstructionProof,
          challenge,
          turnResult.userTurns,
        );
        if (!proof) {
          throw new Error(`project instruction startup proof is missing or invalid for turn ${turnOrdinal}`);
        }
        baseSystemModeProofs.push(proof);
      }
      lastCode = turnResult.code;
      lastSignal = turnResult.signal;
      lastError = turnResult.error;
      lastCaptureOverflow = turnResult.captureOverflow;
      lastRecordingCapture = turnResult.recordingCapture;
      lastTimeoutKind = turnResult.timeoutKind;
      try {
        combined.append(turnResult);
        completion.observe(turnResult.stdout);
      } catch (error) {
        lastCode = undefined;
        lastError = error instanceof Error ? error.message : String(error);
        lastCaptureOverflow = captureOverflowEvidence(error, nudges + 1);
        break;
      }
      if (turnResult.timedOut) {
        timedOut = true;
        break;
      }
      const finishNotesCreated = existsSync(join(workspace, "finish_notes.md"));
      if (completion.shouldStop(didAgentTurnFail(turnResult), finishNotesCreated)) break;
      const remainingAfterTurn = taskTimeoutMs - (performance.now() - startedAt);
      const overallRemainingAfterTurn = overallDeadline - performance.now();
      if (remainingAfterTurn <= 0) {
        lastCode = undefined;
        lastError = "agent completed an active turn after the nominal task budget without accepted terminal completion";
        break;
      }
      const remainingUsableMs = Math.min(remainingAfterTurn, overallRemainingAfterTurn);
      if (remainingUsableMs <= 5000 || nudges >= maxNudges) {
        lastCode = undefined;
        lastError = completion.waitingForAcceptedCompletion(finishNotesCreated)
          ? "agent exited before the required terminal completion protocol was accepted"
          : "agent exited before creating finish_notes.md";
        break;
      }
      nudges += 1;
      const waitingForAcceptedCompletion = completion.waitingForAcceptedCompletion(finishNotesCreated);
      const reason = waitingForAcceptedCompletion
        ? "finish_notes.md exists but terminal completion was not accepted"
        : "premature exit without finish_notes.md";
      console.log(
        `[watchdog] ${agent}/${task.id}: ${reason}; sending nudge #${nudges} (${Math.round(remainingUsableMs / 1000)}s remaining)`,
      );
      isContinue = true;
      currentPrompt = waitingForAcceptedCompletion ? terminalRecoveryNudgeMessage : nudgeMessage;
    }
    await recording.finalize();
  } catch (error) {
    await abortBenchmarkRecording(recording, error);
    throw error;
  }
  return {
    stdout: combined.stdout.value(),
    stderr: combined.stderr.value(),
    code: lastCode,
    signal: lastSignal,
    error: lastError,
    captureOverflow: lastCaptureOverflow,
    recordingCapture: lastRecordingCapture,
    timedOut,
    timeoutKind: lastTimeoutKind,
    rawEventCount: totalRawEventCount,
    runtimeContexts: combined.runtimeContexts as EvidenceInput[],
    userTurns: combined.userTurns as UserTurn[],
    proofReceiptSha256: options.projectInstructionProofReceipt,
    proofExpectedTurnCount,
    baseSystemModeProofs,
    elapsedMs: performance.now() - startedAt,
    nudges,
  };
}
