import { getMarkdownTheme } from "@dst0/p";
import { Container, Markdown, Spacer, Text } from "@dst0/p-tui";
import {
  type DisplayItem,
  formatToolCall,
  formatUsageStats,
  getDisplayItems,
  getFinalOutput,
  isFailedResult,
  type SingleResult,
  type SubagentDetails,
} from "./formatters.ts";
import type { SubagentToolDefinition } from "./parameters.ts";

const COLLAPSED_ITEM_COUNT = 10;

export const renderSubagentResult: NonNullable<SubagentToolDefinition["renderResult"]> = (
  result,
  { expanded },
  theme,
) => {
  const details = result.details as SubagentDetails | undefined;
  if (!details || details.results.length === 0) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }
  const markdownTheme = getMarkdownTheme();
  const renderDisplayItems = (items: DisplayItem[], limit?: number): string => {
    const toShow = limit ? items.slice(-limit) : items;
    const skipped = limit && items.length > limit ? items.length - limit : 0;
    let text = skipped > 0 ? theme.fg("muted", `... ${skipped} earlier items\n`) : "";
    for (const item of toShow) {
      if (item.type === "text") {
        const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
        text += `${theme.fg("toolOutput", preview)}\n`;
      } else {
        text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
      }
    }
    return text.trimEnd();
  };
  const aggregateUsage = (results: SingleResult[]) => {
    const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
    for (const current of results) {
      total.input += current.usage.input;
      total.output += current.usage.output;
      total.cacheRead += current.usage.cacheRead;
      total.cacheWrite += current.usage.cacheWrite;
      total.cost += current.usage.cost;
      total.turns += current.usage.turns;
    }
    return total;
  };

  if (details.mode === "single" && details.results.length === 1) {
    const current = details.results[0];
    const isError = isFailedResult(current);
    const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
    const displayItems = getDisplayItems(current.messages);
    const finalOutput = getFinalOutput(current.messages);
    if (expanded) {
      const container = new Container();
      let header = `${icon} ${theme.fg("toolTitle", theme.bold(current.agent))}${theme.fg("muted", ` (${current.agentSource})`)}`;
      if (isError && current.stopReason) header += ` ${theme.fg("error", `[${current.stopReason}]`)}`;
      container.addChild(new Text(header, 0, 0));
      if (isError && current.errorMessage) {
        container.addChild(new Text(theme.fg("error", `Error: ${current.errorMessage}`), 0, 0));
      }
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
      container.addChild(new Text(theme.fg("dim", current.task), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
      if (displayItems.length === 0 && !finalOutput) {
        container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
      } else {
        for (const item of displayItems) {
          if (item.type === "toolCall") {
            container.addChild(
              new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0),
            );
          }
        }
        if (finalOutput) {
          container.addChild(new Spacer(1));
          container.addChild(new Markdown(finalOutput.trim(), 0, 0, markdownTheme));
        }
      }
      const usage = formatUsageStats(current.usage, current.model);
      if (usage) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", usage), 0, 0));
      }
      return container;
    }
    let text = `${icon} ${theme.fg("toolTitle", theme.bold(current.agent))}${theme.fg("muted", ` (${current.agentSource})`)}`;
    if (isError && current.stopReason) text += ` ${theme.fg("error", `[${current.stopReason}]`)}`;
    if (isError && current.errorMessage) text += `\n${theme.fg("error", `Error: ${current.errorMessage}`)}`;
    else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
    else {
      text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
      if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
    const usage = formatUsageStats(current.usage, current.model);
    if (usage) text += `\n${theme.fg("dim", usage)}`;
    return new Text(text, 0, 0);
  }

  if (details.mode === "chain") {
    const successCount = details.results.filter((current) => current.exitCode === 0).length;
    const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");
    if (expanded) {
      const container = new Container();
      container.addChild(
        new Text(
          `${icon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`,
          0,
          0,
        ),
      );
      for (const current of details.results) {
        const currentIcon = current.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
        const displayItems = getDisplayItems(current.messages);
        const finalOutput = getFinalOutput(current.messages);
        container.addChild(new Spacer(1));
        container.addChild(
          new Text(
            `${theme.fg("muted", `─── Step ${current.step}: `) + theme.fg("accent", current.agent)} ${currentIcon}`,
            0,
            0,
          ),
        );
        container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", current.task), 0, 0));
        for (const item of displayItems) {
          if (item.type === "toolCall") {
            container.addChild(
              new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0),
            );
          }
        }
        if (finalOutput) {
          container.addChild(new Spacer(1));
          container.addChild(new Markdown(finalOutput.trim(), 0, 0, markdownTheme));
        }
        const usage = formatUsageStats(current.usage, current.model);
        if (usage) container.addChild(new Text(theme.fg("dim", usage), 0, 0));
      }
      const usage = formatUsageStats(aggregateUsage(details.results));
      if (usage) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", `Total: ${usage}`), 0, 0));
      }
      return container;
    }
    let text = `${icon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`;
    for (const current of details.results) {
      const currentIcon = current.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
      const displayItems = getDisplayItems(current.messages);
      text += `\n\n${theme.fg("muted", `─── Step ${current.step}: `)}${theme.fg("accent", current.agent)} ${currentIcon}`;
      text +=
        displayItems.length === 0
          ? `\n${theme.fg("muted", "(no output)")}`
          : `\n${renderDisplayItems(displayItems, 5)}`;
    }
    const usage = formatUsageStats(aggregateUsage(details.results));
    if (usage) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
    return new Text(`${text}\n${theme.fg("muted", "(Ctrl+O to expand)")}`, 0, 0);
  }

  const running = details.results.filter((current) => current.exitCode === -1).length;
  const successCount = details.results.filter((current) => current.exitCode !== -1 && !isFailedResult(current)).length;
  const failCount = details.results.filter((current) => current.exitCode !== -1 && isFailedResult(current)).length;
  const isRunning = running > 0;
  const icon = isRunning
    ? theme.fg("warning", "⏳")
    : failCount > 0
      ? theme.fg("warning", "◐")
      : theme.fg("success", "✓");
  const status = isRunning
    ? `${successCount + failCount}/${details.results.length} done, ${running} running`
    : `${successCount}/${details.results.length} tasks`;
  if (expanded && !isRunning) {
    const container = new Container();
    container.addChild(
      new Text(`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`, 0, 0),
    );
    for (const current of details.results) {
      const currentIcon = isFailedResult(current) ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const displayItems = getDisplayItems(current.messages);
      const finalOutput = getFinalOutput(current.messages);
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", current.agent)} ${currentIcon}`, 0, 0),
      );
      container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", current.task), 0, 0));
      for (const item of displayItems) {
        if (item.type === "toolCall") {
          container.addChild(
            new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0),
          );
        }
      }
      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, markdownTheme));
      }
      const usage = formatUsageStats(current.usage, current.model);
      if (usage) container.addChild(new Text(theme.fg("dim", usage), 0, 0));
    }
    const usage = formatUsageStats(aggregateUsage(details.results));
    if (usage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", `Total: ${usage}`), 0, 0));
    }
    return container;
  }
  let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
  for (const current of details.results) {
    const currentIcon =
      current.exitCode === -1
        ? theme.fg("warning", "⏳")
        : isFailedResult(current)
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");
    const displayItems = getDisplayItems(current.messages);
    text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", current.agent)} ${currentIcon}`;
    text +=
      displayItems.length === 0
        ? `\n${theme.fg("muted", current.exitCode === -1 ? "(running...)" : "(no output)")}`
        : `\n${renderDisplayItems(displayItems, 5)}`;
  }
  if (!isRunning) {
    const usage = formatUsageStats(aggregateUsage(details.results));
    if (usage) text += `\n\n${theme.fg("dim", `Total: ${usage}`)}`;
  }
  if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
  return new Text(text, 0, 0);
};
