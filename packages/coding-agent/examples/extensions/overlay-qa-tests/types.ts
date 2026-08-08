import type { OverlayHandle, OverlayOptions } from "@dst0/p-tui";
import type { FocusPanel } from "./focuspanel.ts";

export type FocusPanelColor = "error" | "success" | "accent";

export type FocusPanelConfig = { label: string; color: FocusPanelColor; options: OverlayOptions };

export type FocusPanelEntry = { panel: FocusPanel; handle: OverlayHandle };
