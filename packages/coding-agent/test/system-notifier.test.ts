import child_process from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSystemNotification } from "../src/utils/system-notifier.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("system desktop notifications", () => {
  it("dispatches AppleScript on macOS (darwin)", () => {
    let executedCommand = "";
    let executedArgs: string[] = [];
    vi.spyOn(child_process, "execFile").mockImplementation((file, args: any) => {
      executedCommand = file;
      executedArgs = args;
      return {} as any;
    });

    sendSystemNotification({ title: 'Test "Title"', message: 'Test "Message"', platform: "darwin" });

    expect(executedCommand).toBe("osascript");
    expect(executedArgs[0]).toBe("-e");
    expect(executedArgs[1]).toContain('display notification "Test \\"Message\\"" with title "Test \\"Title\\""');
  });

  it("dispatches notify-send on Linux", () => {
    let executedCommand = "";
    let executedArgs: string[] = [];
    vi.spyOn(child_process, "execFile").mockImplementation((file, args: any) => {
      executedCommand = file;
      executedArgs = args;
      return {} as any;
    });

    sendSystemNotification({ title: "Linux Title", message: "Linux Body", platform: "linux" });

    expect(executedCommand).toBe("notify-send");
    expect(executedArgs).toEqual(["Linux Title", "Linux Body"]);
  });

  it("dispatches PowerShell Toast on Windows (win32)", () => {
    let executedCommand = "";
    let executedArgs: string[] = [];
    vi.spyOn(child_process, "execFile").mockImplementation((file, args: any) => {
      executedCommand = file;
      executedArgs = args;
      return {} as any;
    });

    sendSystemNotification({ title: "Win Title", message: "Win Body", platform: "win32" });

    expect(executedCommand).toBe("powershell.exe");
    expect(executedArgs[0]).toBe("-NoProfile");
    expect(executedArgs[1]).toBe("-Command");
    expect(executedArgs[2]).toContain("Windows.UI.Notifications");
  });

  it("supports a custom dispatcher callback", () => {
    let customFile = "";
    let customArgs: string[] = [];
    sendSystemNotification({
      title: "Custom",
      message: "Dispatcher",
      platform: "linux",
      dispatcher: (file, args, cb) => {
        customFile = file;
        customArgs = args;
        cb();
      },
    });
    expect(customFile).toBe("notify-send");
    expect(customArgs).toEqual(["Custom", "Dispatcher"]);
  });

  it("handles execFile dispatch errors gracefully without throwing", () => {
    vi.spyOn(child_process, "execFile").mockImplementation(() => {
      throw new Error("Command not found");
    });

    expect(() => {
      sendSystemNotification({ title: "Title", message: "Body", platform: "darwin" });
    }).not.toThrow();
  });
});
