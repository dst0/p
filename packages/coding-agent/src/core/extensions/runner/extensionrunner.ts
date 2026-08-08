import type { AgentMessage } from "@dst0/p-agent-core";
import type { ImageContent, Model } from "@dst0/p-ai";
import type { KeyId } from "@dst0/p-tui";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import type { KeybindingsConfig } from "../../keybindings.ts";
import type { ModelRegistry } from "../../model-registry.ts";
import type { SessionManager } from "../../session-manager.ts";
import type { BuildSystemPromptOptions } from "../../system-prompt.ts";
import type {
  CompactOptions,
  ContextUsage,
  Extension,
  ExtensionActions,
  ExtensionCommandContext,
  ExtensionCommandContextActions,
  ExtensionContext,
  ExtensionContextActions,
  ExtensionError,
  ExtensionFlag,
  ExtensionMode,
  ExtensionRuntime,
  ExtensionShortcut,
  ExtensionUIContext,
  InputEventResult,
  InputSource,
  MessageEndEvent,
  MessageRenderer,
  ProviderConfig,
  RegisteredTool,
  ResolvedCommand,
  ResourcesDiscoverEvent,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
  UserBashEvent,
  UserBashEventResult,
} from "../types.ts";
import { noOpUIContext } from "./constants.ts";
import {
  do_createCommandContext,
  do_createContext,
  do_emit,
  do_isSessionBeforeEvent,
} from "./extensionrunner-methods/command-handling.ts";
import { do_emitInput, do_emitResourcesDiscover } from "./extensionrunner-methods/diagnostics.ts";
import {
  do_emitMessageEnd,
  do_emitToolCall,
  do_emitToolResult,
  do_emitUserBash,
} from "./extensionrunner-methods/event-dispatch.ts";
import {
  do_bindCommandContext,
  do_bindCore,
  do_getAllRegisteredTools,
  do_getExtensionPaths,
  do_getFlags,
  do_getFlagValues,
  do_getToolDefinition,
  do_getUIContext,
  do_hasUI,
  do_setFlagValue,
  do_setUIContext,
} from "./extensionrunner-methods/lifecycle.ts";
import {
  do_emitBeforeAgentStart,
  do_emitBeforeProviderRequest,
  do_emitContext,
} from "./extensionrunner-methods/sandbox-execution.ts";
import {
  do_assertActive,
  do_emitError,
  do_getCommand,
  do_getCommandDiagnostics,
  do_getMessageRenderer,
  do_getRegisteredCommands,
  do_getShortcutDiagnostics,
  do_getShortcuts,
  do_hasHandlers,
  do_invalidate,
  do_onError,
  do_resolveRegisteredCommands,
  do_shutdown,
} from "./extensionrunner-methods/tool-registration.ts";
import type {
  BeforeAgentStartCombinedResult,
  ExtensionErrorListener,
  ForkHandler,
  NavigateTreeHandler,
  NewSessionHandler,
  ReloadHandler,
  RunnerEmitEvent,
  RunnerEmitResult,
  SessionBeforeEvent,
  ShutdownHandler,
  SwitchSessionHandler,
} from "./types.ts";

export class ExtensionRunner {
  public extensions: Extension[];

  public runtime: ExtensionRuntime;

  public uiContext: ExtensionUIContext;

  public mode: ExtensionMode = "print";

  public cwd: string;

  public sessionManager: SessionManager;

  public modelRegistry: ModelRegistry;

  public errorListeners: Set<ExtensionErrorListener> = new Set();

  public getModel: () => Model<any> | undefined = () => undefined;

  public isIdleFn: () => boolean = () => true;

  public isProjectTrustedFn: () => boolean = () => true;

  public getSignalFn: () => AbortSignal | undefined = () => undefined;

  public waitForIdleFn: () => Promise<void> = async () => {};

  public abortFn: () => void = () => {};

  public hasPendingMessagesFn: () => boolean = () => false;

  public getContextUsageFn: () => ContextUsage | undefined = () => undefined;

  public compactFn: (options?: CompactOptions) => void = () => {};

  public getSystemPromptFn: () => string = () => "";

  public getSystemPromptOptionsFn: () => BuildSystemPromptOptions = () => ({ cwd: this.cwd });

