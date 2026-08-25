import { relative, resolve } from "node:path";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@dst0/p-agent-core";
import { TEST_OPT_OUT_PATTERN, TEST_PATH_PATTERN, TEST_REQUEST_PATTERN } from "../constants.ts";
import { tokenizeShellCommands } from "../git-command-classification.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { MAX_UNVERIFIED_TEST_PATHS } from "../test-authoring-state-validation.ts";
import { isDirectMutationTool, isShellTool, pathArgument, shellCommand } from "../tool-classification.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import { focusedTestInvocation } from "./test-command-invocation.ts";
import { hasPositivePassingTestResult, testInvocationSelection } from "./test-invocation-selection.ts";
import { captureTestWorkspaceSnapshot, changedTestPaths } from "./test-workspace-snapshot.ts";

const TEST_REQUIRED_PATTERN =
  /\b(?:never|do not|don't|dont)\s+(?:skip|avoid)\s+(?:the\s+)?tests?\b|\b(?:never|do not|don't|dont)\s+(?:finish|complete|ship|publish)\b[^\n.;]{0,80}\bwithout\b[^\n.;]{0,30}\btests?\b/iu;
const TEST_VERIFICATION_REQUEST_PATTERN = /\b(?:run|execute|rerun)\b[^\n.;]{0,40}\btests?\b/iu;

export function reserveTestMutation(
  self: TaskVerificationController,
  context: BeforeToolCallContext,
): BeforeToolCallResult | undefined {
  if (testVerificationOptedOut(self)) return undefined;
  const testPaths = mutationTestPaths(self, context);
  if (testPaths.length === 0) return undefined;

  const tracked = new Set([
    ...(self.state.unverifiedTestPaths ?? []),
    ...[...self.testMutationReservations.values()].flat(),
  ]);
  const prospective = new Set([...tracked, ...testPaths]);
  if (self.state.unverifiedTestPathOverflow || prospective.size > MAX_UNVERIFIED_TEST_PATHS) {
    return self.blocked(
      `Cannot mutate another test file while the ${MAX_UNVERIFIED_TEST_PATHS}-path verification batch is full${tracked.size ? `: ${[...tracked].join(", ")}` : ""}. Run a direct successful test command covering this batch first; failed or exit-masked commands do not clear it.`,
    );
  }
  self.testMutationReservations.set(context.toolCall.id, testPaths);
  return undefined;
}

export function releaseTestMutationReservation(self: TaskVerificationController, toolCallId: string): void {
  self.testMutationReservations.delete(toolCallId);
  self.testVerificationStarts.delete(toolCallId);
  self.workspaceTestSnapshots.delete(toolCallId);
  self.activeMutationAttempts.delete(toolCallId);
  self.bashFingerprints.delete(toolCallId);
}

export function captureTestVerificationStart(self: TaskVerificationController, context: BeforeToolCallContext): void {
  if (
    !isShellTool(context.toolCall.name) ||
    focusedTestInvocation(shellCommand(context.args)) === undefined ||
    self.activeMutationAttempts.size > 0
  ) {
    return;
  }
  self.testVerificationStarts.set(context.toolCall.id, {
    mutationAttemptRevision: self.mutationAttemptRevision,
    mutationRevision: self.state.mutationRevision,
    unverifiedTestPaths: [...(self.state.unverifiedTestPaths ?? [])],
  });
}

export function settleTestMutation(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  mutated: boolean,
): string | undefined {
  const testPaths = self.testMutationReservations.get(context.toolCall.id);
  self.testMutationReservations.delete(context.toolCall.id);
  if (!mutated || !testPaths || testPaths.length === 0) return undefined;

  const pending = [...new Set([...(self.state.unverifiedTestPaths ?? []), ...testPaths])];
  self.state = { ...self.state, unverifiedTestPaths: pending };
  return [
    `Unverified test paths (${pending.length}/${MAX_UNVERIFIED_TEST_PATHS}): ${pending.join(", ")}.`,
    "Run a direct test command covering the new or changed test now and fix failures before expanding the batch.",
  ].join("\n");
}

