import type { ImageContent } from "@dst0/p-ai";

/**
 * Shared types for the interactive mode modules.
 */

/** Interface for components that can be expanded/collapsed */
export interface Expandable {
  setExpanded(expanded: boolean): void;
}

export type CompactionQueuedMessage = {
  text: string;
  mode: "steer" | "followUp";
};

export type PlanPanelDragMode = "width" | "height" | "both";

export interface PlanPanelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
  /** Providers that were migrated to auth.json (shows warning) */
  migratedProviders?: string[];
  /** Warning message if session model couldn't be restored */
  modelFallbackMessage?: string;
  /** Cwd to trust after reload if it gained a .p directory during this implicitly trusted session. */
  autoTrustOnReloadCwd?: string;
  /** Initial message to send on startup (can include @file content) */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
  /** Additional messages to send after the initial message */
  initialMessages?: string[];
  /** Force verbose startup (overrides quietStartup setting) */
  verbose?: boolean;
}
