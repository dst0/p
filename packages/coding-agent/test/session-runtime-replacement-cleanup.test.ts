import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import {
  replaceSessionRuntimeTransaction,
  type SessionRuntimeBinding,
} from "../src/core/session-runtime-replacement.ts";

const shutdownEvent = vi.hoisted(() => vi.fn());
vi.mock("../src/core/extensions/runner.ts", () => ({ emitSessionShutdownEvent: shutdownEvent }));

function createSession(extensionsStarted: boolean) {
  return {
    extensionRunner: {
      suspend: vi.fn(),
      resume: vi.fn(),
    },
    extensionsStarted,
    sessionFile: "/tmp/session.jsonl",
    bindExtensions: vi.fn(async () => undefined),
    createReplacedSessionContext: vi.fn(() => ({})),
    dispose: vi.fn(),
  } as unknown as AgentSession;
}

function createBinding(session: AgentSession): SessionRuntimeBinding {
  return {
    session,
    services: {} as SessionRuntimeBinding["services"],
    diagnostics: [],
  };
}

describe("session runtime replacement cleanup", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("retains a replacement shutdown failure when rollback also has an original error", async () => {
    const previousSession = createSession(true);
    const replacementSession = createSession(true);
    const originalError = new Error("with-session failed");
    const cleanupError = new Error("replacement shutdown failed");
    shutdownEvent.mockResolvedValueOnce(true).mockRejectedValueOnce(cleanupError);
    const apply = vi.fn();

    const operation = replaceSessionRuntimeTransaction({
      previous: createBinding(previousSession),
      replacement: createBinding(replacementSession),
      reason: "new",
      targetSessionFile: replacementSession.sessionFile,
      apply,
      withSession: async () => {
        throw originalError;
      },
    });

    await expect(operation).rejects.toMatchObject({
      message: "Session replacement cleanup failed",
      errors: [originalError, cleanupError],
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(replacementSession.dispose).toHaveBeenCalledOnce();
    expect(previousSession.extensionRunner.resume).toHaveBeenCalledOnce();
    expect(previousSession.bindExtensions).toHaveBeenCalledOnce();
    expect(shutdownEvent).toHaveBeenCalledTimes(2);
  });
});
