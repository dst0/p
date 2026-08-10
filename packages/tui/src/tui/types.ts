import type { RgbColor } from "../terminal-colors.ts";

export interface KittyImageHeader {
  ids: number[];
  rows: number;
}

export interface Component {
  /**
   * Render the component to lines for the given viewport width
   * @param width - Current viewport width
   * @returns Array of strings, each representing a line
   */
  render(width: number): string[];

  /**
   * Optional handler for keyboard input when component has focus
   */
  handleInput?(data: string): void;

  /**
   * If true, component receives key release events (Kitty protocol).
   * Default is false - release events are filtered out.
   */
  wantsKeyRelease?: boolean;

  /**
   * Invalidate any cached rendering state.
   * Called when theme changes or when component needs to re-render from scratch.
   */
  invalidate(): void;
}

export type InputListenerResult = { consume?: boolean; data?: string } | undefined;

export type InputListener = (data: string) => InputListenerResult;

export type PendingOsc11BackgroundQuery = {
  settled: boolean;
  resolve: ((rgb: RgbColor | undefined) => void) | undefined;
  timer: NodeJS.Timeout | undefined;
};

export interface Focusable {
  /** Set by TUI when focus changes. Component should emit CURSOR_MARKER when true. */
  focused: boolean;
}

export type OverlayAnchor =
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center"
  | "left-center"
  | "right-center";

export interface OverlayMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export type SizeValue = number | `${number}%`;

export interface OverlayOptions {
  // === Sizing ===
  /** Width in columns, or percentage of terminal width (e.g., "50%") */
  width?: SizeValue;
  /** Minimum width in columns */
  minWidth?: number;
  /** Maximum height in rows, or percentage of terminal height (e.g., "50%") */
  maxHeight?: SizeValue;

  // === Positioning - anchor-based ===
  /** Anchor point for positioning (default: 'center') */
  anchor?: OverlayAnchor;
  /** Horizontal offset from anchor position (positive = right) */
  offsetX?: number;
  /** Vertical offset from anchor position (positive = down) */
  offsetY?: number;

  // === Positioning - percentage or absolute ===
  /** Row position: absolute number, or percentage (e.g., "25%" = 25% from top) */
  row?: SizeValue;
  /** Column position: absolute number, or percentage (e.g., "50%" = centered horizontally) */
  col?: SizeValue;

  // === Margin from terminal edges ===
  /** Margin from terminal edges. Number applies to all sides. */
  margin?: OverlayMargin | number;

  // === Visibility ===
  /**
   * Control overlay visibility based on terminal dimensions.
   * If provided, overlay is only rendered when this returns true.
   * Called each render cycle with current terminal dimensions.
   */
  visible?: (termWidth: number, termHeight: number) => boolean;
  /** If true, don't capture keyboard focus when shown */
  nonCapturing?: boolean;
}

export interface OverlayUnfocusOptions {
  /** Explicit target to focus after releasing this overlay. */
  target: Component | null;
}

export interface OverlayHandle {
  /** Permanently remove the overlay (cannot be shown again) */
  hide(): void;
  /** Temporarily hide or show the overlay */
  setHidden(hidden: boolean): void;
  /** Check if overlay is temporarily hidden */
  isHidden(): boolean;
  /** Focus this overlay and bring it to the visual front */
  focus(): void;
  /** Release focus to the next visible capturing overlay or previous target, or to an explicit target when provided */
  unfocus(options?: OverlayUnfocusOptions): void;
  /** Check if this overlay currently has focus */
  isFocused(): boolean;
}

export type OverlayStackEntry = {
  component: Component;
  options?: OverlayOptions;
  preFocus: Component | null;
  hidden: boolean;
  focusOrder: number;
};

export type OverlayBlockedFocusResume =
  | { status: "restore-overlay" }
  | { status: "focus-target"; target: Component | null };

export type EligibleOverlayFocusRestoreState = { status: "eligible"; overlay: OverlayStackEntry };

export type BlockedOverlayFocusRestoreState = {
  status: "blocked";
  overlay: OverlayStackEntry;
  blockedBy: Component;
  resume: OverlayBlockedFocusResume;
};

export type ActiveOverlayFocusRestoreState = EligibleOverlayFocusRestoreState | BlockedOverlayFocusRestoreState;

export type OverlayFocusRestoreState = { status: "inactive" } | ActiveOverlayFocusRestoreState;

export type OverlayFocusRestorePolicy = "clear" | "preserve";
