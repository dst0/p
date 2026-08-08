import type { Theme } from "@dst0/p";
import type { TUI } from "@dst0/p-tui";
import { matchesKey } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";
import { FOCUS_PANEL_CONFIGS } from "./constants.ts";
import { FocusPanel } from "./focuspanel.ts";
import type { FocusPanelEntry } from "./types.ts";

export class FocusDemoController extends BaseOverlay {
  private readonly tui: TUI;
  private entries: FocusPanelEntry[] = [];
  private readonly done: () => void;
  private closed = false;

  constructor(tui: TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;

    for (const config of FOCUS_PANEL_CONFIGS) {
      const panel = new FocusPanel({ theme, config, controller: this });
      const handle = this.tui.showOverlay(panel, { nonCapturing: true, ...config.options });
      this.entries.push({ panel, handle });
    }

    this.focusFirstOpenPanel();
  }

  focusNext(current: FocusPanel, direction: 1 | -1 = 1): void {
    const openEntries = this.openEntries();
    const currentOpenPosition = openEntries.findIndex((entry) => entry.panel === current);
    if (currentOpenPosition === -1) throw new Error(`Panel ${current.label} is not open`);
    const nextOpenPosition = (currentOpenPosition + direction + openEntries.length) % openEntries.length;
    this.focusEntryAt(openEntries, nextOpenPosition);
  }

  dismiss(panel: FocusPanel): void {
    const openEntries = this.openEntries();
    const currentOpenPosition = openEntries.findIndex((candidate) => candidate.panel === panel);
    if (currentOpenPosition === -1) return;
    const entry = openEntries[currentOpenPosition];
    if (!entry) throw new Error(`Invalid focus panel index ${currentOpenPosition}`);
    const remainingEntries = openEntries.filter((candidate) => candidate.panel !== panel);

    entry.panel.closed = true;
    entry.handle.hide();
    if (remainingEntries.length === 0) {
      this.close();
      return;
    }

    this.focusEntryAt(remainingEntries, currentOpenPosition % remainingEntries.length);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hidePanels();
    this.done();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.close();
    } else if (matchesKey(data, "tab")) {
      this.focusFirstOpenPanel();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const focused = this.entries.find((entry) => entry.handle.isFocused())?.panel.label ?? "Controller";
    return this.box(
      [
        "",
        ` Current focus: ${th.fg("accent", focused)}`,
        "",
        " Three overlapping panels above are",
        ` ${th.fg("accent", "nonCapturing")} overlays controlled with`,
        " raw OverlayHandle.focus()/hide().",
        "",
        " Type in the focused panel's input.",
        " Focused panel renders on top.",
        "",
        th.fg("dim", " Tab/Shift+Tab = cycle panels"),
        th.fg("dim", " Esc/Ctrl+D = dismiss panel"),
        th.fg("dim", " Ctrl+C = close all"),
        "",
      ],
      width,
      "Focus + Input Demo",
    );
  }

  override dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.hidePanels();
  }

  private focusFirstOpenPanel(): void {
    const firstOpen = this.openEntries()[0];
    if (firstOpen) {
      firstOpen.handle.focus();
      this.tui.requestRender();
    }
  }

  private focusEntryAt(entries: FocusPanelEntry[], index: number): void {
    const entry = entries[index];
    if (!entry) throw new Error(`Invalid focus panel index ${index}`);
    entry.handle.focus();
    this.tui.requestRender();
  }

  private hidePanels(): void {
    for (const entry of this.entries) {
      if (!entry.panel.closed) {
        entry.panel.closed = true;
        entry.handle.hide();
      }
    }
    this.entries = [];
  }

  private openEntries(): FocusPanelEntry[] {
    return this.entries.filter((entry) => !entry.panel.closed);
  }
}
