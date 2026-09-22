import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { do_reportInstallTelemetry } from "../src/modes/interactive/interactive-mode/interactivemode-methods/display-formatting.ts";
import { getPiUserAgent } from "../src/utils/pi-user-agent.ts";

const ENV_NAMES = ["P_OFFLINE", "P_TELEMETRY"] as const;

function modeWithTelemetrySetting(enabled: boolean): InteractiveMode {
  return { settingsManager: { getEnableInstallTelemetry: () => enabled } } as unknown as InteractiveMode;
}

/** Lets pending promise callbacks scheduled by the ping settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("install/update telemetry ping", () => {
  let originalEnv: Map<string, string | undefined>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
    for (const name of ENV_NAMES) delete process.env[name];
    fetchMock = vi.fn(async () => new Response("Method Not Allowed", { status: 405 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("sends a bodiless GET with the version and p user agent to the project's own Pages domain", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    do_reportInstallTelemetry(modeWithTelemetrySetting(true), "1.2.3");
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(target);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("p-agent.pages.dev");
    expect(url.pathname).toBe("/api/report-install");
    expect([...url.searchParams]).toEqual([["version", "1.2.3"]]);
    expect(init.headers).toEqual({ "User-Agent": getPiUserAgent("1.2.3") });
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5000);
    expect(init.signal).toBe(timeout.mock.results[0]?.value);
  });

  it("returns immediately and never surfaces or retries a failed ping", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    fetchMock.mockImplementation(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND");
    });

    try {
      expect(do_reportInstallTelemetry(modeWithTelemetrySetting(true), "1.2.3")).toBeUndefined();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      await settle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not wait for a ping that never completes", () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    expect(do_reportInstallTelemetry(modeWithTelemetrySetting(true), "1.2.3")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["the enableInstallTelemetry setting is false", false, {}],
    ["P_TELEMETRY=0 overrides an enabled setting", true, { P_TELEMETRY: "0" }],
    ["offline mode is enabled", true, { P_OFFLINE: "1" }],
  ])(
    "sends nothing when %s",
    async (_label, settingEnabled, env: Partial<Record<(typeof ENV_NAMES)[number], string>>) => {
      Object.assign(process.env, env);

      do_reportInstallTelemetry(modeWithTelemetrySetting(settingEnabled), "1.2.3");
      await settle();

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("lets P_TELEMETRY=1 enable the ping when the setting is off", async () => {
    process.env.P_TELEMETRY = "1";

    do_reportInstallTelemetry(modeWithTelemetrySetting(false), "1.2.3");
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).host).toBe("p-agent.pages.dev");
  });
});
