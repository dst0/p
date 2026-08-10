import type { Theme } from "@dst0/p";
import { Input, matchesKey, truncateToWidth } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";
import type { FocusDemoController } from "./focusdemocontroller.ts";
import type { FocusPanelColor, FocusPanelConfig } from "./types.ts";

export class FocusPanel extends BaseOverlay {
  focused = false;
  closed = false;
  readonly label: string;
  private readonly color: FocusPanelColor;
  private readonly controller: FocusDemoController;
  private readonly input = new Input();
  private inputs: string[] = [];

  constructor({
    theme,
    config,
    controller,
  }: {
    theme: Theme;
    config: FocusPanelConfig;
    controller: FocusDemoController;
  }) {
    super(theme);
    this.label = config.label;
    this.color = config.color;
    this.controller = controller;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "tab")) {
      this.controller.focusNext(this);
    } else if (matchesKey(data, "shift+tab")) {
      this.controller.focusNext(this, -1);
    } else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+d")) {
      this.controller.dismiss(this);
    } else if (matchesKey(data, "ctrl+c")) {
      this.controller.close();
    } else if (matchesKey(data, "return")) {
      this.inputs.push("Enter");
    } else if (matchesKey(data, "up")) {
      this.inputs.push("↑");
    } else if (matchesKey(data, "down")) {
      this.inputs.push("↓");
    } else if (matchesKey(data, "left")) {
      this.input.handleInput(data);
      this.inputs.push("←");
    } else if (matchesKey(data, "right")) {
      this.input.handleInput(data);
      this.inputs.push("→");
    } else if (matchesKey(data, "backspace")) {
      this.input.handleInput(data);
      this.inputs.push("Backspace");
    } else {
      this.input.handleInput(data);
      this.inputs.push(JSON.stringify(data));
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const border = (c: string) => th.fg(this.focused ? this.color : "dim", c);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const recent = this.inputs.length === 0 ? "(none)" : this.inputs.slice(-6).join(" ");
    const lines: string[] = [];

    this.input.focused = this.focused;
    const [inputLine = ""] = this.input.render(Math.max(1, innerW - 8));
    lines.push(border(`╭${"─".repeat(innerW)}╮`));
    lines.push(
      border("│") +
        padLine(
          ` ${th.fg(this.color, this.label)} ${this.focused ? th.fg("success", "FOCUSED") : th.fg("dim", "visible")}`,
        ) +
        border("│"),
    );
    lines.push(border("│") + padLine("") + border("│"));
    lines.push(border("│") + padLine(` Input: ${inputLine}`) + border("│"));
    lines.push(border("│") + padLine(` Keys: ${recent}`) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Tab/Shift+Tab focus")) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Esc/Ctrl+D dismiss")) + border("│"));
    lines.push(border(`╰${"─".repeat(innerW)}╯`));

    return lines;
  }
}
