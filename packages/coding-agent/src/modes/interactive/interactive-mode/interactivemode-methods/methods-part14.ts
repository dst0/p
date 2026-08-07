import type { OverlayHandle, OverlayOptions } from "@dst0/p-tui";
import { type Component, Text, type TUI } from "@dst0/p-tui";
import type { KeybindingsManager } from "../../../../core/keybindings.ts";
import { type Theme, theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_showExtensionCustom<T>(
  self: InteractiveMode,
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
  const savedText = self.editor.getText();
  const isOverlay = options?.overlay ?? false;

  const restoreEditor = () => {
    self.editorContainer.clear();
    self.editorContainer.addChild(self.editor);
    self.editor.setText(savedText);
    self.ui.setFocus(self.editor);
    self.ui.requestRender();
  };

  return new Promise((resolve, reject) => {
    let component: Component & { dispose?(): void };
    let closed = false;

    const close = (result: T) => {
      if (closed) return;
      closed = true;
      if (isOverlay) self.ui.hideOverlay();
      else restoreEditor();
      // Note: both branches above already call requestRender
      resolve(result);
      try {
        component?.dispose?.();
      } catch {
        /* ignore dispose errors */
      }
    };

    Promise.resolve(factory(self.ui, theme, self.keybindings, close))
      .then((c) => {
        if (closed) return;
        component = c;
        if (isOverlay) {
          // Resolve overlay options - can be static or dynamic function
          const resolveOptions = (): OverlayOptions | undefined => {
            if (options?.overlayOptions) {
              const opts =
                typeof options.overlayOptions === "function" ? options.overlayOptions() : options.overlayOptions;
              return opts;
            }
            // Fallback: use component's width property if available
            const w = (component as { width?: number }).width;
            return w ? { width: w } : undefined;
          };
          const handle = self.ui.showOverlay(component, resolveOptions());
          // Expose handle to caller for visibility control
          options?.onHandle?.(handle);
        } else {
          self.editorContainer.clear();
          self.editorContainer.addChild(component);
          self.ui.setFocus(component);
          self.ui.requestRender();
        }
      })
      .catch((err) => {
        if (closed) return;
        if (!isOverlay) restoreEditor();
        reject(err);
      });
  });
}

export function do_showExtensionError(
  self: InteractiveMode,
  extensionPath: string,
  error: string,
  stack?: string,
): void {
  const errorMsg = `Extension "${extensionPath}" error: ${error}`;
  const errorText = new Text(theme.fg("error", errorMsg), 1, 0);
  self.chatContainer.addChild(errorText);
  if (stack) {
    // Show stack trace in dim color, indented
    const stackLines = stack
      .split("\n")
      .slice(1) // Skip first line (duplicates error message)
      .map((line) => theme.fg("dim", `  ${line.trim()}`))
      .join("\n");
    if (stackLines) {
      self.chatContainer.addChild(new Text(stackLines, 1, 0));
    }
  }
  self.ui.requestRender();
}
