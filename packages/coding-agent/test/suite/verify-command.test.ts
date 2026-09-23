import { afterEach, describe, expect, it } from "vitest";
import {
  formatVerificationStatus,
  handleVerifyCommand,
} from "../../src/modes/interactive/interactive-mode/interactivemode-methods/verify-command.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("/verify command", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  async function setup(taskVerificationMode: "auto" | "off" = "auto") {
    const harness = await createHarness({ taskVerificationMode });
    harnesses.push(harness);
    const output = { status: [] as string[], warnings: [] as string[], invalidations: 0, renders: 0 };
    const context = {
      session: harness.session,
      showStatus: (message: string) => output.status.push(message),
      showWarning: (message: string) => output.warnings.push(message),
      footer: { invalidate: () => output.invalidations++ },
      ui: { requestRender: () => output.renders++ },
    };
    return { harness, output, context };
  }

  it.each(["/verify", "/verify status"])("shows the current tier for %s", async (command) => {
    const { output, context } = await setup();

    handleVerifyCommand(context, command);

    expect(output.status).toEqual(["Verification: auto (settings); tier LIGHT — default"]);
    expect(output.warnings).toEqual([]);
    expect(output.invalidations).toBe(1);
    expect(output.renders).toBe(1);
  });

  it("applies a session override and reports it", async () => {
    const { harness, output, context } = await setup();

    handleVerifyCommand(context, "/verify strict");

    expect(harness.session.getVerificationTierStatus()).toMatchObject({ policy: "strict", tier: "strict" });
    expect(output.status).toEqual(["Verification: strict (session override); tier STRICT — /verify"]);
  });

  it("rejects unknown policies without changing the session", async () => {
    const { harness, output, context } = await setup();

    handleVerifyCommand(context, "/verify evidence");

    expect(output.warnings).toEqual([
      "Usage: /verify [auto|light|strict|off] — no argument shows the current verification tier.",
    ]);
    expect(harness.session.getVerificationTierStatus()).toMatchObject({ policy: "auto", policyOverridden: false });
  });

  it("refuses to change verification while work is streaming", async () => {
    const { harness, output, context } = await setup();

    const streamingSession = Object.create(harness.session, { isStreaming: { value: true } });
    handleVerifyCommand({ ...context, session: streamingSession }, "/verify light");

    expect(output.warnings).toEqual(["Stop active work before changing verification."]);
    expect(harness.session.getVerificationTierStatus()?.policyOverridden).toBe(false);
  });

  it("shows OFF and explains that tiers need a restart when verification is off in settings", async () => {
    const { output, context } = await setup("off");

    handleVerifyCommand(context, "/verify");
    handleVerifyCommand(context, "/verify strict");

    expect(output.status).toEqual(["Verification: off (settings); nothing verified — default"]);
    expect(output.warnings).toHaveLength(1);
    expect(output.warnings[0]).toContain("Task verification is off in settings");
  });

  it("formats escalation causes with their trigger", () => {
    expect(
      formatVerificationStatus({
        policy: "auto",
        policyOverridden: false,
        tier: "strict",
        reason: "effect_source",
        trigger: "src/a.ts",
        active: true,
        pendingPolicy: "light",
      }),
    ).toBe("Verification: auto (settings); tier STRICT — source change: src/a.ts; switches to light at the next turn");
  });
});
