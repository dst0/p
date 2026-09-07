import type { AfterToolCallResult, Agent, BeforeToolCallContext, BeforeToolCallResult } from "@dst0/p-agent-core";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { isSafePublishCommandSequence } from "../git-command-classification.ts";
import { rejectedDefinitionNextActionGuardMessage } from "../requirement-definition-repair.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  argsRecord,
  isPotentialMutationTool,
  isPublishCommand,
  isRecord,
  isShellTool,
  pathArgument,
  shellCommand,
} from "../tool-classification.ts";
import { evidenceMutationChecklistGate } from "./completion-checklist.ts";
import { snapshotNativeToolCallContext } from "./native-tool-result-context.ts";
import { requirementDefinitionMutationGate } from "./requirement-definition-mutation-gate.ts";
import { requirementProofCommandGate } from "./requirement-proof-command-gate.ts";
import { canPotentiallyChangeWorkspace, requirementSourceMutationGate } from "./requirement-source-gate.ts";
import { runtimeWorkspaceExclusions } from "./source-mutation-tracking.ts";
import { captureSourceWorkspaceSnapshot } from "./source-workspace-snapshot.ts";
import { automaticTaskDeclarationGate } from "./task-declaration-gate.ts";
import {
  captureTestVerificationStart,
  releaseTestMutationReservation,
  reserveTestMutation,
  unverifiedTestPathsGate,
} from "./test-authoring-gate.ts";
import { focusedTestInvocation } from "./test-command-invocation.ts";
import { captureTestWorkspaceSnapshot } from "./test-workspace-snapshot.ts";
import { resolvedTaskVerificationToolEffect } from "./tool-effect-resolution.ts";
import { unknownEffectGate } from "./unknown-effect-gate.ts";
import { captureUserPrompt } from "./user-prompt-capture.ts";
export function do_install(self: TaskVerificationController, agent: Agent): void {
  if (self.installed || self.mode === "off") return;
  self.installed = true;
  const previousBeforeToolCall = agent.beforeToolCall;
  const previousAfterToolCall = agent.afterToolCall;
  agent.beforeToolCall = async (context, signal) => {
    if (!self.isAuthorizedBaselineTestMutation(context.toolCall.name, context.args)) {
      reserveTestMutation(self, context);
    }
    let previousResult: BeforeToolCallResult | undefined;
    try {
      previousResult = await previousBeforeToolCall?.(context, signal);
    } catch (error) {
      releaseTestMutationReservation(self, context.toolCall.id);
      throw error;
    }
    if (previousResult?.block) {
      releaseTestMutationReservation(self, context.toolCall.id);
      return previousResult;
    }
    releaseTestMutationReservation(self, context.toolCall.id);
    const verificationGate = self.beforeToolCall(context);
    if (verificationGate?.block) {
      releaseTestMutationReservation(self, context.toolCall.id);
      return verificationGate;
    }
    const testInvocation = isShellTool(context.toolCall.name)
      ? focusedTestInvocation(shellCommand(context.args))
      : undefined;
    const effect = resolvedTaskVerificationToolEffect(context);
    const potentialWorkspaceMutation =
      canPotentiallyChangeWorkspace(context.toolCall.name, context.args) ||
      effect.kind === "workspace_write" ||
      effect.kind === "unknown";
    const workspaceMutationAttempt =
      effect.kind === "workspace_write" || (potentialWorkspaceMutation && !testInvocation);
    const mutationAttempt = workspaceMutationAttempt || effect.kind === "external_write";
    if (mutationAttempt) {
      self.activeMutationAttempts.add(context.toolCall.id);
      self.mutationAttemptRevision += 1;
    }
    const captureShellSnapshots =
      isShellTool(context.toolCall.name) &&
      !isPublishCommand(context.toolCall.name, context.args) &&
      (workspaceMutationAttempt || testInvocation !== undefined);
    const sourceOutputPaths = (self.state.criticalProofSourceOutputs ?? []).map((output) => output.sourcePath);
    const directPath = pathArgument(context.args);
    const sourceSnapshotHints = directPath ? [...sourceOutputPaths, directPath] : sourceOutputPaths;
    if (captureShellSnapshots) {
      captureTestVerificationStart(self, context);
      const sessionFile = self.sessionManager.getSessionFile();
      const [fingerprint, testSnapshot, sourceSnapshot] = await Promise.all([
        captureWorkspaceFingerprint(self.sessionManager.getCwd(), sessionFile ? [sessionFile] : []),
        captureTestWorkspaceSnapshot(self.sessionManager.getCwd()),
        workspaceMutationAttempt || testInvocation !== undefined
          ? captureSourceWorkspaceSnapshot(
              self.sessionManager.getCwd(),
              sourceSnapshotHints,
              runtimeWorkspaceExclusions(self),
            )
          : undefined,
      ]);
      self.bashFingerprints.set(context.toolCall.id, fingerprint);
      self.workspaceTestSnapshots.set(context.toolCall.id, testSnapshot);
      if (workspaceMutationAttempt || testInvocation !== undefined) {
        self.workspaceSourceSnapshots.set(context.toolCall.id, sourceSnapshot);
      }
    } else if (workspaceMutationAttempt) {
      const [testSnapshot, sourceSnapshot] = await Promise.all([
        captureTestWorkspaceSnapshot(self.sessionManager.getCwd()),
        captureSourceWorkspaceSnapshot(
          self.sessionManager.getCwd(),
          sourceSnapshotHints,
          runtimeWorkspaceExclusions(self),
        ),
      ]);
      self.workspaceTestSnapshots.set(context.toolCall.id, testSnapshot);
      self.workspaceSourceSnapshots.set(context.toolCall.id, sourceSnapshot);
    }
    return previousResult;
  };
  agent.afterToolCall = async (context, signal) => {
    const nativeContext = snapshotNativeToolCallContext(context);
    let previousFailed = false;
    let previousError: unknown;
    let previousResult: AfterToolCallResult | undefined;
    try {
      previousResult = await previousAfterToolCall?.(context, signal);
    } catch (error) {
      previousFailed = true;
      previousError = error;
      previousResult = { isError: true };
    }
    try {
      const result = await self.afterToolCall(nativeContext, previousResult);
      if (previousFailed) throw previousError;
      return result;
    } catch (controllerError) {
      if (previousFailed && controllerError !== previousError) {
        if (previousError instanceof Error && previousError.cause === undefined) previousError.cause = controllerError;
        throw previousError;
      }
      throw controllerError;
    } finally {
      releaseTestMutationReservation(self, nativeContext.toolCall.id);
    }
  };
  agent.subscribe((event) => {
    if (event.type === "turn_start") {
      self.testMutationReservations.clear();
      self.testVerificationStarts.clear();
      self.workspaceTestSnapshots.clear();
      self.workspaceSourceSnapshots.clear();
      self.activeMutationAttempts.clear();
      self.bashFingerprints.clear();
      self.modelTurn += 1;
      return;
    }
    if (event.type !== "message_end" || event.message.role !== "user") return;
    captureUserPrompt(self, event.message);
  });
}

