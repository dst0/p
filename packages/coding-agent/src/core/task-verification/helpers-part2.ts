import type { SessionManager } from "../session-manager.ts";
import {
  ACCEPTANCE_SIGNAL_PATTERN,
  BUG_PATTERN,
  TEST_OPT_OUT_PATTERN,
  TEST_REQUEST_PATTERN,
  TYPECHECK_OPT_OUT_PATTERN,
  TYPECHECK_REQUEST_PATTERN,
} from "./constants.ts";
import { TaskVerificationController } from "./taskverificationcontroller.ts";
import type { TaskKind } from "./types.ts";

export function baselineRequired(kind: TaskKind, taskText: string): boolean {
  return kind === "bug_fix" || kind === "behavior_change" || kind === "refactor" || BUG_PATTERN.test(taskText);
}

export function behavioralFinalRequired(kind: TaskKind, taskText: string): boolean {
  return kind !== "docs" && kind !== "investigation" && (kind !== "feature" || BUG_PATTERN.test(taskText));
}

export function isCodeTask(kind: TaskKind | undefined): boolean {
  return kind !== undefined && kind !== "docs" && kind !== "investigation";
}

export function requiredAcceptanceCheckCount(taskText: string): number {
  const signals = taskText.match(ACCEPTANCE_SIGNAL_PATTERN) ?? [];
  const uniqueSignals = new Set(signals.map((signal) => signal.toLowerCase()));
  return Math.max(1, Math.min(4, uniqueSignals.size));
}

export function testsRequested(taskText: string): boolean {
  return TEST_REQUEST_PATTERN.test(taskText) && !TEST_OPT_OUT_PATTERN.test(taskText);
}

export function typecheckRequested(taskText: string): boolean {
  return TYPECHECK_REQUEST_PATTERN.test(taskText) && !TYPECHECK_OPT_OUT_PATTERN.test(taskText);
}

export function createTaskVerificationController(sessionManager: SessionManager): TaskVerificationController {
  return new TaskVerificationController(sessionManager);
}
