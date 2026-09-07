import { relative, resolve } from "node:path";
import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { tokenizeShellCommands } from "../git-command-classification.ts";
import { updatedMutatedSourcePaths } from "../source-path-state.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool, pathArgument, shellCommand } from "../tool-classification.ts";
import {
  captureSourceWorkspaceSnapshot,
  changedSourcePaths,
  type SourceWorkspaceSnapshot,
} from "./source-workspace-snapshot.ts";

export interface SourceWorkspaceMutation {
  paths: string[];
  trackingFailed: boolean;
  before?: SourceWorkspaceSnapshot;
  after?: SourceWorkspaceSnapshot;
}

export function recordSourceMutationPaths(
  self: TaskVerificationController,
  candidates: readonly string[],
  trackingFailed: boolean,
): void {
  const tracking = updatedMutatedSourcePaths(
    self.state.mutatedSourcePaths ?? [],
    candidates,
    (self.state.mutatedSourcePathOverflow ?? false) || trackingFailed,
  );
  self.state = {
    ...self.state,
    mutatedSourcePaths: tracking.paths,
    mutatedSourcePathOverflow: tracking.overflow,
  };
}

export function mutationSourcePaths(self: TaskVerificationController, context: AfterToolCallContext): string[] {
  const directPath = pathArgument(context.args);
  const candidates = directPath
    ? [directPath]
    : isShellTool(context.toolCall.name)
      ? tokenizeShellCommands(shellCommand(context.args)).flat()
      : [];
  const cwd = self.sessionManager.getCwd();
  return [
    ...new Set(
      candidates
        .map((candidate) => relative(cwd, resolve(cwd, candidate)).replaceAll("\\", "/"))
        .filter((candidate) => candidate !== ".." && !candidate.startsWith("../")),
    ),
  ];
}

export function runtimeWorkspaceExclusions(self: TaskVerificationController): string[] {
  const sessionFile = self.sessionManager.getSessionFile();
  if (!sessionFile) return [];
  const filePath = relative(self.sessionManager.getCwd(), sessionFile).replaceAll("\\", "/");
  return filePath === ".." || filePath.startsWith("../") ? [] : [filePath];
}

export async function settleSourceWorkspaceMutation(
  self: TaskVerificationController,
  context: AfterToolCallContext,
): Promise<SourceWorkspaceMutation> {
  const captured = self.workspaceSourceSnapshots.has(context.toolCall.id);
  const before = self.workspaceSourceSnapshots.get(context.toolCall.id);
  self.workspaceSourceSnapshots.delete(context.toolCall.id);
  if (!captured) return { paths: [], trackingFailed: false };
  const directPath = pathArgument(context.args);
  const sourceOutputPaths = (self.state.criticalProofSourceOutputs ?? []).map((output) => output.sourcePath);
  const after = await captureSourceWorkspaceSnapshot(
    self.sessionManager.getCwd(),
    directPath ? [...sourceOutputPaths, directPath] : sourceOutputPaths,
    runtimeWorkspaceExclusions(self),
  );
  if (!after) return { paths: [], trackingFailed: true };
  return before
    ? { paths: changedSourcePaths(before, after), trackingFailed: false, before, after }
    : { paths: [...after.keys()], trackingFailed: false, after };
}
