import { Text } from "@dst0/p-tui";
import type { AgentScope } from "./agents.ts";
import type { SubagentToolDefinition } from "./parameters.ts";

export const renderSubagentCall: NonNullable<SubagentToolDefinition["renderCall"]> = (args, theme) => {
  const scope: AgentScope = args.agentScope ?? "user";
  if (args.chain && args.chain.length > 0) {
    let text =
      theme.fg("toolTitle", theme.bold("subagent ")) +
      theme.fg("accent", `chain (${args.chain.length} steps)`) +
      theme.fg("muted", ` [${scope}]`);
    for (let index = 0; index < Math.min(args.chain.length, 3); index++) {
      const step = args.chain[index];
      const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
      const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
      text +=
        "\n  " +
        theme.fg("muted", `${index + 1}.`) +
        " " +
        theme.fg("accent", step.agent) +
        theme.fg("dim", ` ${preview}`);
    }
    if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }
  if (args.tasks && args.tasks.length > 0) {
    let text =
      theme.fg("toolTitle", theme.bold("subagent ")) +
      theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
      theme.fg("muted", ` [${scope}]`);
    for (const task of args.tasks.slice(0, 3)) {
      const preview = task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
      text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
    }
    if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }
  const agentName = args.agent || "...";
  const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
  const text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", agentName) +
    theme.fg("muted", ` [${scope}]`) +
    `\n  ${theme.fg("dim", preview)}`;
  return new Text(text, 0, 0);
};
