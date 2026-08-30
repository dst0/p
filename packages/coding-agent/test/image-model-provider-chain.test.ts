import { generateImages, type ImagesApi, type ImagesModel } from "@dst0/p-ai";
import { setKeybindings } from "@dst0/p-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { do_resolveImageModel } from "../src/core/agent-session/agentsession-methods/model-resolution.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { ImageModelSelectorComponent } from "../src/modes/interactive/components/image-model-selector.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_showImageModelSelector } from "../src/modes/interactive/interactive-mode/interactivemode-methods/model-command.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const configuredProviderModel = {
  id: "mini-pc/text-model",
  name: "Mini PC text model",
  api: "openai-completions",
  provider: "mini-pc-11450",
  baseUrl: "https://orchestrator.example/v1",
  input: ["text"],
  output: ["text"],
  contextWindow: 32_768,
  maxTokens: 8_192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe("configured image provider selection chain", () => {
  beforeAll(() => initTheme("dark"));
  beforeEach(() => setKeybindings(new KeybindingsManager()));

  it("preserves the configured orchestrator endpoint and auth from selector through request", async () => {
    let selectedProvider = "mini-pc-11450";
    let selectedModel = "flux2-klein-4b";
    let sessionModel: ImagesModel<ImagesApi> | undefined;
    let selector: ImageModelSelectorComponent | undefined;
    const setSessionModel = vi.fn((model: ImagesModel<ImagesApi>) => {
      sessionModel = model;
    });
    const persistSelection = vi.fn((provider: string, model: string) => {
      selectedProvider = provider;
      selectedModel = model;
    });
    const showStatus = vi.fn();
    const registry = {
      getAll: () => [configuredProviderModel],
      getApiKeyAndHeaders: async () => ({ ok: true as const, headers: { "x-api-key": "custom-secret" } }),
      getApiKeyForProvider: async () => undefined,
    };
    const settingsManager = {
      getDefaultImageProvider: () => selectedProvider,
      getDefaultImageModel: () => selectedModel,
      setDefaultImageModelAndProvider: persistSelection,
    };
    const mode = {
      ui: { requestRender: vi.fn() },
      session: {
        getImageModel: () => sessionModel,
        setImageModel: setSessionModel,
        modelRegistry: registry,
      },
      settingsManager,
      showSelector: (factory: (done: () => void) => { component: ImageModelSelectorComponent }) => {
        selector = factory(vi.fn()).component;
      },
      showStatus,
    } as unknown as InteractiveMode;

    do_showImageModelSelector(mode, "flux2");
    expect(selector).toBeDefined();
    selector?.handleInput("\r");
    expect(setSessionModel).toHaveBeenCalledOnce();
    expect(persistSelection).toHaveBeenCalledWith("mini-pc-11450", "flux2-klein-4b");
    expect(showStatus).toHaveBeenCalledWith("Image Model: mini-pc-11450/flux2-klein-4b");
    expect(sessionModel).toMatchObject({ provider: "mini-pc-11450", id: "flux2-klein-4b" });
    expect(selectedProvider).toBe("mini-pc-11450");

    const resolved = await do_resolveImageModel({
      _imageModel: sessionModel,
      modelRegistry: registry,
      settingsManager,
    } as never);
    expect(resolved?.model.baseUrl).toBe("https://orchestrator.example/v1");

    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), { status: 200 });
    };
    const result = await generateImages(
      resolved!.model,
      { input: [{ type: "text", text: "draw a lighthouse" }] },
      { apiKey: resolved?.apiKey, headers: resolved?.headers, fetch },
    );

    expect(result.stopReason).toBe("stop");
    expect(requestUrl).toBe("https://orchestrator.example/v1/images/generations");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("x-api-key")).toBe("custom-secret");
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      model: "flux2-klein-4b",
      response_format: "b64_json",
    });
  });
});
