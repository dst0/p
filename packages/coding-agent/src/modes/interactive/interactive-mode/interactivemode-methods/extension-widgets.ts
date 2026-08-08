import { type Component, type Container, Spacer, type TUI } from "@dst0/p-tui";
import type { ReadonlyFooterDataProvider } from "../../../../core/footer-data-provider.ts";
import { keyText } from "../../components/keybinding-hints.ts";
import { type Theme, theme } from "../../theme/theme.ts";
import { isExpandable } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_clearExtensionWidgets(self: InteractiveMode): void {
  for (const widget of self.extensionWidgetsAbove.values()) {
    widget.dispose?.();
  }
  for (const widget of self.extensionWidgetsBelow.values()) {
    widget.dispose?.();
  }
  self.extensionWidgetsAbove.clear();
  self.extensionWidgetsBelow.clear();
  self.renderWidgets();
}

export function do_resetExtensionUI(self: InteractiveMode): void {
  if (self.extensionSelector) {
    self.hideExtensionSelector();
  }
  if (self.extensionInput) {
    self.hideExtensionInput();
  }
  if (self.extensionEditor) {
    self.hideExtensionEditor();
  }
  self.ui.hideOverlay();
  self.clearExtensionTerminalInputListeners();
  self.setExtensionFooter(undefined);
  self.setExtensionHeader(undefined);
  self.clearExtensionWidgets();
  self.footerDataProvider.clearExtensionStatuses();
  self.footer.invalidate();
  self.autocompleteProviderWrappers = [];
  self.setCustomEditorComponent(undefined);
  self.setupAutocompleteProvider();
  self.defaultEditor.onExtensionShortcut = undefined;
  self.updateTerminalTitle();
  self.workingMessage = undefined;
  self.workingVisible = true;
  self.setWorkingIndicator();
  if (self.loadingAnimation) {
    self.loadingAnimation.setMessage(`${self.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`);
  }
  self.setHiddenThinkingLabel();
}

export function do_renderWidgets(self: InteractiveMode): void {
  if (!self.widgetContainerAbove || !self.widgetContainerBelow) return;
  self.renderWidgetContainer(self.widgetContainerAbove, self.extensionWidgetsAbove, true, true);
  self.renderWidgetContainer(self.widgetContainerBelow, self.extensionWidgetsBelow, false, false);
  self.ui.requestRender();
}

export function do_renderWidgetContainer(
  _self: InteractiveMode,
  container: Container,
  widgets: Map<string, Component & { dispose?(): void }>,
  spacerWhenEmpty: boolean,
  leadingSpacer: boolean,
): void {
  container.clear();

  if (widgets.size === 0) {
    if (spacerWhenEmpty) {
      container.addChild(new Spacer(1));
    }
    return;
  }

  if (leadingSpacer) {
    container.addChild(new Spacer(1));
  }
  for (const component of widgets.values()) {
    container.addChild(component);
  }
}

export function do_setExtensionFooter(
  self: InteractiveMode,
  factory:
    | ((tui: TUI, thm: Theme, footerData: ReadonlyFooterDataProvider) => Component & { dispose?(): void })
    | undefined,
): void {
  // Dispose existing custom footer
  if (self.customFooter?.dispose) {
    self.customFooter.dispose();
  }

  // Remove current footer from UI
  if (self.customFooter) {
    self.ui.removeChild(self.customFooter);
  } else {
    self.ui.removeChild(self.footer);
  }

  if (factory) {
    // Create and add custom footer, passing the data provider
    self.customFooter = factory(self.ui, theme, self.footerDataProvider);
    self.ui.addChild(self.customFooter);
  } else {
    // Restore built-in footer
    self.customFooter = undefined;
    self.ui.addChild(self.footer);
  }

  self.ui.requestRender();
}

export function do_setExtensionHeader(
  self: InteractiveMode,
  factory: ((tui: TUI, thm: Theme) => Component & { dispose?(): void }) | undefined,
): void {
  // Header may not be initialized yet if called during early initialization
  if (!self.builtInHeader) {
    return;
  }

  // Dispose existing custom header
  if (self.customHeader?.dispose) {
    self.customHeader.dispose();
  }

  // Find the index of the current header in the header container
  const currentHeader = self.customHeader || self.builtInHeader;
  const index = self.headerContainer.children.indexOf(currentHeader);

  if (factory) {
    // Create and add custom header
    self.customHeader = factory(self.ui, theme);
    if (isExpandable(self.customHeader)) {
      self.customHeader.setExpanded(self.toolOutputExpanded);
    }
    if (index !== -1) {
      self.headerContainer.children[index] = self.customHeader;
    } else {
      // If not found (e.g. builtInHeader was never added), add at the top
      self.headerContainer.children.unshift(self.customHeader);
    }
  } else {
    // Restore built-in header
    self.customHeader = undefined;
    if (isExpandable(self.builtInHeader)) {
      self.builtInHeader.setExpanded(self.toolOutputExpanded);
    }
    if (index !== -1) {
      self.headerContainer.children[index] = self.builtInHeader;
    }
  }

  self.ui.requestRender();
}

export function do_addExtensionTerminalInputListener(
  self: InteractiveMode,
  handler: (data: string) => { consume?: boolean; data?: string } | undefined,
): () => void {
  const unsubscribe = self.ui.addInputListener(handler);
  self.extensionTerminalInputUnsubscribers.add(unsubscribe);
  return () => {
    unsubscribe();
    self.extensionTerminalInputUnsubscribers.delete(unsubscribe);
  };
}

export function do_clearExtensionTerminalInputListeners(self: InteractiveMode): void {
  for (const unsubscribe of self.extensionTerminalInputUnsubscribers) {
    unsubscribe();
  }
  self.extensionTerminalInputUnsubscribers.clear();
}
