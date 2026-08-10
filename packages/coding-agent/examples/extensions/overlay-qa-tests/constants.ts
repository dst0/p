import type { OverlayHandle } from "@dst0/p-tui";
import type { FocusPanelConfig } from "./types.ts";

export const globalToggleHandle: OverlayHandle | null = null;

export const FOCUS_PANEL_CONFIGS = [
  { label: "Alpha", color: "error", options: { row: 2, col: 4, width: 34 } },
  { label: "Beta", color: "success", options: { row: 5, col: 28, width: 34 } },
  { label: "Gamma", color: "accent", options: { row: 8, col: 52, width: 34 } },
] satisfies FocusPanelConfig[];