  public newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });

  public forkHandler: ForkHandler = async () => ({ cancelled: false });

  public navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });

  public switchSessionHandler: SwitchSessionHandler = async () => ({ cancelled: false });

  public reloadHandler: ReloadHandler = async () => {};

  public shutdownHandler: ShutdownHandler = () => {};

  public shortcutDiagnostics: ResourceDiagnostic[] = [];

  public commandDiagnostics: ResourceDiagnostic[] = [];

  public staleMessage: string | undefined;

  constructor(
    extensions: Extension[],
    runtime: ExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    modelRegistry: ModelRegistry,
  ) {
    this.extensions = extensions;
    this.runtime = runtime;
    this.uiContext = noOpUIContext;
    this.cwd = cwd;
    this.sessionManager = sessionManager;
    this.modelRegistry = modelRegistry;
  }

  bindCore(
    actions: ExtensionActions,
    contextActions: ExtensionContextActions,
    providerActions?: {
      registerProvider?: (name: string, config: ProviderConfig) => void;
      unregisterProvider?: (name: string) => void;
    },
  ): void {
    do_bindCore(this, actions, contextActions, providerActions);
  }

  bindCommandContext(actions?: ExtensionCommandContextActions): void {
    do_bindCommandContext(this, actions);
  }

  setUIContext(uiContext?: ExtensionUIContext, mode: ExtensionMode = "print"): void {
    do_setUIContext(this, uiContext, mode);
  }

  getUIContext(): ExtensionUIContext {
    return do_getUIContext(this);
  }

  hasUI(): boolean {
    return do_hasUI(this);
  }

  getExtensionPaths(): string[] {
    return do_getExtensionPaths(this);
  }

  getAllRegisteredTools(): RegisteredTool[] {
    return do_getAllRegisteredTools(this);
  }

  getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
    return do_getToolDefinition(this, toolName);
  }

  getFlags(): Map<string, ExtensionFlag> {
    return do_getFlags(this);
  }

  setFlagValue(name: string, value: boolean | string): void {
    do_setFlagValue(this, name, value);
  }

  getFlagValues(): Map<string, boolean | string> {
    return do_getFlagValues(this);
  }

  getShortcuts(resolvedKeybindings: KeybindingsConfig): Map<KeyId, ExtensionShortcut> {
    return do_getShortcuts(this, resolvedKeybindings);
  }

  getShortcutDiagnostics(): ResourceDiagnostic[] {
    return do_getShortcutDiagnostics(this);
  }

  invalidate(
    message = "This extension ctx is stale after session replacement or reload. Do not use a captured p or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
  ): void {
    do_invalidate(this, message);
  }

  assertActive(): void {
    do_assertActive(this);
  }

  onError(listener: ExtensionErrorListener): () => void {
    return do_onError(this, listener);
  }

  emitError(error: ExtensionError): void {
    do_emitError(this, error);
  }

  hasHandlers(eventType: string): boolean {
    return do_hasHandlers(this, eventType);
  }

  getMessageRenderer(customType: string): MessageRenderer | undefined {
    return do_getMessageRenderer(this, customType);
  }

  resolveRegisteredCommands(): ResolvedCommand[] {
    return do_resolveRegisteredCommands(this);
  }

  getRegisteredCommands(): ResolvedCommand[] {
    return do_getRegisteredCommands(this);
  }

  getCommandDiagnostics(): ResourceDiagnostic[] {
    return do_getCommandDiagnostics(this);
  }

  getCommand(name: string): ResolvedCommand | undefined {
    return do_getCommand(this, name);
  }

  shutdown(): void {
    do_shutdown(this);
  }

  createContext(): ExtensionContext {
    return do_createContext(this);
  }

  createCommandContext(): ExtensionCommandContext {
    return do_createCommandContext(this);
  }

  isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
    return do_isSessionBeforeEvent(this, event);
  }

  async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
    return do_emit(this, event);
  }

  async emitMessageEnd(event: MessageEndEvent): Promise<AgentMessage | undefined> {
    return do_emitMessageEnd(this, event);
  }

  async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
    return do_emitToolResult(this, event);
  }

  async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
    return do_emitToolCall(this, event);
  }

  async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
    return do_emitUserBash(this, event);
  }

  async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
    return do_emitContext(this, messages);
  }

  async emitBeforeProviderRequest(payload: unknown): Promise<unknown> {
    return do_emitBeforeProviderRequest(this, payload);
  }

  async emitBeforeAgentStart(
    prompt: string,
    images: ImageContent[] | undefined,
    systemPrompt: string,
    systemPromptOptions: BuildSystemPromptOptions,
  ): Promise<BeforeAgentStartCombinedResult | undefined> {
    return do_emitBeforeAgentStart(this, prompt, images, systemPrompt, systemPromptOptions);
  }

  async emitResourcesDiscover(
    cwd: string,
    reason: ResourcesDiscoverEvent["reason"],
  ): Promise<{
    skillPaths: Array<{ path: string; extensionPath: string }>;
    promptPaths: Array<{ path: string; extensionPath: string }>;
    themePaths: Array<{ path: string; extensionPath: string }>;
  }> {
    return do_emitResourcesDiscover(this, cwd, reason);
  }

  async emitInput(
    text: string,
    images: ImageContent[] | undefined,
    source: InputSource,
    streamingBehavior?: "steer" | "followUp",
  ): Promise<InputEventResult> {
    return do_emitInput(this, text, images, source, streamingBehavior);
  }
}
