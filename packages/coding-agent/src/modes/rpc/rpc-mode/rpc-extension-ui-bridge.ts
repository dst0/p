import * as crypto from "node:crypto";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  WorkingIndicatorOptions,
} from "../../../core/extensions/index.ts";
import { type Theme, theme } from "../../interactive/theme/theme.ts";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse, RpcResponse } from "../rpc-types.ts";

type RpcOutput = (value: RpcResponse | RpcExtensionUIRequest | object) => void;

export class RpcExtensionUIBridge {
  private readonly output: RpcOutput;
  private readonly pendingRequests = new Map<
    string,
    { resolve: (response: RpcExtensionUIResponse) => void; reject: (error: Error) => void }
  >();

  constructor(output: RpcOutput) {
    this.output = output;
  }

  resolveResponse(response: RpcExtensionUIResponse): boolean {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return false;
    this.pendingRequests.delete(response.id);
    pending.resolve(response);
    return true;
  }

  private createDialogPromise<T>(
    options: ExtensionUIDialogOptions | undefined,
    defaultValue: T,
    request: Record<string, unknown>,
    parseResponse: (response: RpcExtensionUIResponse) => T,
  ): Promise<T> {
    if (options?.signal?.aborted) return Promise.resolve(defaultValue);

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        options?.signal?.removeEventListener("abort", onAbort);
        this.pendingRequests.delete(id);
      };
      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      if (options?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, options.timeout);
      }
      this.pendingRequests.set(id, {
        resolve: (response) => {
          cleanup();
          resolve(parseResponse(response));
        },
        reject,
      });
      this.output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
    });
  }

  createContext(): ExtensionUIContext {
    const bridge = this;
    return {
      select: (title, options, dialogOptions) =>
        bridge.createDialogPromise(
          dialogOptions,
          undefined,
          { method: "select", title, options, timeout: dialogOptions?.timeout },
          (response) =>
            "cancelled" in response && response.cancelled
              ? undefined
              : "value" in response
                ? response.value
                : undefined,
        ),
      confirm: (title, message, dialogOptions) =>
        bridge.createDialogPromise(
          dialogOptions,
          false,
          { method: "confirm", title, message, timeout: dialogOptions?.timeout },
          (response) =>
            "cancelled" in response && response.cancelled
              ? false
              : "confirmed" in response
                ? response.confirmed
                : false,
        ),
      input: (title, placeholder, dialogOptions) =>
        bridge.createDialogPromise(
          dialogOptions,
          undefined,
          { method: "input", title, placeholder, timeout: dialogOptions?.timeout },
          (response) =>
            "cancelled" in response && response.cancelled
              ? undefined
              : "value" in response
                ? response.value
                : undefined,
        ),
      notify(message: string, type?: "info" | "warning" | "error"): void {
        bridge.output({
          type: "extension_ui_request",
          id: crypto.randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as RpcExtensionUIRequest);
      },
      onTerminalInput: () => () => {},
      setStatus(key: string, text: string | undefined): void {
        bridge.output({
          type: "extension_ui_request",
          id: crypto.randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as RpcExtensionUIRequest);
      },
      setWorkingMessage(_message?: string): void {},
      setWorkingVisible(_visible: boolean): void {},
      setWorkingIndicator(_options?: WorkingIndicatorOptions): void {},
      setHiddenThinkingLabel(_label?: string): void {},
      setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
        if (content !== undefined && !Array.isArray(content)) return;
        bridge.output({
          type: "extension_ui_request",
          id: crypto.randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content as string[] | undefined,
          widgetPlacement: options?.placement,
        } as RpcExtensionUIRequest);
      },
      setFooter(_factory: unknown): void {},
      setHeader(_factory: unknown): void {},
      setTitle(title: string): void {
        bridge.output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "setTitle", title });
      },
      async custom() {
        return undefined as never;
      },
      pasteToEditor(text: string): void {
        this.setEditorText(text);
      },
      setEditorText(text: string): void {
        bridge.output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "set_editor_text", text });
      },
      getEditorText: () => "",
      async editor(title: string, prefill?: string): Promise<string | undefined> {
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          bridge.pendingRequests.set(id, {
            resolve: (response) =>
              resolve(
                "cancelled" in response && response.cancelled
                  ? undefined
                  : "value" in response
                    ? response.value
                    : undefined,
              ),
            reject,
          });
          bridge.output({ type: "extension_ui_request", id, method: "editor", title, prefill });
        });
      },
      addAutocompleteProvider(): void {},
      setEditorComponent(): void {},
      getEditorComponent: () => undefined,
      get theme() {
        return theme;
      },
      getAllThemes: () => [],
      getTheme: (_name: string) => undefined,
      setTheme(_theme: string | Theme) {
        return { success: false, error: "Theme switching not supported in RPC mode" };
      },
      getToolsExpanded: () => false,
      setToolsExpanded(_expanded: boolean): void {},
    };
  }
}
