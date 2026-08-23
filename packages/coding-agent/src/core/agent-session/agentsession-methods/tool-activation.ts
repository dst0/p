import { type AgentTool, type CompletionMode, FINISH_WORK_TOOL_NAME, type ThinkingLevel } from "@dst0/p-agent-core";
import type { Model } from "@dst0/p-ai";
import { selectProjectInstructionPromptForTools } from "../../project-instructions/index.ts";
import { buildSystemPrompt } from "../../system-prompt.ts";
import type { AgentSession } from "../agentsession.ts";

export function do_setActiveToolsByName(self: AgentSession, toolNames: string[]): void {
  const tools: AgentTool[] = [];
  const validToolNames: string[] = [];
  for (const name of toolNames) {
    const tool = self._toolRegistry.get(name);
    if (tool) {
      tools.push(tool);
      validToolNames.push(name);
    }
  }
  self.agent.state.tools = tools;

  // Rebuild base system prompt with new tool set
  const effectiveCompletionMode = self._getEffectiveCompletionModeForActiveTools(validToolNames.length);
  self.agent.completionMode = effectiveCompletionMode;
  self._baseSystemPrompt = self._rebuildSystemPrompt(validToolNames, effectiveCompletionMode);
  self.agent.state.systemPrompt = self._baseSystemPrompt;
}

export function do_enablePlanMode(self: AgentSession): { enabled: boolean; missingTools: string[] } {
  const planTools = ["ask_user", "confirm_user", "submit_plan"];
  const missingTools = planTools.filter((toolName) => !self._toolRegistry.has(toolName));
  if (missingTools.includes("submit_plan")) {
    return { enabled: false, missingTools };
  }

  if (self._interactionMode !== "plan") {
    self._planModePreviousActiveToolNames = self.getActiveToolNames();
  }

  self._interactionMode = "plan";
  const activeTools = new Set(self.getActiveToolNames());
  for (const toolName of planTools) {
    if (self._toolRegistry.has(toolName)) {
      activeTools.add(toolName);
    }
  }
  self.setActiveToolsByName([...activeTools]);
  self._emit({ type: "interaction_mode_changed", mode: self._interactionMode });
  return { enabled: true, missingTools };
}

export function do_disablePlanMode(self: AgentSession): void {
  if (self._interactionMode !== "plan") {
    return;
  }

  const restoredToolNames =
    self._planModePreviousActiveToolNames ?? self.getActiveToolNames().filter((toolName) => toolName !== "submit_plan");
  self._planModePreviousActiveToolNames = undefined;
  self._interactionMode = "normal";
  self.setActiveToolsByName(restoredToolNames);
  self._emit({ type: "interaction_mode_changed", mode: self._interactionMode });
}

export function do_setScopedModels(
  self: AgentSession,
  scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>,
): void {
  self._scopedModels = scopedModels;
}

export function do__normalizePromptSnippet(_self: AgentSession, text: string | undefined): string | undefined {
  if (!text) return undefined;
  const oneLine = text
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length > 0 ? oneLine : undefined;
}

export function do__normalizePromptGuidelines(_self: AgentSession, guidelines: string[] | undefined): string[] {
  if (!guidelines || guidelines.length === 0) {
    return [];
  }

  const unique = new Set<string>();
  for (const guideline of guidelines) {
    const normalized = guideline.trim();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

export function do__getEffectiveCompletionModeForActiveTools(
  self: AgentSession,
  activeToolCount: number,
): CompletionMode {
  return activeToolCount === 0 && self._completionMode !== "implicit" ? "implicit" : self._completionMode;
}

export function do__getInteractionModeSystemPrompt(self: AgentSession): string | undefined {
  if (self._interactionMode !== "plan") {
    return undefined;
  }
  return `<plan_mode>
Plan mode is active because the user invoked /plan.
- Gather enough context to propose a concrete plan. Read files or run read-only inspection commands when needed.
- Ask targeted questions with ask_user only when user input would materially improve the plan.
- Do not edit files, write files, run implementation commands, or otherwise start execution while plan mode is active.
- When the plan is ready, call submit_plan with a concise summary, ordered steps, risks, and any open questions.
- Plan mode remains active if the user rejects the plan. Revise the plan or ask a follow-up question, then call submit_plan again.
- After submit_plan reports user approval, plan mode is off. Proceed with the approved plan without asking for the same approval again.
</plan_mode>`;
}

export function do__rebuildSystemPrompt(
  self: AgentSession,
  toolNames: string[],
  completionMode = self._getEffectiveCompletionModeForActiveTools(toolNames.length),
): string {
  const validToolNames = toolNames.filter((name) => self._toolRegistry.has(name));
  const promptToolNames =
    completionMode === "implicit"
      ? validToolNames
      : [...validToolNames.filter((name) => name !== FINISH_WORK_TOOL_NAME), FINISH_WORK_TOOL_NAME];
  const toolSnippets: Record<string, string> = {};
  const promptGuidelines: string[] = [];
  for (const name of validToolNames) {
    const snippet = self._toolPromptSnippets.get(name);
    if (snippet) {
      toolSnippets[name] = snippet;
    }

    const toolGuidelines = self._toolPromptGuidelines.get(name);
    if (toolGuidelines) {
      promptGuidelines.push(...toolGuidelines);
    }
  }
  if (completionMode !== "implicit") {
    toolSnippets[FINISH_WORK_TOOL_NAME] =
      "finish_work({ status, summary, verification_token?, files_changed?, tests_run?, remaining_work?, notes? }): explicitly terminate the task with the final status and user-visible summary";
  }

  const loaderSystemPrompt = self._resourceLoader.getSystemPrompt();
  const loaderAppendSystemPrompt = self._resourceLoader.getAppendSystemPrompt();
  const interactionModeSystemPrompt = self._getInteractionModeSystemPrompt();
  const appendSystemPrompt = [...loaderAppendSystemPrompt, interactionModeSystemPrompt]
    .filter((text): text is string => text !== undefined && text.trim().length > 0)
    .join("\n\n");
  const loadedSkills = self._resourceLoader.getSkills().skills;
  const loadedContextFiles = self._resourceLoader.getAgentsFiles().agentsFiles;
  const preparedProjectInstructions = self._projectInstructions.state.current;
  const projectInstructions =
    self._projectInstructionMode === "compiled" && preparedProjectInstructions
      ? selectProjectInstructionPromptForTools(preparedProjectInstructions, validToolNames)
      : undefined;

  self._baseSystemPromptOptions = {
    cwd: self._cwd,
    skills: loadedSkills,
    contextFiles: self._projectInstructionMode === "legacy" ? loadedContextFiles : [],
    projectInstructions,
    customPrompt: loaderSystemPrompt,
    appendSystemPrompt: appendSystemPrompt || undefined,
    selectedTools: promptToolNames,
    toolSnippets,
    promptGuidelines,
    completionMode,
  };
  return buildSystemPrompt(self._baseSystemPromptOptions);
}
