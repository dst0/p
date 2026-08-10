import type {
  ExtensionError,
  LoadExtensionsResult,
  ProjectTrustContext,
  ProjectTrustEvent,
  ProjectTrustEventResult,
  SessionShutdownEvent,
} from "../types.ts";
import type { ExtensionRunner } from "./extensionrunner.ts";

export async function emitSessionShutdownEvent(
  extensionRunner: ExtensionRunner,
  event: SessionShutdownEvent,
): Promise<boolean> {
  if (extensionRunner.hasHandlers("session_shutdown")) {
    await extensionRunner.emit(event);
    return true;
  }
  return false;
}

export async function emitProjectTrustEvent(
  extensionsResult: LoadExtensionsResult,
  event: ProjectTrustEvent,
  ctx: ProjectTrustContext,
): Promise<{ result?: ProjectTrustEventResult; errors: ExtensionError[] }> {
  const errors: ExtensionError[] = [];
  for (const ext of extensionsResult.extensions) {
    // A single extension may register multiple handlers for the same event.
    // The first project_trust handler that returns yes/no wins; undecided falls through.
    const handlers = ext.handlers.get("project_trust");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const handlerResult = (await handler(event, ctx)) as ProjectTrustEventResult;
        if (handlerResult.trusted === "undecided") {
          continue;
        }
        return { result: handlerResult, errors };
      } catch (error) {
        errors.push({
          extensionPath: ext.path,
          event: event.type,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  }
  return { errors };
}
