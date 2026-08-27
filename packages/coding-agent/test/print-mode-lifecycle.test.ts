import type { ImageContent } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { createAssistantMessage, createRuntimeHost } from "./print-mode-test-support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runPrintMode lifecycle", () => {
  it("emits session_shutdown in text mode", async () => {
    const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
    const { session } = runtimeHost;
    const images: ImageContent[] = [{ type: "image", mimeType: "image/png", data: "abc" }];

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "Say done",
      initialImages: images,
    });

    expect(exitCode).toBe(0);
    expect(session.prompt).toHaveBeenCalledWith("Say done", { images });
    expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
    expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
  });

  it("emits session_shutdown in json mode", async () => {
    const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
    const { session } = runtimeHost;

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "json",
      messages: ["hello"],
    });

    expect(exitCode).toBe(0);
    expect(session.prompt).toHaveBeenCalledWith("hello");
    expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
    expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
  });

  it("emits session_shutdown and returns non-zero on assistant error", async () => {
    const runtimeHost = createRuntimeHost(
      createAssistantMessage({ stopReason: "error", errorMessage: "provider failure" }),
    );
    const { session } = runtimeHost;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
    });

    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("provider failure");
    expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
    expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
  });
});
