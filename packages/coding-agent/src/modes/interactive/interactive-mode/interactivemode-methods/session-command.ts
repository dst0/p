import { Spacer, Text } from "@dst0/p-tui";
import { getOrderedPlanTree, renderPlanStatusMarker, STATE_RENDER_MARKERS } from "../../../../core/compaction/index.ts";
import { formatTokenBreakdown } from "../../../../core/token-accounting.ts";
import { copyToClipboard } from "../../../../utils/clipboard.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_handleCopyCommand(self: InteractiveMode): Promise<void> {
  const text = self.session.getLastAssistantText();
  if (!text) {
    self.showError("No agent messages to copy yet.");
    return;
  }

  try {
    await copyToClipboard(text);
    self.showStatus("Copied last agent message to clipboard");
  } catch (error) {
    self.showError(error instanceof Error ? error.message : String(error));
  }
}

export function do_handleNameCommand(self: InteractiveMode, text: string): void {
  const name = text.replace(/^\/name\s*/, "").trim();
  if (!name) {
    const currentName = self.sessionManager.getSessionName();
    if (currentName) {
      self.chatContainer.addChild(new Spacer(1));
      self.chatContainer.addChild(new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0));
    } else {
      self.showWarning("Usage: /name <name>");
    }
    self.ui.requestRender();
    return;
  }

  self.session.setSessionName(name);
  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0));
  self.ui.requestRender();
}

export function do_handleSessionCommand(self: InteractiveMode): void {
  const stats = self.session.getSessionStats();
  const sessionName = self.sessionManager.getSessionName();

  let info = `${theme.bold("Session Info")}\n\n`;
  if (sessionName) {
    info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
  }
  info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
  info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
  info += `${theme.bold("Messages")}\n`;
  info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
  info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
  info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
  info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
  info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
  info += `${theme.bold("Tokens")}\n`;
  info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
  info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
  if (stats.tokens.cacheRead > 0) {
    info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
  }
  if (stats.tokens.cacheWrite > 0) {
    info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
  }
  info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

  if (stats.cost > 0) {
    info += `\n${theme.bold("Cost")}\n`;
    info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
  }

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Text(info, 1, 0));
  self.ui.requestRender();
}

export function do_handleStateCommand(self: InteractiveMode): void {
  const snapshot = self.session.getSessionStateSnapshot();
  const stats = self.session.getSessionStats();
  const context = snapshot.contextUsage;
  const audit = snapshot.lastCompaction?.audit;
  const state = snapshot.state;
  let info = `${theme.bold("Session State")}\n\n`;
  info += `${theme.fg("dim", "Session:")} ${snapshot.sessionId}\n`;
  info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
  if (context) {
    const promptTokens = (context.tokenBreakdown?.total ?? context.tokens)?.toLocaleString() ?? "unknown";
    const dynamicTokens = context.tokens?.toLocaleString() ?? "unknown";
    const triggerThreshold = context.triggerThreshold?.toLocaleString() ?? "unknown";
    const targetContextTokens = context.targetContextTokens?.toLocaleString() ?? "unknown";
    info += `${theme.fg("dim", "Prompt:")} ${promptTokens}/${context.contextWindow.toLocaleString()} tokens\n`;
    info += `${theme.fg("dim", "Dynamic:")} ${dynamicTokens} tokens\n`;
    info += `${theme.fg("dim", "Static:")} ${context.staticTokens.toLocaleString()} tokens\n`;
    info += `${theme.fg("dim", "Trigger:")} ${triggerThreshold} tokens\n`;
    info += `${theme.fg("dim", "Target:")} ${targetContextTokens} tokens\n`;
    info += `${theme.fg("dim", "Should compact:")} ${context.shouldCompact ? "yes" : "no"}\n`;
    if (context.tokenBreakdown) {
      info += `\n${theme.bold("Token Breakdown")}\n${formatTokenBreakdown(context.tokenBreakdown)}\n`;
    }
  }
  const appendSection = (title: string, lines: string[]): void => {
    if (lines.length === 0) return;
    info += `\n${theme.bold(`${title}:`)}\n${lines.join("\n")}\n`;
  };
  appendSection(
    "Plan",
    state.plan.length > 0
      ? getOrderedPlanTree(state.plan).map(({ item, depth, isLastChild, active }) => {
          const indent = depth > 0 ? `${"  ".repeat(depth - 1)}${isLastChild ? "└─ " : "├─ "}` : "";
          const activeText = active ? " 👈 (active)" : "";
          return `${indent}${renderPlanStatusMarker(item.status)} ${item.text}${activeText}`;
        })
      : [`${STATE_RENDER_MARKERS.notStarted} (none)`],
  );
  appendSection(
    "Decisions",
    state.decisions
      .filter((decision) => decision.status === "active")
      .map((decision) => `• ${decision.decision}${decision.rationale ? `: ${decision.rationale}` : ""}`)
      .concat(state.decisions.some((decision) => decision.status === "active") ? [] : ["• (none)"]),
  );
  appendSection(
    "Files",
    state.codebase.touchedFiles.length > 0
      ? state.codebase.touchedFiles.map((file) => `• ${file.status}: ${file.path} - ${file.summary}`)
      : ["• (none)"],
  );
  appendSection(
    "Risks",
    state.audit.knownRisks.length > 0
      ? state.audit.knownRisks.map((risk) => `${STATE_RENDER_MARKERS.risk} ${risk}`)
      : [`${STATE_RENDER_MARKERS.risk} (none)`],
  );
  const guardrails = self.session.evaluateGuardrails("final");
  const visibleGuardrails = guardrails.results.filter((result) => !result.ok || result.id === "dirty-worktree-final");
  if (visibleGuardrails.length > 0) {
    info += `\n${theme.bold("Guardrails")}\n`;
    info += visibleGuardrails.map((result) => `- [${result.severity}] ${result.message}`).join("\n");
    info += "\n";
  }
  if (snapshot.lastCompaction) {
    info += `\n${theme.bold("Last Compaction")}\n`;
    info += `${theme.fg("dim", "Entry:")} ${snapshot.lastCompaction.id}\n`;
    info += `${theme.fg("dim", "At:")} ${snapshot.lastCompaction.timestamp}\n`;
    if (audit) {
      info += `${theme.fg("dim", "Audit:")} ${audit.beforeTokens} -> ${audit.afterTokens}, saved ${audit.savedTokens}\n`;
    }
  }

  self.chatContainer.addChild(new Spacer(1));
  self.chatContainer.addChild(new Text(info, 1, 0));
  self.ui.requestRender();
}
