import { type Component, truncateToWidth, visibleWidth } from "@dst0/p-tui";

export type PlanStepStatus =
  | "pending"
  | "not_started"
  | "in_progress"
  | "completed"
  | "done"
  | "failed"
  | "checkpoint"
  | "blocked"
  | "cancelled";

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
}

export type ToolEventStatus = "running" | "success" | "error";

export interface ToolEvent {
  id: string;
  name: string;
  argsSummary?: string;
  status: ToolEventStatus;
  durationMs?: number;
}

export class PlanStatusTracker {
  public steps: PlanStep[] = [];
  public toolEvents: ToolEvent[] = [];
  public onUpdate?: () => void;

  addStep(step: PlanStep) {
    this.steps.push(step);
    this.onUpdate?.();
  }

  updateStep(id: string, status: PlanStepStatus) {
    const step = this.steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      this.onUpdate?.();
    }
  }

  addToolEvent(event: ToolEvent) {
    this.toolEvents.push(event);
    if (this.toolEvents.length > 5) {
      this.toolEvents.shift();
    }
    this.onUpdate?.();
  }

  updateToolEvent(id: string, update: Partial<ToolEvent>) {
    const event = this.toolEvents.find((e) => e.id === id);
    if (event) {
      Object.assign(event, update);
      this.onUpdate?.();
    }
  }
}

export class PlanPanel implements Component {
  private tracker: PlanStatusTracker;

  constructor(tracker: PlanStatusTracker) {
    this.tracker = tracker;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    const C = {
      green: "\x1b[32m",
      cyan: "\x1b[36m",
      yellow: "\x1b[33m",
      gray: "\x1b[90m",
      red: "\x1b[31m",
      magenta: "\x1b[35m",
      reset: "\x1b[0m",
      bold: "\x1b[1m",
    };

    // Calculate progress
    const totalSteps = this.tracker.steps.length;
    const completedSteps = this.tracker.steps.filter((s) => s.status === "completed").length;
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Header
    const titleText = `[ ${completedSteps}/${totalSteps} Steps Complete (${percent}%) ]`;
    const decorativeLine = "━".repeat(Math.max(0, width - visibleWidth(titleText) - 2));
    lines.push(truncateToWidth(`${C.cyan}${C.bold}${titleText} ${decorativeLine}${C.reset}`, width, ""));
    lines.push("");

    // Plan steps
    if (this.tracker.steps.length === 0) {
      lines.push(truncateToWidth(`  ${C.gray}No plan steps defined.${C.reset}`, width, ""));
    } else {
      for (const step of this.tracker.steps) {
        let icon = "";
        switch (step.status) {
          case "completed":
          case "done":
            icon = `[${C.green}✔${C.reset}]`;
            break;
          case "in_progress":
            icon = `[${C.cyan}▶${C.reset}]`;
            break;
          case "failed":
            icon = `[${C.red}✖${C.reset}]`;
            break;
          case "checkpoint":
            icon = `[${C.magenta}🚩${C.reset}]`;
            break;
          case "blocked":
            icon = `[${C.yellow}⛔${C.reset}]`;
            break;
          case "cancelled":
            icon = `[${C.gray}🚫${C.reset}]`;
            break;
          default:
            icon = `[${C.gray}○${C.reset}]`;
            break;
        }

        const stepText = ` ${icon} ${step.description}`;
        lines.push(truncateToWidth(stepText, width, "..."));
      }
    }

    lines.push("");

    // Execution log summary
    const logHeader = `[ Recent Tool Executions ]`;
    const logLine = "━".repeat(Math.max(0, width - visibleWidth(logHeader) - 2));
    lines.push(truncateToWidth(`${C.gray}${logHeader} ${logLine}${C.reset}`, width, ""));

    if (this.tracker.toolEvents.length === 0) {
      lines.push(truncateToWidth(`  ${C.gray}No recent executions.${C.reset}`, width, ""));
    } else {
      for (const event of this.tracker.toolEvents) {
        let statusIcon = "";
        let durationStr = "";

        if (event.durationMs !== undefined) {
          durationStr = ` ${C.gray}(${event.durationMs}ms)${C.reset}`;
        }

        switch (event.status) {
          case "running":
            statusIcon = `${C.yellow}⚡${C.reset}`;
            break;
          case "success":
            statusIcon = `${C.green}✅${C.reset}`;
            break;
          case "error":
            statusIcon = `${C.red}❌${C.reset}`;
            break;
        }

        const argsText = event.argsSummary ? ` ${C.gray}${event.argsSummary}${C.reset}` : "";
        const eventText = `  ${statusIcon} ${event.name}${argsText}${durationStr}`;
        lines.push(truncateToWidth(eventText, width, "..."));
      }
    }

    return lines;
  }
}
