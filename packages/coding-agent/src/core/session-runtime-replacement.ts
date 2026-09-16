import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntimeDiagnostic, AgentSessionServices } from "./agent-session-services.ts";
import type { ReplacedSessionContext, SessionShutdownEvent } from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";

export interface SessionRuntimeBinding {
  session: AgentSession;
  services: AgentSessionServices;
  diagnostics: AgentSessionRuntimeDiagnostic[];
  modelFallbackMessage?: string;
}

interface SessionRuntimeReplacementOptions {
  previous: SessionRuntimeBinding;
  replacement: SessionRuntimeBinding;
  reason: SessionShutdownEvent["reason"];
  targetSessionFile?: string;
  beforeSessionInvalidate?: () => void;
  apply(binding: SessionRuntimeBinding): void;
  prepare?: (session: AgentSession) => Promise<void>;
  rebind?: (session: AgentSession) => Promise<void>;
  withSession?: (context: ReplacedSessionContext) => Promise<void>;
}

/** Prepare host callbacks before committing ownership and disposing the previous session. */
export async function replaceSessionRuntimeTransaction(options: SessionRuntimeReplacementOptions): Promise<void> {
  let hostInvalidationStarted = false;
  let previousSuspended = false;
  let replacementApplied = false;
  try {
    await options.prepare?.(options.replacement.session);
    await emitSessionShutdownEvent(options.previous.session.extensionRunner, {
      type: "session_shutdown",
      reason: options.reason,
      targetSessionFile: options.targetSessionFile,
    });
    hostInvalidationStarted = true;
    options.beforeSessionInvalidate?.();
    options.previous.session.extensionRunner.suspend();
    previousSuspended = true;
    options.apply(options.replacement);
    replacementApplied = true;
    await options.rebind?.(options.replacement.session);
    await options.withSession?.(options.replacement.session.createReplacedSessionContext());
  } catch (error) {
    if (replacementApplied) options.apply(options.previous);
    let cleanupError: unknown;
    if (replacementApplied && options.replacement.session.extensionsStarted) {
      try {
        await emitSessionShutdownEvent(options.replacement.session.extensionRunner, {
          type: "session_shutdown",
          reason: "resume",
          targetSessionFile: options.previous.session.sessionFile,
        });
      } catch (caught) {
        cleanupError = caught;
      }
    }
    options.replacement.session.dispose();
    if (previousSuspended) {
      options.previous.session.extensionRunner.resume();
      previousSuspended = false;
    }
    if (hostInvalidationStarted) {
      try {
        if (options.rebind) {
          await options.rebind(options.previous.session);
        } else {
          await options.previous.session.bindExtensions({});
        }
      } catch (rollbackError) {
        throw new AggregateError(
          cleanupError ? [error, cleanupError, rollbackError] : [error, rollbackError],
          "Session replacement and host rollback both failed",
        );
      }
    }
    if (cleanupError) throw new AggregateError([error, cleanupError], "Session replacement cleanup failed");
    throw error;
  }
  options.previous.session.dispose();
}
