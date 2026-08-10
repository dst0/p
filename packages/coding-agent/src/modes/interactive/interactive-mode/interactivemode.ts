import type { OverlayHandle, OverlayOptions } from "@dst0/p-tui";
import { type Component, Container, ProcessTerminal, setKeybindings, TUI } from "@dst0/p-tui";
import { VERSION } from "../../../config.ts";
import type { AgentSessionRuntime } from "../../../core/agent-session-runtime.ts";
import { FooterDataProvider } from "../../../core/footer-data-provider.ts";
import { KeybindingsManager } from "../../../core/keybindings.ts";
import { installDelegatedMethods } from "../../../utils/install-delegated-methods.ts";
import { CustomEditor } from "../components/custom-editor.ts";
import { FooterComponent } from "../components/footer.ts";
import { getEditorTheme, initTheme, setRegisteredThemes, type Theme } from "../theme/theme.ts";
import * as agentSubscriptionDelegates from "./interactivemode-methods/agent-subscription.ts";
import * as authSelectorDelegates from "./interactivemode-methods/auth-selector.ts";
import * as autocompleteSetupDelegates from "./interactivemode-methods/autocomplete-setup.ts";
import * as chatMessageDelegates from "./interactivemode-methods/chat-message.ts";
import * as chatRenderingDelegates from "./interactivemode-methods/chat-rendering.ts";
import * as cloneCommandDelegates from "./interactivemode-methods/clone-command.ts";
import * as compactCommandDelegates from "./interactivemode-methods/compact-command.ts";
import * as debugCommandDelegates from "./interactivemode-methods/debug-command.ts";
import * as diagnosticFormattingDelegates from "./interactivemode-methods/diagnostic-formatting.ts";
import * as displayFormattingDelegates from "./interactivemode-methods/display-formatting.ts";
import * as editorSubmitDelegates from "./interactivemode-methods/editor-submit.ts";
import * as eventHandlerDelegates from "./interactivemode-methods/event-handler.ts";
import * as exportCommandDelegates from "./interactivemode-methods/export-command.ts";
import * as extensionCustomDelegates from "./interactivemode-methods/extension-custom.ts";
import * as extensionEditorDelegates from "./interactivemode-methods/extension-editor.ts";
import * as extensionUiContextDelegates from "./interactivemode-methods/extension-ui-context.ts";
import * as extensionWidgetsDelegates from "./interactivemode-methods/extension-widgets.ts";
import * as flushOperationsDelegates from "./interactivemode-methods/flush-operations.ts";
import * as hotkeysCommandDelegates from "./interactivemode-methods/hotkeys-command.ts";
import * as initDelegates from "./interactivemode-methods/init.ts";
import * as keyHandlersDelegates from "./interactivemode-methods/key-handlers.ts";
import * as lifecycleDelegates from "./interactivemode-methods/lifecycle.ts";
import * as loginDialogDelegates from "./interactivemode-methods/login-dialog.ts";
import * as memoryCommandDelegates from "./interactivemode-methods/memory-command.ts";
import * as modelCommandDelegates from "./interactivemode-methods/model-command.ts";
import * as modelSelectorDelegates from "./interactivemode-methods/model-selector.ts";
import * as modelSwitchingDelegates from "./interactivemode-methods/model-switching.ts";
import * as planCommandDelegates from "./interactivemode-methods/plan-command.ts";
import * as planPanelInteractionDelegates from "./interactivemode-methods/plan-panel-interaction.ts";
import * as planPanelLayoutDelegates from "./interactivemode-methods/plan-panel-layout.ts";
import * as queueManagementDelegates from "./interactivemode-methods/queue-management.ts";
import * as resourceDisplayDelegates from "./interactivemode-methods/resource-display.ts";
import * as runLoopDelegates from "./interactivemode-methods/run-loop.ts";
import * as scopeGroupingDelegates from "./interactivemode-methods/scope-grouping.ts";
import * as sessionBindingDelegates from "./interactivemode-methods/session-binding.ts";
import * as sessionCommandDelegates from "./interactivemode-methods/session-command.ts";
import * as sessionSelectorDelegates from "./interactivemode-methods/session-selector.ts";
import * as settingsSelectorDelegates from "./interactivemode-methods/settings-selector.ts";
import * as shareCommandDelegates from "./interactivemode-methods/share-command.ts";
import * as startupNoticesDelegates from "./interactivemode-methods/startup-notices.ts";
import * as statusCommandDelegates from "./interactivemode-methods/status-command.ts";
import * as treeSelectorDelegates from "./interactivemode-methods/tree-selector.ts";
import * as uiUtilitiesDelegates from "./interactivemode-methods/ui-utilities.ts";
import * as workingIndicatorDelegates from "./interactivemode-methods/working-indicator.ts";
import type { InteractiveModeMethods } from "./interactivemode-methods.ts";
import { InteractiveModeState } from "./interactivemodestate.ts";
import type { InteractiveModeOptions } from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
export class InteractiveMode extends InteractiveModeState {
  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
    super();
    this.runtimeHost = runtimeHost;
    this.options = options;
    this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
    this.runtimeHost.setBeforeSessionInvalidate(() => {
      this.resetExtensionUI();
    });
    this.runtimeHost.setRebindSession(async () => {
      await this.rebindCurrentSession();
    });
    this.version = VERSION;
    this.ui = new TUI(new ProcessTerminal(), this.settingsManager.getShowHardwareCursor());
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    this.headerContainer = new Container();
    this.chatContainer = new Container();
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.widgetContainerAbove = new Container();
    this.widgetContainerBelow = new Container();
    this.keybindings = KeybindingsManager.create();
    setKeybindings(this.keybindings);
    this.planPanelInputUnsubscribe = this.ui.addInputListener((data) => this.handlePlanPanelInput(data));
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
      paddingX: editorPaddingX,
      autocompleteMaxVisible,
    });
    this.editor = this.defaultEditor;
    this.editorContainer = new Container();
    this.editorContainer.addChild(this.editor as Component);
    this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
    this.footer = new FooterComponent(this.session, this.footerDataProvider);
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
    this.footer.setShowTokenProgress(this.settingsManager.getShowTokenProgress());
    this.footer.setShowTokenStats(this.settingsManager.getShowTokenStats());
    this.footer.setShowIndexingInfo(this.settingsManager.getShowIndexingInfo());

    // Load hide thinking block setting
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

    // Register themes from resource loader and initialize
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    initTheme(this.settingsManager.getTheme(), true);
    this.updateTerminalBackground();

    // Load plan panel settings from persistent storage
    this.planPanelMode = this.settingsManager.getPlanPanelMode();
    this.planPanelCompactWidth = this.settingsManager.getPlanPanelCompactWidth();
    this.planPanelHeight = this.settingsManager.getPlanPanelHeight();
  }

  public static readonly MAX_WIDGET_LINES = 10;

  async showExtensionCustom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T> {
    return extensionCustomDelegates.do_showExtensionCustom(this, factory, options);
  }
}

