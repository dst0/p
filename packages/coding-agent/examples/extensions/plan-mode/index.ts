/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { ExtensionAPI, ExtensionContext } from "@dst0/p";
import type { AgentMessage } from "@dst0/p-agent-core";
import type { TextContent } from "@dst0/p-ai";
import { Key } from "@dst0/p-tui";
import {
  extractTodoItems,
  formatPlanExecutionContext,
  formatPlanExecutionRequest,
  getPlanModeTools,
  getTextContent,
  isAssistantMessage,
  isSafeCommand,
  markCompletedSteps,
  PLAN_MODE_SYSTEM_INSTRUCTION,
  rebuildResumeCompletionState,
  restorePlanModeTools,
  type TodoItem,
} from "./utils.ts";

export default function planModeExtension(p: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];
  let savedActiveTools: string[] | null = null;

  p.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function updateStatus(ctx: ExtensionContext): void {
    // Footer status
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((t) => t.completed).length;
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
    } else if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }

    // Widget showing todo list
    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((item) => {
        if (item.completed) {
          return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text));
        }
        return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
      });
      ctx.ui.setWidget("plan-todos", lines);
    } else {
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled;
    executionMode = false;
    todoItems = [];

    if (planModeEnabled) {
      savedActiveTools = p.getActiveTools();
      const planTools = getPlanModeTools(savedActiveTools, p.getAllTools());
      p.setActiveTools(planTools);
      ctx.ui.notify(`Plan mode enabled. Tools: ${planTools.join(", ")}`);
    } else {
      p.setActiveTools(restorePlanModeTools(savedActiveTools, p.getActiveTools()));
      savedActiveTools = null;
      ctx.ui.notify("Plan mode disabled. Full access restored.");
    }
    updateStatus(ctx);
  }

  function persistState(): void {
    p.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
    });
  }

  p.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  p.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info");
        return;
      }
      const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  p.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  // Block destructive bash commands in plan mode
  p.on("tool_call", async (event) => {
    if (!planModeEnabled || event.toolName !== "bash") return;

    const command = event.input.command as string;
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
      };
    }
  });

  // Inject one ephemeral plan instruction and remove stale copies.
  p.on("context", async (event) => {
    const isPlanContext = (message: unknown): boolean => {
      const candidate = message as AgentMessage & { customType?: string };
      if (candidate.customType === "plan-mode-context" || candidate.customType === "plan-execution-context")
        return true;
      if (candidate.role !== "user") return false;
      if (typeof candidate.content === "string") return candidate.content.includes("[PLAN MODE ACTIVE]");
      return (
        Array.isArray(candidate.content) &&
        candidate.content.some(
          (content) => content.type === "text" && (content as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
        )
      );
    };

    const messages = event.messages.filter((message) => !isPlanContext(message));
    const contextMessages: AgentMessage[] = [];
    if (executionMode && todoItems.length > 0) {
      contextMessages.push({
        role: "custom",
        customType: "plan-execution-context",
        content: formatPlanExecutionContext(todoItems),
        display: false,
        timestamp: Date.now(),
      });
    }
    if (!planModeEnabled) return { messages: [...contextMessages, ...messages] };
    return {
      messages: [
        {
          role: "user",
          customType: "plan-mode-context",
          content: [{ type: "text", text: PLAN_MODE_SYSTEM_INSTRUCTION }],
          timestamp: Date.now(),
        } as AgentMessage,
        ...contextMessages,
        ...messages,
      ],
    };
  });

  // Track progress after each turn
  p.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    const text = getTextContent(event.message);
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx);
    }
    persistState();
  });

  // Handle plan completion and plan mode UI
  p.on("agent_end", async (event, ctx) => {
    // Check if execution is complete
    if (executionMode && todoItems.length > 0) {
      if (todoItems.every((t) => t.completed)) {
        const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
        p.sendMessage(
          { customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
          { triggerTurn: false },
        );
        executionMode = false;
        todoItems = [];
        p.setActiveTools(restorePlanModeTools(savedActiveTools, p.getActiveTools()));
        savedActiveTools = null;
        updateStatus(ctx);
        persistState(); // Save cleared state so resume doesn't restore old execution mode
      }
      return;
    }

    if (!planModeEnabled || !ctx.hasUI) return;

    // Extract todos from last assistant message
    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
    if (lastAssistant) {
      const extracted = extractTodoItems(getTextContent(lastAssistant));
      if (extracted.length > 0) {
        todoItems = extracted;
      }
    }

    // Show plan steps and prompt for next action
    if (todoItems.length > 0) {
      const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
      p.sendMessage(
        {
          customType: "plan-todo-list",
          content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
          display: true,
        },
        { triggerTurn: false },
      );
    }

    const choice = await ctx.ui.select("Plan mode - what next?", [
      todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
      "Stay in plan mode",
      "Refine the plan",
    ]);

    if (choice?.startsWith("Execute")) {
      planModeEnabled = false;
      executionMode = todoItems.length > 0;
      p.setActiveTools(restorePlanModeTools(savedActiveTools, p.getActiveTools()));
      savedActiveTools = null;
      updateStatus(ctx);

      const execMessage = formatPlanExecutionRequest(todoItems);
      p.sendMessage({ customType: "plan-mode-execute", content: execMessage, display: true }, { triggerTurn: true });
    } else if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement?.trim()) {
        p.sendUserMessage(refinement.trim());
      }
    }
  });

  // Restore state on session start/resume
  p.on("session_start", async (_event, ctx) => {
    if (p.getFlag("plan") === true) {
      planModeEnabled = true;
    }

    const entries = ctx.sessionManager.getEntries();

    // Restore persisted state
    const planModeEntry = entries
      .filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
      .pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } } | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      todoItems = planModeEntry.data.todos ?? todoItems;
      executionMode = planModeEntry.data.executing ?? executionMode;
    }

    // On resume: re-scan messages to rebuild completion state.
    const isResume = planModeEntry !== undefined;
    if (isResume && executionMode && todoItems.length > 0) {
      rebuildResumeCompletionState(entries, todoItems);
    }

    if (planModeEnabled) {
      savedActiveTools = p.getActiveTools();
      p.setActiveTools(getPlanModeTools(savedActiveTools, p.getAllTools()));
    }
    updateStatus(ctx);
  });
}
