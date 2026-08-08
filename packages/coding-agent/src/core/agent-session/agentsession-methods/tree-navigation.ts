import {
  collectEntriesForBranchSummary,
  estimateContextTokens,
  generateBranchSummary,
  selectKeepRecentTokens,
  truncateKeptMessages,
} from "../../compaction/index.ts";
import type { SessionBeforeTreeResult, TreePreparation } from "../../extensions/index.ts";
import type { BranchSummaryEntry } from "../../session-manager.ts";
import type { AgentSession } from "../agentsession.ts";

export async function do_navigateTree(
  self: AgentSession,
  targetId: string,
  options: {
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
  } = {},
): Promise<{
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
  summaryEntry?: BranchSummaryEntry;
}> {
  const oldLeafId = self.sessionManager.getLeafId();

  // No-op if already at target
  if (targetId === oldLeafId) {
    return { cancelled: false };
  }

  // Model required for summarization
  if (options.summarize && !self.model) {
    throw new Error("No model available for summarization");
  }

  const targetEntry = self.sessionManager.getEntry(targetId);
  if (!targetEntry) {
    throw new Error(`Entry ${targetId} not found`);
  }

  // Collect entries to summarize (from old leaf to common ancestor)
  const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
    self.sessionManager,
    oldLeafId,
    targetId,
  );

  // Prepare event data - mutable so extensions can override
  let customInstructions = options.customInstructions;
  let replaceInstructions = options.replaceInstructions;
  let label = options.label;

  const preparation: TreePreparation = {
    targetId,
    oldLeafId,
    commonAncestorId,
    entriesToSummarize,
    userWantsSummary: options.summarize ?? false,
    customInstructions,
    replaceInstructions,
    label,
  };

  // Set up abort controller for summarization
  self._branchSummaryAbortController = new AbortController();

  try {
    let extensionSummary: { summary: string; details?: unknown } | undefined;
    let fromExtension = false;

    // Emit session_before_tree event
    if (self._extensionRunner.hasHandlers("session_before_tree")) {
      const result = (await self._extensionRunner.emit({
        type: "session_before_tree",
        preparation,
        signal: self._branchSummaryAbortController.signal,
      })) as SessionBeforeTreeResult | undefined;

      if (result?.cancel) {
        return { cancelled: true };
      }

      if (result?.summary && options.summarize) {
        extensionSummary = result.summary;
        fromExtension = true;
      }

      // Allow extensions to override instructions and label
      if (result?.customInstructions !== undefined) {
        customInstructions = result.customInstructions;
      }
      if (result?.replaceInstructions !== undefined) {
        replaceInstructions = result.replaceInstructions;
      }
      if (result?.label !== undefined) {
        label = result.label;
      }
    }

    // Run default summarizer if needed
    let summaryText: string | undefined;
    let summaryDetails: unknown;
    if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
      const model = self.model!;
      const { apiKey, headers } = await self._getRequiredRequestAuth(model);
      const branchSummarySettings = self.settingsManager.getBranchSummarySettings();
      const result = await generateBranchSummary(entriesToSummarize, {
        model,
        apiKey,
        headers,
        signal: self._branchSummaryAbortController.signal,
        customInstructions,
        replaceInstructions,
        reserveTokens: branchSummarySettings.reserveTokens,
        streamFn: self.agent.streamFn,
      });
      if (result.aborted) {
        return { cancelled: true, aborted: true };
      }
      if (result.error) {
        throw new Error(result.error);
      }
      summaryText = result.summary;
      summaryDetails = {
        readFiles: result.readFiles || [],
        modifiedFiles: result.modifiedFiles || [],
      };
    } else if (extensionSummary) {
      summaryText = extensionSummary.summary;
      summaryDetails = extensionSummary.details;
    }

    // Determine the new leaf position based on target type
    let newLeafId: string | null;
    let editorText: string | undefined;

    if (targetEntry.type === "message" && targetEntry.message.role === "user") {
      // User message: leaf = parent (null if root), text goes to editor
      newLeafId = targetEntry.parentId;
      editorText = self._extractUserMessageText(targetEntry.message.content);
    } else if (targetEntry.type === "custom_message") {
      // Custom message: leaf = parent (null if root), text goes to editor
      newLeafId = targetEntry.parentId;
      editorText =
        typeof targetEntry.content === "string"
          ? targetEntry.content
          : targetEntry.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("");
    } else {
      // Non-user message: leaf = selected node
      newLeafId = targetId;
    }

    // Switch leaf (with or without summary)
    // Summary is attached at the navigation target position (newLeafId), not the old branch
    let summaryEntry: BranchSummaryEntry | undefined;
    if (summaryText) {
      // Create summary at target position (can be null for root)
      const summaryId = self.sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension);
      summaryEntry = self.sessionManager.getEntry(summaryId) as BranchSummaryEntry;

      // Attach label to the summary entry
      if (label) {
        self.sessionManager.appendLabelChange(summaryId, label);
      }
    } else if (newLeafId === null) {
      // No summary, navigating to root - reset leaf
      self.sessionManager.resetLeaf();
    } else {
      // No summary, navigating to non-root
      self.sessionManager.branch(newLeafId);
    }

    // Attach label to target entry when not summarizing (no summary entry to label)
    if (label && !summaryText) {
      self.sessionManager.appendLabelChange(targetId, label);
    }

    // Update agent state
    const sessionContext = self.sessionManager.buildSessionContext();
    const settings = self.settingsManager.getCompactionSettings();
    const systemPromptTokens = self.systemPrompt ? Math.ceil(self.systemPrompt.length / 4) : 0;
    const keepRecentTokens = selectKeepRecentTokens(
      estimateContextTokens(sessionContext.messages, self.systemPrompt).tokens,
      settings,
    );
    self.agent.state.messages = truncateKeptMessages(sessionContext.messages, {
      keepRecentTokens,
      targetContextTokens: settings.targetContextTokens,
      systemPromptTokens,
    });

    // Emit session_tree event
    await self._extensionRunner.emit({
      type: "session_tree",
      newLeafId: self.sessionManager.getLeafId(),
      oldLeafId,
      summaryEntry,
      fromExtension: summaryText ? fromExtension : undefined,
    });

    // Emit to custom tools

    return { editorText, cancelled: false, summaryEntry };
  } finally {
    self._branchSummaryAbortController = undefined;
  }
}