export interface InteractiveMode extends InteractiveModeMethods {}

installDelegatedMethods(InteractiveMode.prototype, [
  agentSubscriptionDelegates,
  authSelectorDelegates,
  autocompleteSetupDelegates,
  chatMessageDelegates,
  chatRenderingDelegates,
  cloneCommandDelegates,
  compactCommandDelegates,
  debugCommandDelegates,
  diagnosticFormattingDelegates,
  displayFormattingDelegates,
  editorSubmitDelegates,
  eventHandlerDelegates,
  exportCommandDelegates,
  extensionCustomDelegates,
  extensionEditorDelegates,
  extensionUiContextDelegates,
  extensionWidgetsDelegates,
  flushOperationsDelegates,
  hotkeysCommandDelegates,
  initDelegates,
  keyHandlersDelegates,
  lifecycleDelegates,
  loginDialogDelegates,
  memoryCommandDelegates,
  modelCommandDelegates,
  modelSelectorDelegates,
  modelSwitchingDelegates,
  planCommandDelegates,
  planPanelInteractionDelegates,
  planPanelLayoutDelegates,
  queueManagementDelegates,
  resourceDisplayDelegates,
  runLoopDelegates,
  scopeGroupingDelegates,
  sessionBindingDelegates,
  sessionCommandDelegates,
  sessionSelectorDelegates,
  settingsSelectorDelegates,
  shareCommandDelegates,
  startupNoticesDelegates,
  statusCommandDelegates,
  treeSelectorDelegates,
  uiUtilitiesDelegates,
  workingIndicatorDelegates,
]);