export function do_beforeToolCall(self: TaskVerificationController, context: BeforeToolCallContext) {
  const toolName = context.toolCall.name;
  const effect = resolvedTaskVerificationToolEffect(context);
  const publish = isPublishCommand(toolName, context.args);
  const successfulFinish =
    toolName === "finish_work" &&
    argsRecord(context.args).status !== "partial" &&
    argsRecord(context.args).status !== "failed";
  const mutatingEffect =
    effect.kind === "workspace_write" || effect.kind === "external_write" || effect.kind === "unknown";
  const guardedEffect =
    publish || successfulFinish || canPotentiallyChangeWorkspace(toolName, context.args) || mutatingEffect;
  if (self.restoreError && guardedEffect) {
    return self.blocked(`Cannot perform this effect: ${self.restoreError}.`);
  }
  if (self.mode === "audit" && self.rejectedRequirementDefinitionDraft && guardedEffect) {
    return self.blocked(rejectedDefinitionNextActionGuardMessage(self.rejectedRequirementDefinitionDraft));
  }
  const effectGate = unknownEffectGate(self, effect, toolName);
  if (effectGate) return effectGate;
  if (publish) {
    if (!isSafePublishCommandSequence(shellCommand(context.args))) {
      return self.blocked(
        "Cannot combine a workspace mutation with git commit or push; run them as separate commands.",
      );
    }
    return (
      evidenceMutationChecklistGate(self, "publish changes") ??
      unverifiedTestPathsGate(self, "publish changes") ??
      self.publishGate("publish changes")
    );
  }
  if (successfulFinish) {
    const testPathsGate = unverifiedTestPathsGate(self, "finish successfully");
    if (testPathsGate) return testPathsGate;
    const finishArgs = argsRecord(context.args);
    const token = finishArgs.verification_token;
    const gate = self.completionGate(
      "finish successfully",
      typeof token === "string" ? token : undefined,
      finishArgs.files_changed,
    );
    if (gate) return gate;
    if (isRecord(context.args) && typeof context.args.verification_token !== "string") {
      const readinessToken = self.state.readiness?.token;
      if (readinessToken) {
        context.args.verification_token = readinessToken;
      }
    }
    if (isRecord(context.args) && context.args.files_changed === undefined) {
      context.args.files_changed = [...(self.state.taskOwnedPaths ?? [])].sort();
    }
    return undefined;
  }
  if (
    self.mode === "audit" &&
    (canPotentiallyChangeWorkspace(toolName, context.args) || mutatingEffect) &&
    !self.state.taskKind
  ) {
    const declarationGate = automaticTaskDeclarationGate(self);
    if (declarationGate) return declarationGate;
  }
  if (self.mode === "audit") {
    const sourceGate = requirementSourceMutationGate(self, toolName, context.args);
    if (sourceGate) return sourceGate;
  }
  const proofCommandGate = requirementProofCommandGate(self, toolName, context.args);
  if (proofCommandGate) return proofCommandGate;
  if (self.mode === "audit") {
    const definitionGate = requirementDefinitionMutationGate(self, toolName, context.args);
    if (definitionGate) return definitionGate;
  }
  if (!isPotentialMutationTool(toolName, context.args) && !mutatingEffect) return undefined;
  const testInvocation = isShellTool(toolName) ? focusedTestInvocation(shellCommand(context.args)) : undefined;
  const declaredMutation = effect.kind === "workspace_write" || effect.kind === "external_write";
  if (declaredMutation || !testInvocation) {
    const checklistGate = evidenceMutationChecklistGate(self, "perform this mutation");
    if (checklistGate) return checklistGate;
  }
  const authorizedBaselineTestMutation = self.isAuthorizedBaselineTestMutation(toolName, context.args);
  if (self.mode === "audit" && self.state.baseline.required && self.state.baseline.status !== "satisfied") {
    if (isShellTool(toolName)) return undefined;
    if (!authorizedBaselineTestMutation) {
      return self.blocked("Collect baseline evidence or authorize exact regression-test paths before implementation.");
    }
  }
  return authorizedBaselineTestMutation ? undefined : reserveTestMutation(self, context);
}
