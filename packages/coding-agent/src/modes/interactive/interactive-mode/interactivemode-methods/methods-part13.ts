import type { Component } from "@dst0/p-tui";
import type { EditorFactory, ExtensionUIDialogOptions } from "../../../../core/extensions/index.ts";
import { ExtensionEditorComponent } from "../../components/extension-editor.ts";
import { ExtensionInputComponent } from "../../components/extension-input.ts";
import { getEditorTheme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showExtensionInput(
  self: InteractiveMode,
  title: string,
  placeholder?: string,
  opts?: ExtensionUIDialogOptions,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (opts?.signal?.aborted) {
      resolve(undefined);
      return;
    }

    const onAbort = () => {
      self.hideExtensionInput();
      resolve(undefined);
    };
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    self.extensionInput = new ExtensionInputComponent(
      title,
      placeholder,
      (value) => {
        opts?.signal?.removeEventListener("abort", onAbort);
        self.hideExtensionInput();
        resolve(value);
      },
      () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        self.hideExtensionInput();
        resolve(undefined);
      },
      { tui: self.ui, timeout: opts?.timeout },
    );

    self.editorContainer.clear();
    self.editorContainer.addChild(self.extensionInput);
    self.ui.setFocus(self.extensionInput);
    self.ui.requestRender();
  });
}

export function do_hideExtensionInput(self: InteractiveMode): void {
  self.extensionInput?.dispose();
  self.editorContainer.clear();
  self.editorContainer.addChild(self.editor);
  self.extensionInput = undefined;
  self.ui.setFocus(self.editor);
  self.ui.requestRender();
}

export function do_showExtensionEditor(
  self: InteractiveMode,
  title: string,
  prefill?: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    self.extensionEditor = new ExtensionEditorComponent(
      self.ui,
      self.keybindings,
      title,
      prefill,
      (value) => {
        self.hideExtensionEditor();
        resolve(value);
      },
      () => {
        self.hideExtensionEditor();
        resolve(undefined);
      },
    );

    self.editorContainer.clear();
    self.editorContainer.addChild(self.extensionEditor);
    self.ui.setFocus(self.extensionEditor);
    self.ui.requestRender();
  });
}

export function do_hideExtensionEditor(self: InteractiveMode): void {
  self.editorContainer.clear();
  self.editorContainer.addChild(self.editor);
  self.extensionEditor = undefined;
  self.ui.setFocus(self.editor);
  self.ui.requestRender();
}

export function do_setCustomEditorComponent(self: InteractiveMode, factory: EditorFactory | undefined): void {
  self.editorComponentFactory = factory;

  // Save text from current editor before switching
  const currentText = self.editor.getText();

  self.editorContainer.clear();

  if (factory) {
    // Create the custom editor with tui, theme, and keybindings
    const newEditor = factory(self.ui, getEditorTheme(), self.keybindings);

    // Wire up callbacks from the default editor
    newEditor.onSubmit = self.defaultEditor.onSubmit;
    newEditor.onChange = self.defaultEditor.onChange;

    // Copy text from previous editor
    newEditor.setText(currentText);

    // Copy appearance settings if supported
    if (newEditor.borderColor !== undefined) {
      newEditor.borderColor = self.defaultEditor.borderColor;
    }
    if (newEditor.setPaddingX !== undefined) {
      newEditor.setPaddingX(self.defaultEditor.getPaddingX());
    }

    // Set autocomplete if supported
    if (newEditor.setAutocompleteProvider && self.autocompleteProvider) {
      newEditor.setAutocompleteProvider(self.autocompleteProvider);
    }

    // If extending CustomEditor, copy app-level handlers
    // Use duck typing since instanceof fails across jiti module boundaries
    const customEditor = newEditor as unknown as Record<string, unknown>;
    if ("actionHandlers" in customEditor && customEditor.actionHandlers instanceof Map) {
      if (!customEditor.onEscape) {
        customEditor.onEscape = () => self.defaultEditor.onEscape?.();
      }
      if (!customEditor.onCtrlD) {
        customEditor.onCtrlD = () => self.defaultEditor.onCtrlD?.();
      }
      if (!customEditor.onPasteImage) {
        customEditor.onPasteImage = () => self.defaultEditor.onPasteImage?.();
      }
      if (!customEditor.onExtensionShortcut) {
        customEditor.onExtensionShortcut = (data: string) => self.defaultEditor.onExtensionShortcut?.(data);
      }
      // Copy action handlers (clear, suspend, model switching, etc.)
      for (const [action, handler] of self.defaultEditor.actionHandlers) {
        (customEditor.actionHandlers as Map<string, () => void>).set(action, handler);
      }
    }

    self.editor = newEditor;
  } else {
    // Restore default editor with text from custom editor
    self.defaultEditor.setText(currentText);
    self.editor = self.defaultEditor;
  }

  self.editorContainer.addChild(self.editor as Component);
  self.ui.setFocus(self.editor as Component);
  self.ui.requestRender();
}

export function do_showExtensionNotify(
  self: InteractiveMode,
  message: string,
  type?: "info" | "warning" | "error",
): void {
  if (type === "error") {
    self.showError(message);
  } else if (type === "warning") {
    self.showWarning(message);
  } else {
    self.showStatus(message);
  }
}
