import type { KeyId } from "@dst0/p-tui";
import type { SessionManager } from "../../session-manager.ts";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEvent,
  ContextEvent,
  ExtensionError,
  ExtensionEvent,
  InputEvent,
  MessageEndEvent,
  ProjectTrustEvent,
  ReplacedSessionContext,
  ResourcesDiscoverEvent,
  SessionBeforeCompactResult,
  SessionBeforeForkResult,
  SessionBeforeSwitchResult,
  SessionBeforeTreeResult,
  ToolCallEvent,
  ToolResultEvent,
  UserBashEvent,
} from "../types.ts";

export type BuiltInKeyBindings = Partial<Record<KeyId, { keybinding: string; restrictOverride: boolean }>>;

export interface BeforeAgentStartCombinedResult {
  messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
  systemPrompt?: string;
}

export type RunnerEmitEvent = Exclude<
  ExtensionEvent,
  | ToolCallEvent
  | ProjectTrustEvent
  | ToolResultEvent
  | UserBashEvent
  | ContextEvent
  | BeforeProviderRequestEvent
  | BeforeAgentStartEvent
  | MessageEndEvent
  | ResourcesDiscoverEvent
  | InputEvent
>;

export type SessionBeforeEvent = Extract<
  RunnerEmitEvent,
  { type: "session_before_switch" | "session_before_fork" | "session_before_compact" | "session_before_tree" }
>;

export type SessionBeforeEventResult =
  | SessionBeforeSwitchResult
  | SessionBeforeForkResult
  | SessionBeforeCompactResult
  | SessionBeforeTreeResult;

export type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends { type: "session_before_switch" }
  ? SessionBeforeSwitchResult | undefined
  : TEvent extends { type: "session_before_fork" }
    ? SessionBeforeForkResult | undefined
    : TEvent extends { type: "session_before_compact" }
      ? SessionBeforeCompactResult | undefined
      : TEvent extends { type: "session_before_tree" }
        ? SessionBeforeTreeResult | undefined
        : undefined;

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type NewSessionHandler = (options?: {
  parentSession?: string;
  setup?: (sessionManager: SessionManager) => Promise<void>;
  withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type ForkHandler = (
  entryId: string,
  options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
  targetId: string,
  options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
) => Promise<{ cancelled: boolean }>;

export type SwitchSessionHandler = (
  sessionPath: string,
  options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;

export type ReloadHandler = () => Promise<void>;

export type ShutdownHandler = () => void;
