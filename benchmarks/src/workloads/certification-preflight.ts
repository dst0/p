import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import { initializeBenchmarkWorkspaceRepository } from "../harness/workspace-repository.ts";
import { createProjectInstructionTurnChallenge } from "../project-instructions/turn-authority.ts";
import { commandForAgent, sandboxedCommandIfNeeded } from "./agent-command.ts";
import { runRecordedCommand } from "./agent-turn-runner.ts";
import {
  BenchmarkMutableArtifactsUnsafeError,
  isBenchmarkMutableArtifactsUnsafeError,
} from "./benchmark-run-finalization.ts";
import type { CertifiedHarnessBinding } from "./certification-binding.ts";
import { createCertifiedInstructionChallenge } from "./certification-instruction-challenge.ts";
import { parseRecording } from "./recording-metrics.ts";
import type { AgentId, RunnerOptions } from "./runner-options.ts";

export { evaluateInstructionParityReceipts } from "./certification-preflight-evaluation.ts";
export {
  redactReceiptFromBrotliFile,
  sanitizeCertifiedReceiptArtifacts,
} from "./certification-receipt-cleanup.ts";

import { redactReceiptFromBrotliFile } from "./certification-receipt-cleanup.ts";

export const CERTIFIED_PREFLIGHT_PROMPT =
  "State the exact certified instruction parity receipt assembled from the head, middle, and tail materials in your automatically loaded project instructions. Use | separators and nothing else. Do not read files or use tools.";

export interface AugmentedInstructions {
  augmentedPath: string;
  augmentedSha256: string;
  receiptValue: string;
  receiptSha256: string;
}

