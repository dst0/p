import { describe, expect, it } from "vitest";
import { clearApiProviders, getApiProvider } from "../src/api-registry.ts";
import { complete, fauxAssistantMessage } from "../src/index.ts";
import { registerFauxProvider } from "../src/providers/faux.ts";
import { resetApiProviders } from "../src/providers/register-builtins.ts";

describe("faux provider re-registration", () => {
  it("restores the same provider and queued state after repeated registry refreshes", async () => {
    const registration = registerFauxProvider({ api: "faux-reregistration-test" });
    try {
      registration.setResponses([fauxAssistantMessage("before refresh"), fauxAssistantMessage("after refresh")]);
      expect(getApiProvider(registration.api)).toBeDefined();
      expect(
        (await complete(registration.getModel(), { messages: [{ role: "user", content: "one", timestamp: 1 }] }))
          .content,
      ).toEqual([{ type: "text", text: "before refresh" }]);
      resetApiProviders();
      expect(getApiProvider(registration.api)).toBeUndefined();

      registration.register();
      registration.register();
      expect(getApiProvider(registration.api)).toBeDefined();
      expect(
        (await complete(registration.getModel(), { messages: [{ role: "user", content: "two", timestamp: 2 }] }))
          .content,
      ).toEqual([{ type: "text", text: "after refresh" }]);
      expect(registration.state.callCount).toBe(2);
      registration.unregister();
      expect(getApiProvider(registration.api)).toBeUndefined();
    } finally {
      registration.unregister();
      resetApiProviders();
    }
  });

  it("preserves an explicitly persistent provider across a registry reset", () => {
    const registration = registerFauxProvider({
      api: "faux-persistent-registration-test",
      preserveOnReset: true,
      registerImmediately: false,
    });
    try {
      expect(getApiProvider(registration.api)).toBeUndefined();
      registration.register();
      resetApiProviders();
      expect(getApiProvider(registration.api)).toBeDefined();
      clearApiProviders();
      expect(getApiProvider(registration.api)).toBeUndefined();
    } finally {
      registration.unregister();
      resetApiProviders();
    }
  });

  it("does not replace a persistent owner when built-in providers are restored", () => {
    clearApiProviders();
    const registration = registerFauxProvider({ api: "openai-completions", preserveOnReset: true });
    try {
      const provider = getApiProvider(registration.api);
      resetApiProviders();
      expect(getApiProvider(registration.api)).toBe(provider);
    } finally {
      registration.unregister();
      resetApiProviders();
    }
  });

  it("rejects a different owner for the same API without displacing the first provider", async () => {
    const first = registerFauxProvider({ api: "faux-registration-collision-test" });
    let unexpectedSecond: ReturnType<typeof registerFauxProvider> | undefined;
    try {
      first.setResponses([fauxAssistantMessage("first owner remains active")]);
      expect(() => {
        unexpectedSecond = registerFauxProvider({ api: first.api });
      }).toThrow(/already registered/u);
      expect(
        (await complete(first.getModel(), { messages: [{ role: "user", content: "owner", timestamp: 3 }] })).content,
      ).toEqual([{ type: "text", text: "first owner remains active" }]);
    } finally {
      unexpectedSecond?.unregister();
      first.unregister();
      resetApiProviders();
    }
  });
});
