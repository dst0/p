import type { ExtensionCommandContext, ExtensionContext } from "../../types.ts";
import type { ExtensionRunner } from "../extensionrunner.ts";
import type { RunnerEmitEvent, RunnerEmitResult, SessionBeforeEvent, SessionBeforeEventResult } from "../types.ts";

export function do_createContext(self: ExtensionRunner): ExtensionContext {
  const runner = self;
  const getModel = self.getModel;
  return {
    get ui() {
      runner.assertActive();
      return runner.uiContext;
    },
    get mode() {
      runner.assertActive();
      return runner.mode;
    },
    get hasUI() {
      runner.assertActive();
      return runner.hasUI();
    },
    get cwd() {
      runner.assertActive();
      return runner.cwd;
    },
    get sessionManager() {
      runner.assertActive();
      return runner.sessionManager;
    },
    get modelRegistry() {
      runner.assertActive();
      return runner.modelRegistry;
    },
    get model() {
      runner.assertActive();
      return getModel();
    },
    isIdle: () => {
      runner.assertActive();
      return runner.isIdleFn();
    },
    isProjectTrusted: () => {
      runner.assertActive();
      return runner.isProjectTrustedFn();
    },
    get signal() {
      runner.assertActive();
      return runner.getSignalFn();
    },
    abort: () => {
      runner.assertActive();
      runner.abortFn();
    },
    hasPendingMessages: () => {
      runner.assertActive();
      return runner.hasPendingMessagesFn();
    },
    shutdown: () => {
      runner.assertActive();
      runner.shutdownHandler();
    },
    getContextUsage: () => {
      runner.assertActive();
      return runner.getContextUsageFn();
    },
    compact: (options) => {
      runner.assertActive();
      runner.compactFn(options);
    },
    getSystemPrompt: () => {
      runner.assertActive();
      return runner.getSystemPromptFn();
    },
  };
}

export function do_createCommandContext(self: ExtensionRunner): ExtensionCommandContext {
  // Use property descriptors instead of object spread so the guarded getters from
  // createContext() stay lazy. A spread would eagerly read them once and freeze the
  // old values into the returned object, bypassing stale-instance checks.
  const context = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(self.createContext()),
  ) as ExtensionCommandContext;
  context.getSystemPromptOptions = () => {
    self.assertActive();
    return self.getSystemPromptOptionsFn();
  };
  context.waitForIdle = () => {
    self.assertActive();
    return self.waitForIdleFn();
  };
  context.newSession = (options) => {
    self.assertActive();
    return self.newSessionHandler(options);
  };
  context.fork = (entryId, options) => {
    self.assertActive();
    return self.forkHandler(entryId, options);
  };
  context.navigateTree = (targetId, options) => {
    self.assertActive();
    return self.navigateTreeHandler(targetId, options);
  };
  context.switchSession = (sessionPath, options) => {
    self.assertActive();
    return self.switchSessionHandler(sessionPath, options);
  };
  context.reload = () => {
    self.assertActive();
    return self.reloadHandler();
  };
  return context;
}

export function do_isSessionBeforeEvent(_self: ExtensionRunner, event: RunnerEmitEvent): event is SessionBeforeEvent {
  return (
    event.type === "session_before_switch" ||
    event.type === "session_before_fork" ||
    event.type === "session_before_compact" ||
    event.type === "session_before_tree"
  );
}

export async function do_emit<TEvent extends RunnerEmitEvent>(
  self: ExtensionRunner,
  event: TEvent,
): Promise<RunnerEmitResult<TEvent>> {
  const ctx = self.createContext();
  let result: SessionBeforeEventResult | undefined;

  for (const ext of self.extensions) {
    const handlers = ext.handlers.get(event.type);
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        const handlerResult = await handler(event, ctx);

        if (self.isSessionBeforeEvent(event) && handlerResult) {
          result = handlerResult as SessionBeforeEventResult;
          if (result.cancel) {
            return result as RunnerEmitResult<TEvent>;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        self.emitError({
          extensionPath: ext.path,
          event: event.type,
          error: message,
          stack,
        });
      }
    }
  }

  return result as RunnerEmitResult<TEvent>;
}
