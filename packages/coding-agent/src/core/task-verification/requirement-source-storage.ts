import type { SessionEntry } from "../session-manager/types.ts";
import type { SessionManager } from "../session-manager.ts";
import { TASK_VERIFICATION_REQUIREMENT_SOURCE_CUSTOM_TYPE } from "./constants.ts";
import type { PreparedRequirementSource } from "./referenced-requirement-sources.ts";
import { sourcePromptsForState } from "./requirement-audit-hashing.ts";
import { orderRequirementDefinitionSources } from "./requirement-source-catalog-order.ts";
import { hashRequirementSourceText, requirementSourceTextSafetyError } from "./requirement-source-file.ts";
import type {
  TaskVerificationRequirementSourceRef,
  TaskVerificationRequirementSourceSnapshot,
  TaskVerificationSourcePrompt,
  TaskVerificationState,
} from "./types.ts";

export function persistRequirementSourceSnapshots(
  sessionManager: SessionManager,
  state: TaskVerificationState,
  sources: readonly PreparedRequirementSource[],
): TaskVerificationRequirementSourceRef[] {
  const definitionSourcePromptCount = sourcePromptsForState(state).length;
  return sources.map((source) => {
    const snapshot: TaskVerificationRequirementSourceSnapshot = {
      version: 1,
      taskId: state.taskId,
      sourceId: source.id,
      path: source.path,
      sha256: source.sha256,
      byteLength: source.byteLength,
      referencedByPromptIds: source.referencedByPromptIds,
      definitionSourcePromptCount,
      capturedAtMutationRevision: state.mutationRevision,
      text: source.text,
    };
    const snapshotEntryId = sessionManager.appendCustomEntry(
      TASK_VERIFICATION_REQUIREMENT_SOURCE_CUSTOM_TYPE,
      snapshot,
    );
    return {
      id: source.id,
      path: source.path,
      sha256: source.sha256,
      byteLength: source.byteLength,
      snapshotEntryId,
      referencedByPromptIds: source.referencedByPromptIds,
      definitionSourcePromptCount,
      capturedAtMutationRevision: state.mutationRevision,
      origin: "requirement_audit.prepare_definition",
      policyVersion: 1,
    };
  });
}

export function requirementDefinitionSources(
  state: TaskVerificationState,
  sourceTexts: ReadonlyMap<string, string>,
): TaskVerificationSourcePrompt[] | string {
  const prompts = sourcePromptsForState(state);
  const referenced = (state.requirementSourceRefs ?? []).map((reference) => {
    const text = sourceTexts.get(reference.id);
    if (text === undefined) return undefined;
    return {
      promptCount: reference.definitionSourcePromptCount,
      source: {
        id: reference.id,
        kind: "referenced_file" as const,
        path: reference.path,
        sha256: reference.sha256,
        text,
      },
    };
  });
  if (referenced.some((source) => source === undefined)) {
    return "A prepared requirement-source snapshot is unavailable; restart the task definition.";
  }
  const available = referenced as NonNullable<(typeof referenced)[number]>[];
  return orderRequirementDefinitionSources(prompts, available);
}

export function restoreRequirementSourceTexts(
  branch: readonly SessionEntry[],
  state: TaskVerificationState,
  target: Map<string, string>,
): string | undefined {
  target.clear();
  for (const reference of state.requirementSourceRefs ?? []) {
    const entry = branch.find((candidate) => candidate.id === reference.snapshotEntryId);
    if (
      !entry ||
      entry.type !== "custom" ||
      entry.customType !== TASK_VERIFICATION_REQUIREMENT_SOURCE_CUSTOM_TYPE ||
      !isRequirementSourceSnapshot(entry.data) ||
      !snapshotMatchesReference(entry.data, reference, state.taskId)
    ) {
      target.clear();
      return `requirement-source snapshot ${reference.path} is missing or corrupt`;
    }
    target.set(reference.id, entry.data.text);
  }
  return undefined;
}

function snapshotMatchesReference(
  snapshot: TaskVerificationRequirementSourceSnapshot,
  reference: TaskVerificationRequirementSourceRef,
  taskId: string,
): boolean {
  const safetyError = requirementSourceTextSafetyError(snapshot.text);
  return (
    safetyError === undefined &&
    snapshot.taskId === taskId &&
    snapshot.sourceId === reference.id &&
    snapshot.path === reference.path &&
    snapshot.sha256 === reference.sha256 &&
    snapshot.byteLength === reference.byteLength &&
    snapshot.capturedAtMutationRevision === reference.capturedAtMutationRevision &&
    arraysEqual(snapshot.referencedByPromptIds, reference.referencedByPromptIds) &&
    snapshot.definitionSourcePromptCount === reference.definitionSourcePromptCount &&
    Buffer.byteLength(snapshot.text) === snapshot.byteLength &&
    hashRequirementSourceText(snapshot.text) === snapshot.sha256
  );
}

function isRequirementSourceSnapshot(value: unknown): value is TaskVerificationRequirementSourceSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.taskId === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.path === "string" &&
    typeof value.sha256 === "string" &&
    Number.isInteger(value.byteLength) &&
    Number(value.byteLength) >= 0 &&
    Array.isArray(value.referencedByPromptIds) &&
    value.referencedByPromptIds.every((item) => typeof item === "string") &&
    Number.isSafeInteger(value.definitionSourcePromptCount) &&
    Number(value.definitionSourcePromptCount) > 0 &&
    Number.isInteger(value.capturedAtMutationRevision) &&
    Number(value.capturedAtMutationRevision) >= 0 &&
    typeof value.text === "string"
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
