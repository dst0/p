import type { Model } from "@dst0/p-ai";
import { type DelegatedMethods, installDelegatedMethods } from "../../../utils/install-delegated-methods.ts";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import type { ModelRegistry } from "../../model-registry.ts";
import type { SessionManager } from "../../session-manager.ts";
import type { BuildSystemPromptOptions } from "../../system-prompt.ts";
import type {
  CompactOptions,
  ContextUsage,
  Extension,
  ExtensionMode,
  ExtensionRuntime,
  ExtensionUIContext,
} from "../types.ts";
import { noOpUIContext } from "./constants.ts";
import * as commandHandlingDelegates from "./extensionrunner-methods/command-handling.ts";
import * as diagnosticsDelegates from "./extensionrunner-methods/diagnostics.ts";
import * as eventDispatchDelegates from "./extensionrunner-methods/event-dispatch.ts";
import * as lifecycleDelegates from "./extensionrunner-methods/lifecycle.ts";
import * as sandboxExecutionDelegates from "./extensionrunner-methods/sandbox-execution.ts";
import * as toolRegistrationDelegates from "./extensionrunner-methods/tool-registration.ts";
import type {
  ExtensionErrorListener,
  ForkHandler,
  NavigateTreeHandler,
  NewSessionHandler,
  ReloadHandler,
  RunnerEmitEvent,
  RunnerEmitResult,
  ShutdownHandler,
  SwitchSessionHandler,
} from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
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

  async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
    return commandHandlingDelegates.do_emit(this, event);
  }
}

type ExtensionRunnerMethods = DelegatedMethods<
  ExtensionRunner,
  typeof commandHandlingDelegates &
    typeof diagnosticsDelegates &
    typeof eventDispatchDelegates &
    typeof lifecycleDelegates &
    typeof sandboxExecutionDelegates &
    typeof toolRegistrationDelegates
>;

export interface ExtensionRunner extends ExtensionRunnerMethods {}

installDelegatedMethods(ExtensionRunner.prototype, [
  commandHandlingDelegates,
  diagnosticsDelegates,
  eventDispatchDelegates,
  lifecycleDelegates,
  sandboxExecutionDelegates,
  toolRegistrationDelegates,
]);
