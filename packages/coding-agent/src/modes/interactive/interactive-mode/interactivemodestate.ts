import type { AssistantMessage } from "@dst0/p-ai";
import type {
  AutocompleteProvider,
  Component,
  Container,
  EditorComponent,
  Loader,
  LoaderIndicatorOptions,
  OverlayHandle,
  Spacer,
  Text,
  TUI,
} from "@dst0/p-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.ts";
import type { AutocompleteProviderFactory, EditorFactory } from "../../../core/extensions/index.ts";
import type { FooterDataProvider } from "../../../core/footer-data-provider.ts";
import { getIndexingService, type IndexingService } from "../../../core/indexing-service.ts";
import type { KeybindingsManager } from "../../../core/keybindings.ts";
import type { AssistantMessageComponent } from "../components/assistant-message.ts";
import type { BashExecutionComponent } from "../components/bash-execution.ts";
import type { CountdownTimer } from "../components/countdown-timer.ts";
import type { CustomEditor } from "../components/custom-editor.ts";
import type { ExtensionEditorComponent } from "../components/extension-editor.ts";
import type { ExtensionInputComponent } from "../components/extension-input.ts";
import type { ExtensionSelectorComponent } from "../components/extension-selector.ts";
import type { FooterComponent } from "../components/footer.ts";
import { PlanPanel, type PlanPanelMode, PlanStatusTracker } from "../components/plan-panel.ts";
import type { ToolExecutionComponent } from "../components/tool-execution.ts";
import { DEFAULT_PLAN_PANEL_WIDTH } from "./constants.ts";
import type { CompactionQueuedMessage, InteractiveModeOptions, PlanPanelDragMode } from "./types.ts";

export class InteractiveModeState {
  public runtimeHost!: AgentSessionRuntime;
  public ui!: TUI;
  public chatContainer!: Container;
  public pendingMessagesContainer!: Container;
  public statusContainer!: Container;
  public defaultEditor!: CustomEditor;
  public editor!: EditorComponent;
  public editorComponentFactory!: EditorFactory | undefined;
  public autocompleteProvider!: AutocompleteProvider | undefined;
  public autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
  public fdPath!: string | undefined;
  public editorContainer!: Container;
  public footer!: FooterComponent;
  public footerDataProvider!: FooterDataProvider;
  public queuedFooterSpinnerTimer: ReturnType<typeof setInterval> | undefined = undefined;
  public keybindings!: KeybindingsManager;
  public version!: string;
  public isInitialized = false;
  public onInputCallback?: (text: string) => void;
  public pendingUserInputs: string[] = [];
  public loadingAnimation: Loader | undefined = undefined;
  public workingMessage: string | undefined = undefined;
  public workingVisible = true;
  public planStatusTracker = new PlanStatusTracker();
  public planPanel = new PlanPanel(this.planStatusTracker);
  public planPanelHandle?: OverlayHandle;
  public planPanelMode: PlanPanelMode = "hidden";
  public planPanelCompactWidth = DEFAULT_PLAN_PANEL_WIDTH;
  public planPanelHeight!: number | undefined;
  public planPanelDragMode!: PlanPanelDragMode | undefined;
  public planPanelMouseMode = false;
  public planPanelInputUnsubscribe!: (() => void) | undefined;
  public workingIndicatorOptions: LoaderIndicatorOptions | undefined = undefined;
  public readonly defaultWorkingMessage = "Working...";
  public readonly defaultHiddenThinkingLabel = "Thinking...";
  public hiddenThinkingLabel = this.defaultHiddenThinkingLabel;
  public lastModelSwitch!:
    | {
        fromModel: string;
        toModel: string;
        timestamp: number;
      }
    | undefined;
  public lastSigintTime = 0;
  public lastEscapeTime = 0;
  public changelogMarkdown: string | undefined = undefined;
  public startupNoticesShown = false;
  public anthropicSubscriptionWarningShown = false;
  public readonly indexingService: IndexingService = getIndexingService();
  public codeIndexingPrompt!: Promise<void> | undefined;
  public lastStatusSpacer: Spacer | undefined = undefined;
  public lastStatusText: Text | undefined = undefined;
  public streamingComponent: AssistantMessageComponent | undefined = undefined;
  public streamingMessage: AssistantMessage | undefined = undefined;
  public pendingTools = new Map<string, ToolExecutionComponent>();
  public toolOutputExpanded = false;
  public hideThinkingBlock = false;
  public skillCommands = new Map<string, string>();
  public unsubscribe?: () => void;
  public signalCleanupHandlers: Array<() => void> = [];
  public isBashMode = false;
  public bashComponent: BashExecutionComponent | undefined = undefined;
  public pendingBashComponents: BashExecutionComponent[] = [];
  public autoCompactionLoader: Loader | undefined = undefined;
  public autoCompactionEscapeHandler?: () => void;
  public retryLoader: Loader | undefined = undefined;
  public retryCountdown: CountdownTimer | undefined = undefined;
  public retryEscapeHandler?: () => void;
  public compactionQueuedMessages: CompactionQueuedMessage[] = [];
  public shutdownRequested = false;
  public extensionSelector: ExtensionSelectorComponent | undefined = undefined;
  public extensionInput: ExtensionInputComponent | undefined = undefined;
  public extensionEditor: ExtensionEditorComponent | undefined = undefined;
  public extensionTerminalInputUnsubscribers = new Set<() => void>();
  public extensionWidgetsAbove = new Map<
    string,
    Component & {
      dispose?(): void;
    }
  >();
  public extensionWidgetsBelow = new Map<
    string,
    Component & {
      dispose?(): void;
    }
  >();
  public widgetContainerAbove!: Container;
  public widgetContainerBelow!: Container;
  public customFooter:
    | (Component & {
        dispose?(): void;
      })
    | undefined = undefined;
  public headerContainer!: Container;
  public builtInHeader: Component | undefined = undefined;
  public customHeader:
    | (Component & {
        dispose?(): void;
      })
    | undefined = undefined;
  public options!: InteractiveModeOptions;
  public autoTrustOnReloadCwd!: string | undefined;
  public get session(): AgentSession {
    return this.runtimeHost.session;
  }
  public get agent() {
    return this.session.agent;
  }
  public get sessionManager() {
    return this.session.sessionManager;
  }
  public get settingsManager() {
    return this.session.settingsManager;
  }
  public isShuttingDown = false;
}
