import { afterEach, describe, expect, test, vi } from "vitest";
import { RpcExtensionUIBridge } from "../src/modes/rpc/rpc-mode/rpc-extension-ui-bridge.ts";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "../src/modes/rpc/rpc-types.ts";

function createHarness() {
  const requests: RpcExtensionUIRequest[] = [];
  const bridge = new RpcExtensionUIBridge((value) => requests.push(value as RpcExtensionUIRequest));
  return { bridge, context: bridge.createContext(), requests };
}

function latestRequest(requests: RpcExtensionUIRequest[]): RpcExtensionUIRequest {
  const request = requests.at(-1);
  if (!request) throw new Error("Expected an RPC UI request");
  return request;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RPC extension UI bridge", () => {
  test("resolves select, confirm, input, and editor dialogs", async () => {
    const { bridge, context, requests } = createHarness();

    const selectPromise = context.select("Select", ["a", "b"]);
    const selectRequest = latestRequest(requests);
    expect(selectRequest).toMatchObject({ method: "select", title: "Select", options: ["a", "b"] });
    expect(bridge.resolveResponse({ type: "extension_ui_response", id: selectRequest.id, value: "b" })).toBe(true);
    await expect(selectPromise).resolves.toBe("b");

    const confirmPromise = context.confirm("Confirm", "Continue?");
    const confirmRequest = latestRequest(requests);
    bridge.resolveResponse({ type: "extension_ui_response", id: confirmRequest.id, confirmed: true });
    await expect(confirmPromise).resolves.toBe(true);

    const inputPromise = context.input("Input", "placeholder");
    const inputRequest = latestRequest(requests);
    bridge.resolveResponse({ type: "extension_ui_response", id: inputRequest.id, cancelled: true });
    await expect(inputPromise).resolves.toBeUndefined();

    const editorPromise = context.editor("Editor", "prefill");
    const editorRequest = latestRequest(requests);
    expect(editorRequest).toMatchObject({ method: "editor", title: "Editor", prefill: "prefill" });
    bridge.resolveResponse({ type: "extension_ui_response", id: editorRequest.id, value: "edited" });
    await expect(editorPromise).resolves.toBe("edited");

    const cancelledEditorPromise = context.editor("Editor");
    const cancelledEditorRequest = latestRequest(requests);
    bridge.resolveResponse({ type: "extension_ui_response", id: cancelledEditorRequest.id, cancelled: true });
    await expect(cancelledEditorPromise).resolves.toBeUndefined();
    expect(bridge.resolveResponse({ type: "extension_ui_response", id: "missing", cancelled: true })).toBe(false);
  });

  test("uses defaults for pre-aborted, aborted, timed out, and malformed dialogs", async () => {
    vi.useFakeTimers();
    const { bridge, context, requests } = createHarness();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    await expect(context.select("Select", [], { signal: alreadyAborted.signal })).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);

    const abortController = new AbortController();
    const confirmPromise = context.confirm("Confirm", "Continue?", { signal: abortController.signal });
    abortController.abort();
    await expect(confirmPromise).resolves.toBe(false);

    const inputPromise = context.input("Input", undefined, { timeout: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(inputPromise).resolves.toBeUndefined();

    const selectPromise = context.select("Select", ["a"]);
    const selectRequest = latestRequest(requests);
    bridge.resolveResponse({ type: "extension_ui_response", id: selectRequest.id, confirmed: true });
    await expect(selectPromise).resolves.toBeUndefined();

    const confirmMalformed = context.confirm("Confirm", "Continue?");
    const confirmMalformedRequest = latestRequest(requests);
    bridge.resolveResponse({ type: "extension_ui_response", id: confirmMalformedRequest.id, value: "yes" });
    await expect(confirmMalformed).resolves.toBe(false);
  });

  test("emits one-way UI requests and implements RPC-safe fallbacks", async () => {
    const { context, requests } = createHarness();

    context.notify("Heads up", "warning");
    context.setStatus("build", "running");
    context.setWidget("invalid", "not-lines" as never);
    context.setWidget("valid", ["line"], { placement: "aboveEditor" });
    context.setWidget("clear", undefined);
    context.setTitle("RPC title");
    context.setEditorText("direct");
    context.pasteToEditor("pasted");

    expect(requests.map((request) => request.method)).toEqual([
      "notify",
      "setStatus",
      "setWidget",
      "setWidget",
      "setTitle",
      "set_editor_text",
      "set_editor_text",
    ]);
    expect(context.onTerminalInput(() => ({ consume: false }))).toBeTypeOf("function");
    context.setWorkingMessage("working");
    context.setWorkingVisible(true);
    context.setWorkingIndicator({});
    context.setHiddenThinkingLabel("Thinking");
    context.setFooter(undefined);
    context.setHeader(undefined);
    context.addAutocompleteProvider((current) => current);
    context.setEditorComponent(undefined);
    context.setToolsExpanded(true);
    expect(context.getEditorText()).toBe("");
    expect(context.getEditorComponent()).toBeUndefined();
    expect(context.getAllThemes()).toEqual([]);
    expect(context.getTheme("missing")).toBeUndefined();
    expect(context.getToolsExpanded()).toBe(false);
    expect(context.setTheme("dark")).toEqual({ success: false, error: "Theme switching not supported in RPC mode" });
    await expect(context.custom("custom" as never, undefined)).resolves.toBeUndefined();
    expect(context.theme).toBeDefined();
  });

  test("returns cancellation defaults for every dialog response shape", async () => {
    const { bridge, context, requests } = createHarness();
    const cases: Array<{
      promise: Promise<unknown>;
      response: (id: string) => RpcExtensionUIResponse;
      expected: unknown;
    }> = [
      {
        promise: context.select("Select", ["a"]),
        response: (id) => ({ type: "extension_ui_response", id, cancelled: true }),
        expected: undefined,
      },
      {
        promise: context.confirm("Confirm", "Continue?"),
        response: (id) => ({ type: "extension_ui_response", id, cancelled: true }),
        expected: false,
      },
      {
        promise: context.input("Input"),
        response: (id) => ({ type: "extension_ui_response", id, value: "value" }),
        expected: "value",
      },
    ];

    for (let index = 0; index < cases.length; index++) {
      const request = requests[index];
      bridge.resolveResponse(cases[index].response(request.id));
      await expect(cases[index].promise).resolves.toBe(cases[index].expected);
    }
  });
});