export async function settleWorkspaceTestMutations(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  detectedMutation: boolean,
): Promise<{ guidance?: string; mutated: boolean }> {
  const captured = self.workspaceTestSnapshots.has(context.toolCall.id);
  const before = self.workspaceTestSnapshots.get(context.toolCall.id);
  const potentialMutation = self.activeMutationAttempts.has(context.toolCall.id);
  self.workspaceTestSnapshots.delete(context.toolCall.id);
  if (!captured) return { mutated: false };
  const after = await captureTestWorkspaceSnapshot(self.sessionManager.getCwd());
  if (!before || !after) {
    if (!detectedMutation && !potentialMutation) return { mutated: false };
    self.state = { ...self.state, unverifiedTestPathOverflow: true };
    return {
      guidance:
        "A pathless mutation could not be bounded to exact test paths. Run a direct successful broad test command before completion.",
      mutated: true,
    };
  }
  const changed = changedTestPaths(before, after);
  if (changed.length === 0) return { mutated: false };
  const allPending = [...new Set([...(self.state.unverifiedTestPaths ?? []), ...changed])];
  const overflow = self.state.unverifiedTestPathOverflow === true || allPending.length > MAX_UNVERIFIED_TEST_PATHS;
  const pending = allPending.slice(0, MAX_UNVERIFIED_TEST_PATHS);
  self.state = { ...self.state, unverifiedTestPaths: pending, unverifiedTestPathOverflow: overflow };
  return {
    guidance: `Detected changed test paths from a multi-file mutation: ${changed.join(", ")}. Run a direct successful ${overflow ? "broad " : ""}test command covering them before completion.`,
    mutated: true,
  };
}

export async function settleTestAuthoringMutation(
  self: TaskVerificationController,
  context: AfterToolCallContext,
  mutated: boolean,
): Promise<{ guidance: string; workspaceMutated: boolean }> {
  const workspace = await settleWorkspaceTestMutations(self, context, mutated);
  const guidance = [settleTestMutation(self, context, mutated || workspace.mutated), workspace.guidance]
    .filter((message): message is string => message !== undefined)
    .join("\n");
  return { guidance, workspaceMutated: workspace.mutated };
}

