import type {
  AfterToolCallResult,
  Agent,
  AgentMessage,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@dst0/p-agent-core";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { isSafePublishCommandSequence } from "../git-command-classification.ts";
import { rejectedDefinitionNextActionGuardMessage } from "../requirement-definition-repair.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
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

const NON_REQUIREMENT_NUDGE_PATTERN =
  /^(?:(?:any\s+)?(?:progress|status|update)|so|how(?:'s|\s+is)\s+it\s+going|where\s+are\s+we|what(?:'s|\s+is)\s+the\s+status|(?:please\s+)?(?:continue|proceed|go\s+on|keep\s+going|carry\s+on)|(?:please\s+)?(?:report|show|give\s+me)\s+(?:the\s+)?(?:progress|status|update))\s*[?!.]*$/iu;
const COMPLETION_NUDGE_PATTERN =
  /^are\s+you\s+(?:done|finished)(?:\s+with\s+(?:the\s+)?task)?\s+or\s+is\s+there\s+(?:anything|something)\s+left\s*[?!.]*\s*if\s+you\s+are\s+finished\s*,?\s*(?:ensure|make\s+sure)(?:\s+that)?\s+all\s+requirements\s+(?:are\s+)?(?:satisfied|met)(?:\s+and\s+(?:create|write)\s+[\p{L}\p{N}_./-]+\.(?:adoc|md|mdx|rst|txt))?\s*[?!.]*$/iu;
const NUDGE_DOCUMENT_PATH_PATTERN = /[\p{L}\p{N}_./-]+\.(?:adoc|md|mdx|rst|txt)\b/giu;

export function do_install(self: TaskVerificationController, agent: Agent): void {
  if (self.installed || self.mode === "off") return;
  self.installed = true;
  const previousBeforeToolCall = agent.beforeToolCall;
  const previousAfterToolCall = agent.afterToolCall;
  agent.beforeToolCall = async (context, signal) => {
    const verificationGate = self.beforeToolCall(context);
    if (verificationGate?.block) return verificationGate;
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
    const testInvocation = isShellTool(context.toolCall.name)
      ? focusedTestInvocation(shellCommand(context.args))
      : undefined;
    const effect = resolvedTaskVerificationToolEffect(context);
    const potentialWorkspaceMutation =
      canPotentiallyChangeWorkspace(context.toolCall.name, context.args) ||
      effect.kind === "workspace_write" ||
      effect.kind === "unknown";
    const workspaceMutationAttempt = potentialWorkspaceMutation && !testInvocation;
    const mutationAttempt = workspaceMutationAttempt || effect.kind === "external_write";
    if (mutationAttempt) {
      self.activeMutationAttempts.add(context.toolCall.id);
      self.mutationAttemptRevision += 1;
    }
    const captureShellSnapshots =
      isShellTool(context.toolCall.name) &&
      !isPublishCommand(context.toolCall.name, context.args) &&
      (workspaceMutationAttempt || testInvocation !== undefined);
    if (captureShellSnapshots) {
      captureTestVerificationStart(self, context);
      const sessionFile = self.sessionManager.getSessionFile();
      const [fingerprint, testSnapshot, sourceSnapshot] = await Promise.all([
        captureWorkspaceFingerprint(self.sessionManager.getCwd(), sessionFile ? [sessionFile] : []),
        captureTestWorkspaceSnapshot(self.sessionManager.getCwd()),
        workspaceMutationAttempt
          ? captureSourceWorkspaceSnapshot(
              self.sessionManager.getCwd(),
              pathArgument(context.args) ? [pathArgument(context.args)!] : [],
              runtimeWorkspaceExclusions(self),
            )
          : undefined,
      ]);
      self.bashFingerprints.set(context.toolCall.id, fingerprint);
      self.workspaceTestSnapshots.set(context.toolCall.id, testSnapshot);
      if (workspaceMutationAttempt) {
        self.workspaceSourceSnapshots.set(context.toolCall.id, sourceSnapshot);
      }
    } else if (workspaceMutationAttempt) {
      const directPath = pathArgument(context.args);
      const [testSnapshot, sourceSnapshot] = await Promise.all([
        captureTestWorkspaceSnapshot(self.sessionManager.getCwd()),
        captureSourceWorkspaceSnapshot(
          self.sessionManager.getCwd(),
          directPath ? [directPath] : [],
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

function captureUserPrompt(self: TaskVerificationController, message: Extract<AgentMessage, { role: "user" }>): void {
  if (isRecord(message.metadata) && message.metadata.pInternal !== undefined) return;
  const promptText =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  if (!promptText.trim()) return;
  self.latestUserPrompt = promptText;
  if (self.restoreError) return;
  const taskPrompts = self.state.taskPrompts ?? [];
  if (isNonRequirementNudge(promptText, taskPrompts)) return;
  const activeRejectedDraft = self.rejectedRequirementDefinitionDraft;
  const persistedId = [...self.sessionManager.getBranch()]
    .reverse()
    .find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        entry.message.timestamp === message.timestamp &&
        userMessageText(entry.message) === promptText,
    )?.id;
  self.state = {
    ...self.state,
    requirementDefinitionPolicy:
      self.mode === "audit"
        ? (self.state.requirementDefinitionPolicy ?? (self.state.mutationRevision > 0 ? 1 : undefined))
        : undefined,
    taskPrompts: [
      ...taskPrompts,
      {
        id: persistedId ?? `user-${message.timestamp}-${taskPrompts.length + 1}`,
        text: promptText,
      },
    ],
    readiness: emptyReadiness(),
    requirementAudit:
      self.mode === "audit"
        ? activeRejectedDraft
          ? self.state.requirementAudit
          : emptyRequirementAudit()
        : self.state.requirementAudit,
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
}

function isNonRequirementNudge(promptText: string, taskPrompts: readonly { text: string }[]): boolean {
  const normalized = promptText.trim();
  if (NON_REQUIREMENT_NUDGE_PATTERN.test(normalized)) return true;
  if (!COMPLETION_NUDGE_PATTERN.test(normalized) || taskPrompts.length === 0) return false;
  const priorText = taskPrompts
    .map((prompt) => prompt.text)
    .join("\n")
    .toLowerCase();
  const mentionedPaths = [...normalized.matchAll(NUDGE_DOCUMENT_PATH_PATTERN)].map((match) => match[0].toLowerCase());
  return mentionedPaths.every((path) => priorText.includes(path));
}

function userMessageText(message: Extract<AgentMessage, { role: "user" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
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
  if (publish) {
    if (!isSafePublishCommandSequence(shellCommand(context.args))) {
      return self.blocked(
        "Cannot combine a workspace mutation with git commit or push; run them as separate commands.",
      );
    }
    return unverifiedTestPathsGate(self, "publish changes") ?? self.publishGate("publish changes");
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
    const proofCommandGate = requirementProofCommandGate(self, toolName, context.args);
    if (proofCommandGate) return proofCommandGate;
    const definitionGate = requirementDefinitionMutationGate(self, toolName, context.args);
    if (definitionGate) return definitionGate;
  }
  if (!isPotentialMutationTool(toolName, context.args) && !mutatingEffect) return undefined;
  const authorizedBaselineTestMutation = self.isAuthorizedBaselineTestMutation(toolName, context.args);
  if (self.mode === "audit" && self.state.baseline.required && self.state.baseline.status !== "satisfied") {
    if (isShellTool(toolName)) return undefined;
    if (!authorizedBaselineTestMutation) {
      return self.blocked("Collect baseline evidence or authorize exact regression-test paths before implementation.");
    }
  }
  return authorizedBaselineTestMutation ? undefined : reserveTestMutation(self, context);
}
