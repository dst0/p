/**
 * Subagent Tool - Delegate tasks to specialized agents.
 *
 * Supports single, parallel, and sequential chain execution in isolated p
 * processes while retaining the parent model and thinking level by default.
 */

import type { ExtensionAPI } from "@dst0/p";
import { createSubagentExecutor } from "./executor.ts";
import { SubagentParams } from "./parameters.ts";
import { renderSubagentCall } from "./render-call.ts";
import { renderSubagentResult } from "./render-result.ts";

export default function subagentExtension(p: ExtensionAPI): void {
  p.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate tasks to specialized subagents with isolated context.",
      "Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
      'Default agent scope is "user" (from ~/.p/agent/agents).',
      'To enable project-local agents in .p/agents, set agentScope: "both" (or "project").',
      "Project-local agents require interactive confirmation or an explicitly trusted project in headless mode.",
    ].join(" "),
    parameters: SubagentParams,
    execute: createSubagentExecutor(p),
    renderCall: renderSubagentCall,
    renderResult: renderSubagentResult,
  });
}