export function clearVerifiedTestPaths(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
  fullOutput: string,
): string | undefined {
  const pending = self.state.unverifiedTestPaths ?? [];
  const invocation = focusedTestInvocation(evidence.descriptor);
  const started = self.testVerificationStarts.get(evidence.toolCallId);
  self.testVerificationStarts.delete(evidence.toolCallId);
  if (
    (pending.length === 0 && !self.state.unverifiedTestPathOverflow) ||
    evidence.isError ||
    !isShellTool(evidence.toolName) ||
    !invocation ||
    !started ||
    started.mutationRevision !== self.state.mutationRevision ||
    started.mutationAttemptRevision !== self.mutationAttemptRevision
  ) {
    return undefined;
  }
  const selection = testInvocationSelection(invocation);
  if (selection.vacuous || !hasPositivePassingTestResult(fullOutput)) return undefined;
  const startedPaths = new Set(started.unverifiedTestPaths);
  const eligible = pending.filter((testPath) => startedPaths.has(testPath));
  const matched = eligible.filter((testPath) => selectionNamesPath(self, selection.pathSelectors, testPath));
  const clearsAll = selection.broad;
  if (matched.length === 0 && !clearsAll) return undefined;

  const verified = clearsAll ? pending : matched;
  const verifiedSet = new Set(verified);
  const remaining = pending.filter((testPath) => !verifiedSet.has(testPath));
  self.state = {
    ...self.state,
    unverifiedTestPaths: remaining,
    unverifiedTestPathOverflow: clearsAll ? false : self.state.unverifiedTestPathOverflow,
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return remaining.length === 0
    ? `Verified the pending test-authoring batch: ${verified.join(", ")}.`
    : `Verified test path(s): ${verified.join(", ")}. Still unverified: ${remaining.join(", ")}.`;
}

export function unverifiedTestPathsGate(
  self: TaskVerificationController,
  action: string,
): BeforeToolCallResult | undefined {
  if (testVerificationOptedOut(self)) return undefined;
  const reservedPaths = [...new Set([...self.testMutationReservations.values()].flat())];
  if (reservedPaths.length > 0 || self.activeMutationAttempts.size > 0 || self.workspaceTestSnapshots.size > 0) {
    return self.blocked(
      `Cannot ${action}: workspace mutation tool calls are still in flight${reservedPaths.length ? ` for test paths: ${reservedPaths.join(", ")}` : ""}. Wait for them to settle first.`,
    );
  }
  const pending = self.state.unverifiedTestPaths ?? [];
  if (pending.length === 0 && !self.state.unverifiedTestPathOverflow) {
    return undefined;
  }
  return self.blocked(
    `Cannot ${action}: changed test paths still need a direct successful ${self.state.unverifiedTestPathOverflow ? "broad " : ""}test run${pending.length ? `: ${pending.join(", ")}` : ""}.`,
  );
}

export function appendTestMutationGuidance(
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
  guidance: string | undefined,
): AfterToolCallResult | undefined {
  if (!guidance) return previousResult;
  const content = [...(previousResult?.content ?? context.result.content), { type: "text" as const, text: guidance }];
  return {
    content,
    isError: previousResult?.isError ?? context.isError,
    ...(previousResult?.details !== undefined
      ? { details: previousResult.details }
      : context.result.details !== undefined
        ? { details: context.result.details }
        : {}),
    ...(previousResult?.terminate !== undefined ? { terminate: previousResult.terminate } : {}),
  };
}

function normalizedTestPath(self: TaskVerificationController, filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const normalized = relative(self.sessionManager.getCwd(), resolve(self.sessionManager.getCwd(), filePath)).replaceAll(
    "\\",
    "/",
  );
  if (
    normalized.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(normalized) ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    !validStoredTestPath(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function validStoredTestPath(filePath: string): boolean {
  return TEST_PATH_PATTERN.test(filePath);
}

function mutationTestPaths(self: TaskVerificationController, context: BeforeToolCallContext): string[] {
  const directPath = isDirectMutationTool(context.toolCall.name) ? pathArgument(context.args) : undefined;
  const candidates = directPath
    ? [directPath]
    : isShellTool(context.toolCall.name)
      ? tokenizeShellCommands(shellCommand(context.args)).flat()
      : [];
  return [
    ...new Set(candidates.map((value) => normalizedTestPath(self, value)).filter((value) => value !== undefined)),
  ];
}

function testVerificationOptedOut(self: TaskVerificationController): boolean {
  const prompts = self.state.taskPrompts?.length
    ? self.state.taskPrompts.map((prompt) => prompt.text)
    : [self.state.taskContext ?? self.latestUserPrompt];
  for (let promptIndex = prompts.length - 1; promptIndex >= 0; promptIndex--) {
    const clauses = prompts[promptIndex]!.split(/[\n.;!?]+/u);
    for (let clauseIndex = clauses.length - 1; clauseIndex >= 0; clauseIndex--) {
      const clause = clauses[clauseIndex]!;
      if (TEST_REQUIRED_PATTERN.test(clause)) return false;
      if (TEST_OPT_OUT_PATTERN.test(clause)) return true;
      if (TEST_VERIFICATION_REQUEST_PATTERN.test(clause) || TEST_REQUEST_PATTERN.test(clause)) return false;
    }
  }
  return false;
}

function selectionNamesPath(
  self: TaskVerificationController,
  candidates: readonly string[],
  testPath: string,
): boolean {
  return candidates.some((candidate) => normalizedTestPath(self, candidate) === testPath);
}
