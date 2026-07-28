import { type Component, truncateToWidth, visibleWidth } from "@dst0/p-tui";
import { theme } from "../theme/theme.ts";

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
  parentId?: string;
  depth?: number;
  isLastChild?: boolean;
  active?: boolean;
}

export type ToolEventStatus = "running" | "success" | "error";

export interface ToolEvent {
  id: string;
  name: string;
  argsSummary?: string;
  status: ToolEventStatus;
  durationMs?: number;
}

export type PlanPanelMode = "hidden" | "compact" | "expanded";

export interface PlanPanelKeyHints {
  toggle: string;
  scrollUp: string;
  scrollDown: string;
  resizeNarrower: string;
  resizeWider: string;
  resizeShorter: string;
  resizeTaller: string;
}

export interface SgrMouseEvent {
  button: number;
  x: number;
  y: number;
  released: boolean;
}

export function getNextPlanPanelMode(mode: PlanPanelMode): PlanPanelMode {
  switch (mode) {
    case "hidden":
      return "compact";
    case "compact":
      return "expanded";
    case "expanded":
      return "hidden";
  }
}

export function parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
  const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
  if (!match) return undefined;

  return {
    button: Number.parseInt(match[1]!, 10),
    x: Number.parseInt(match[2]!, 10),
    y: Number.parseInt(match[3]!, 10),
    released: match[4] === "m",
  };
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
  private readonly tracker: PlanStatusTracker;
  private mode: Exclude<PlanPanelMode, "hidden"> = "compact";
  private viewportHeight: number | undefined;
  private fillViewport = false;
  private scrollOffset = 0;
  private lastBodyCapacity = 0;
  private lastBodyLineCount = 0;
  private lastRenderedHeight = 0;
  private keyHints: PlanPanelKeyHints = {
    toggle: "F2",
    scrollUp: "Ctrl+Shift+Up",
    scrollDown: "Ctrl+Shift+Down",
    resizeNarrower: "Ctrl+Alt+Shift+Left",
    resizeWider: "Ctrl+Alt+Shift+Right",
    resizeShorter: "Ctrl+Alt+Shift+Up",
    resizeTaller: "Ctrl+Alt+Shift+Down",
  };

  constructor(tracker: PlanStatusTracker) {
    this.tracker = tracker;
  }

  setMode(mode: Exclude<PlanPanelMode, "hidden">): void {
    this.mode = mode;
  }

  setViewport(height: number | undefined, fill: boolean): void {
    this.viewportHeight = height === undefined ? undefined : Math.max(1, Math.floor(height));
    this.fillViewport = fill;
  }

  setKeyHints(hints: PlanPanelKeyHints): void {
    this.keyHints = hints;
  }

  scrollBy(delta: number): boolean {
    const maxScrollOffset = Math.max(0, this.lastBodyLineCount - this.lastBodyCapacity);
    const nextOffset = Math.max(0, Math.min(maxScrollOffset, this.scrollOffset + delta));
    if (nextOffset === this.scrollOffset) return false;
    this.scrollOffset = nextOffset;
    return true;
  }

  getRenderedHeight(): number {
    return this.lastRenderedHeight;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width < 4) {
      this.lastRenderedHeight = 1;
      return [theme.fg("borderAccent", "─".repeat(width))];
    }

    const border = (str: string) => theme.fg("borderAccent", str);
    const innerW = width - 2;
    const wrapRow = (content: string) => border("│") + truncateToWidth(content, innerW, "…", true) + border("│");

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

    const totalSteps = this.tracker.steps.length;
    const completedSteps = this.tracker.steps.filter((s) => s.status === "completed" || s.status === "done").length;
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    const headerLines: string[] = [];
    const titleText = `[ ${completedSteps}/${totalSteps} Steps Complete (${percent}%) ]`;
    const formattedTitle = theme.fg("accent", theme.bold(titleText));
    const vTitleW = visibleWidth(titleText);

    if (width >= vTitleW + 5) {
      const topFill = "─".repeat(width - vTitleW - 5);
      headerLines.push(border("╭─ ") + formattedTitle + border(` ${topFill}╮`));
    } else {
      headerLines.push(border(`╭${"─".repeat(innerW)}╮`));
      headerLines.push(wrapRow(formattedTitle));
    }

    const bodyLines: string[] = [];
    if (this.tracker.steps.length === 0) {
      bodyLines.push(wrapRow(` ${C.gray}No plan steps defined.${C.reset}`));
    } else {
      const stepById = new Map(this.tracker.steps.map((step) => [step.id, step]));
      const isLastSibling = new Map<string, boolean>();
      for (let index = 0; index < this.tracker.steps.length; index++) {
        const step = this.tracker.steps[index]!;
        const hasLaterSibling = this.tracker.steps
          .slice(index + 1)
          .some((candidate) => candidate.parentId === step.parentId);
        isLastSibling.set(step.id, step.isLastChild ?? !hasLaterSibling);
      }

      for (const step of this.tracker.steps) {
        let icon = "";
        switch (step.status) {
          case "completed":
          case "done":
            icon = "✅";
            break;
          case "in_progress":
            icon = "⏳";
            break;
          case "failed":
            icon = "❌";
            break;
          case "checkpoint":
            icon = "💎";
            break;
          case "blocked":
            icon = "🔒";
            break;
          case "cancelled":
            icon = "🚫";
            break;
          default:
            icon = `${C.gray}⬜${C.reset}`;
            break;
        }

        const ancestors: PlanStep[] = [];
        const visited = new Set<string>([step.id]);
        let parentId = step.parentId;
        while (parentId) {
          const parent = stepById.get(parentId);
          if (!parent || visited.has(parent.id)) break;
          visited.add(parent.id);
          ancestors.unshift(parent);
          parentId = parent.parentId;
        }

        const ancestorIndent = ancestors.map((ancestor) => (isLastSibling.get(ancestor.id) ? "   " : "│  ")).join("");
        const branch = isLastSibling.get(step.id) ? "└─ " : "├─ ";
        const fallbackDepth = Math.max(0, (step.depth ?? ancestors.length) - ancestors.length);
        const treeIndent = `${"   ".repeat(fallbackDepth)}${ancestorIndent}${branch}`;
        const isActive = step.active === true;
        const activeMarker = isActive ? ` ${C.yellow}👈${C.reset}` : "";
        const stepDesc = isActive ? `${C.bold}${theme.fg("accent", step.description)}${C.reset}` : step.description;

        const stepText = ` ${C.gray}${treeIndent}${C.reset}${icon} ${stepDesc}${activeMarker}`;
        bodyLines.push(wrapRow(stepText));
      }
    }

    const logHeader = `[ Recent Tool Executions ]`;
    const logHeaderFormatted = theme.fg("muted", logHeader);
    const vLogW = visibleWidth(logHeader);

    if (width >= vLogW + 5) {
      const logFill = "─".repeat(width - vLogW - 5);
      bodyLines.push(border("├─ ") + logHeaderFormatted + border(` ${logFill}┤`));
    } else {
      bodyLines.push(border(`├${"─".repeat(innerW)}┤`));
      bodyLines.push(wrapRow(logHeaderFormatted));
    }

    if (this.tracker.toolEvents.length === 0) {
      bodyLines.push(wrapRow(` ${C.gray}No recent executions.${C.reset}`));
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
        const eventText = ` ${statusIcon} ${event.name}${argsText}${durationStr}`;
        bodyLines.push(wrapRow(eventText));
      }
    }

    const footerRows = 3;
    const viewportHeight = this.viewportHeight;
    const availableBodyRows =
      viewportHeight === undefined ? bodyLines.length : Math.max(0, viewportHeight - headerLines.length - footerRows);
    const visibleBodyRows = this.fillViewport ? availableBodyRows : Math.min(bodyLines.length, availableBodyRows);
    this.lastBodyCapacity = visibleBodyRows;
    this.lastBodyLineCount = bodyLines.length;
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, bodyLines.length - visibleBodyRows)));

    const visibleBodyLines =
      viewportHeight === undefined
        ? bodyLines
        : bodyLines.slice(this.scrollOffset, this.scrollOffset + visibleBodyRows);
    while (this.fillViewport && visibleBodyLines.length < visibleBodyRows) {
      visibleBodyLines.push(wrapRow(""));
    }

    const hiddenAbove = this.scrollOffset;
    const hiddenBelow = Math.max(0, bodyLines.length - this.scrollOffset - visibleBodyLines.length);
    const scrollHint = hiddenAbove > 0 || hiddenBelow > 0 ? ` ↑${hiddenAbove} ↓${hiddenBelow}` : "";
    const toggleAction = this.mode === "compact" ? "Expand" : "Hide";
    const keyHint =
      `[${this.keyHints.toggle}] ${toggleAction}` +
      ` · [${this.keyHints.scrollUp}/${this.keyHints.scrollDown}] Scroll` +
      ` · [${this.keyHints.resizeNarrower}/${this.keyHints.resizeWider}/${this.keyHints.resizeShorter}/${this.keyHints.resizeTaller}] Resize` +
      " · Mouse wheel/drag";
    const footerLines = [
      border(`├${"─".repeat(innerW)}┤`),
      wrapRow(` ${theme.fg("dim", `${scrollHint.trim()}${scrollHint ? " · " : ""}${keyHint}`)}`),
      border(`╰${"─".repeat(innerW)}╯`),
    ];

    const lines = [...headerLines, ...visibleBodyLines, ...footerLines];
    this.lastRenderedHeight = lines.length;

    return lines;
  }
}