export interface CertifiedInstructionReceipt {
  agent: AgentId;
  status: "passed" | "failed";
  receiptSha256: string;
  responseMatched: boolean;
  responseModel?: string;
  responseModels?: string[];
  elapsedMs: number;
  error?: string;
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function createAugmentedProjectInstructions(
  sourcePath: string,
  outputDir: string,
  nonce?: string,
): AugmentedInstructions {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing project instructions source file: ${sourcePath}`);
  }
  const sourceContent = readFileSync(sourcePath, "utf8");
  const challenge = createCertifiedInstructionChallenge(sourceContent, nonce);
  const receiptValue = challenge.receiptValue;
  const receiptSha256 = hashText(receiptValue);
  const instructionsDir = join(outputDir, "instructions");
  assertCertifiedOutputWritePath(instructionsDir);
  mkdirSync(instructionsDir, { recursive: true, mode: 0o700 });
  chmodSync(instructionsDir, 0o700);
  const augmentedPath = join(instructionsDir, "AGENTS.md");
  assertCertifiedOutputWritePath(augmentedPath);
  writeFileSync(augmentedPath, challenge.augmentedContent, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const augmentedSha256 = hashFile(augmentedPath);
  return { augmentedPath, augmentedSha256, receiptValue, receiptSha256 };
}

export function verifyWorkspaceInstructions(workspace: string, expectedAugmentedSha256: string): void {
  const instructionsFile = join(workspace, "AGENTS.md");
  if (!existsSync(instructionsFile)) {
    throw new Error(`Missing AGENTS.md in workspace: ${workspace}`);
  }
  const stat = lstatSync(instructionsFile);
  if (stat.isSymbolicLink()) {
    throw new Error(`Workspace AGENTS.md must not be a symbolic link: ${instructionsFile}`);
  }
  const actualSha256 = hashFile(instructionsFile);
  if (actualSha256 !== expectedAugmentedSha256) {
    throw new Error(
      `Workspace AGENTS.md hash mismatch in ${workspace}: expected ${expectedAugmentedSha256}, got ${actualSha256}`,
    );
  }
}

export async function runCertifiedPreflights(
  options: RunnerOptions,
  agentDirs: Record<string, string>,
  output: string,
  deadline: number,
  receiptValue: string,
  binding: CertifiedHarnessBinding,
  runCommand: typeof runRecordedCommand = runRecordedCommand,
): Promise<CertifiedInstructionReceipt[]> {
  const receipts: CertifiedInstructionReceipt[] = [];
  const receiptSha256 = binding.projectInstructions.receiptSha256 ?? hashText(receiptValue);
  const preflightAgents: AgentId[] = ["p", "pi", "kilo"];
  assertCertifiedOutputWritePath(join(output, "recordings"));
  mkdirSync(join(output, "recordings"), { recursive: true });

  for (const agent of preflightAgents) {
    const configDir = agentDirs[agent] ?? join(output, "config", agent);
    assertCertifiedOutputWritePath(configDir);
    mkdirSync(configDir, { recursive: true });
    const workspace = join(output, "preflight", agent);
    assertCertifiedOutputWritePath(workspace);
    mkdirSync(workspace, { recursive: true });
    const recordingPath = join(output, "recordings", `${agent}-preflight.log.br`);
    let workspaceSafeToTraverse = true;
    let primaryError: unknown;
    let failed = false;
    const cleanupErrors: unknown[] = [];

    try {
      assertCertifiedOutputWritePath(join(workspace, "AGENTS.md"));
      copyFileSync(binding.projectInstructions.path, join(workspace, "AGENTS.md"));
      initializeBenchmarkWorkspaceRepository(workspace);
      verifyWorkspaceInstructions(workspace, binding.projectInstructions.sha256);

      const prompt = CERTIFIED_PREFLIGHT_PROMPT;
      const task = { prompt, timeoutSeconds: 60, isProbe: true };
      const turnOptions =
        agent === "p"
          ? {
              ...options,
              projectInstructionProofReceipt: createProjectInstructionTurnChallenge(
                options.projectInstructionProofReceipt ?? "0".repeat(64),
                1,
                prompt,
              ).receiptSha256,
            }
          : options;

      const rawCommand = commandForAgent(agent, turnOptions, task, configDir, workspace);
      const command = sandboxedCommandIfNeeded(rawCommand, options, workspace, configDir);
      const timeoutMs = Math.min(60_000, Math.max(1_000, deadline - performance.now()));

      let turnResult: Awaited<ReturnType<typeof runRecordedCommand>>;
      try {
        turnResult = await runCommand(command, timeoutMs, recordingPath, {
          collectRawStdout: true,
          signal: options.signal,
          projectInstructionProofReceipt: turnOptions.projectInstructionProofReceipt,
        });
      } catch (err) {
        if (isBenchmarkMutableArtifactsUnsafeError(err)) {
          workspaceSafeToTraverse = false;
          throw new BenchmarkMutableArtifactsUnsafeError(
            `Certified ${agent} preflight process cleanup was unconfirmed`,
            err,
          );
        }
        throw err;
      }

      verifyWorkspaceInstructions(workspace, binding.projectInstructions.sha256);

      const metrics = parseRecording(turnResult.stdout, agent);
      const expectedModel = options.expectedResolvedModel ?? (agent === "kilo" ? options.kiloModel : options.model);
      const observedModels = metrics.responseModels ?? [];
      const modelMatched =
        !expectedModel ||
        (metrics.responseModel === expectedModel &&
          observedModels.length > 0 &&
          observedModels.every((model) => model === expectedModel));
      const responseMatched = metrics.finalText.trim() === receiptValue;
      const toolErrors = metrics.toolErrors ?? 0;
      const toolCalls = metrics.toolCalls ?? 0;
      const errorCount = (metrics.errors ?? []).length;
      const cleanProcess = turnResult.code === 0 && !turnResult.timedOut && !turnResult.signal && !turnResult.error;
      const passed =
        cleanProcess && toolCalls === 0 && toolErrors === 0 && errorCount === 0 && responseMatched && modelMatched;

      receipts.push({
        agent,
        status: passed ? "passed" : "failed",
        receiptSha256,
        responseMatched,
        responseModel: metrics.responseModel,
        responseModels: metrics.responseModels,
        elapsedMs: turnResult.elapsedMs,
        ...(!passed
          ? {
              error: !cleanProcess
                ? (turnResult.error ??
                  `Process exited with code ${turnResult.code}${turnResult.stderr ? `: ${turnResult.stderr}` : ""}`)
                : !responseMatched
                  ? "Response did not contain the expected receipt value"
                  : !modelMatched
                    ? `Model mismatch: expected ${expectedModel}, got ${metrics.responseModel}`
                    : toolCalls > 0
                      ? `Preflight used ${toolCalls} user-visible tool call(s)`
                      : "Tool or protocol errors during preflight turn",
            }
          : {}),
      });
    } catch (error) {
      primaryError = error;
      failed = true;
    } finally {
      try {
        redactReceiptFromBrotliFile(recordingPath, receiptValue);
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (workspaceSafeToTraverse) {
        try {
          assertCertifiedOutputWritePath(workspace);
          rmSync(workspace, { recursive: true, force: true });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        failed ? [primaryError, ...cleanupErrors] : cleanupErrors,
        `Unable to finalize certified ${agent} preflight artifacts`,
      );
    }
    if (failed) throw primaryError;
  }
  return receipts;
}
