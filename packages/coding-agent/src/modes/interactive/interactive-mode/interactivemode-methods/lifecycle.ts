import chalk from "chalk";
import { killTrackedDetachedChildren } from "../../../../utils/shell.ts";
import { formatResumeCommand, isDeadTerminalError } from "../helpers.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export async function do_shutdown(self: InteractiveMode, options?: { fromSignal?: boolean }): Promise<void> {
  if (self.isShuttingDown) return;
  self.isShuttingDown = true;
  // Keep signal handlers registered until terminal cleanup has completed.
  // `signal-exit` checks the listener list during the same SIGTERM/SIGHUP
  // dispatch and re-sends the signal if only its own listeners remain.

  if (options?.fromSignal) {
    // Signal-triggered shutdown (SIGTERM/SIGHUP). Emit extension cleanup
    // (session_shutdown) BEFORE touching the terminal. Extension teardown
    // such as removing sockets does not write to the tty, so it must not be
    // skipped if a later terminal-restore write fails on a dead or stalled
    // terminal. If the terminal is gone, the restore writes below emit EIO,
    // which the stdout/stderr error handler turns into emergencyTerminalExit;
    // the render loop is already idle, so self cannot hot-spin (see #4144).
    await self.runtimeHost.dispose();
    await self.ui.terminal.drainInput(1000);
    self.stop();
    process.exit(0);
  }

  // Interactive quit (Ctrl+D, Ctrl+C, /quit, extension shutdown()). Stop the
  // TUI before emitting shutdown events so extension UI cleanup cannot repaint
  // the final frame while the process is exiting.
  // Drain any in-flight Kitty key release events before stopping.
  // This prevents escape sequences from leaking to the parent shell over slow SSH.
  await self.ui.terminal.drainInput(1000);

  self.stop();
  await self.runtimeHost.dispose();

  const resumeCommand = formatResumeCommand(self.sessionManager);
  if (resumeCommand) {
    process.stdout.write(`${chalk.dim("To resume this session:")} ${resumeCommand}\n`);
  }

  process.exit(0);
}

export function do_emergencyTerminalExit(self: InteractiveMode): never {
  self.isShuttingDown = true;
  self.unregisterSignalHandlers();
  killTrackedDetachedChildren();
  // The terminal is gone. Do not run normal shutdown because TUI and
  // extension cleanup can write restore sequences and re-trigger EIO.
  process.exit(129);
}

export function do_uncaughtCrash(self: InteractiveMode, error: Error): never {
  if (self.isShuttingDown) {
    process.exit(1);
  }
  self.isShuttingDown = true;
  try {
    self.unregisterSignalHandlers();
  } catch {}
  try {
    killTrackedDetachedChildren();
  } catch {}
  try {
    self.ui.stop();
  } catch {}
  console.error("p exiting due to uncaughtException:");
  console.error(error);
  process.exit(1);
}

export async function do_checkShutdownRequested(self: InteractiveMode): Promise<void> {
  if (!self.shutdownRequested) return;
  await self.shutdown();
}

export function do_registerSignalHandlers(self: InteractiveMode): void {
  self.unregisterSignalHandlers();

  const signals: NodeJS.Signals[] = ["SIGTERM"];
  if (process.platform !== "win32") {
    signals.push("SIGHUP");
  }

  for (const signal of signals) {
    const handler = () => {
      // SIGHUP no longer hard-exits: graceful shutdown emits session_shutdown
      // first, then attempts terminal restore. A genuinely dead terminal
      // surfaces as an EIO on the restore writes, which the stdout/stderr
      // error handler converts into emergencyTerminalExit (see #4144, #5080).
      killTrackedDetachedChildren();
      void self.shutdown({ fromSignal: true });
    };
    process.prependListener(signal, handler);
    self.signalCleanupHandlers.push(() => process.off(signal, handler));
  }

  const terminalErrorHandler = (error: Error) => {
    if (isDeadTerminalError(error)) {
      self.emergencyTerminalExit();
    }
    throw error;
  };
  process.stdout.on("error", terminalErrorHandler);
  process.stderr.on("error", terminalErrorHandler);
  self.signalCleanupHandlers.push(() => process.stdout.off("error", terminalErrorHandler));
  self.signalCleanupHandlers.push(() => process.stderr.off("error", terminalErrorHandler));

  // Restore the terminal before the process dies on any uncaught throw.
  // Without self, an unhandled exception from extension code (or anywhere
  // in p) leaves the terminal in raw mode with no cursor.
  const uncaughtExceptionHandler = (error: Error) => self.uncaughtCrash(error);
  process.prependListener("uncaughtException", uncaughtExceptionHandler);
  self.signalCleanupHandlers.push(() => process.off("uncaughtException", uncaughtExceptionHandler));
}

export function do_unregisterSignalHandlers(self: InteractiveMode): void {
  for (const cleanup of self.signalCleanupHandlers) {
    cleanup();
  }
  self.signalCleanupHandlers = [];
}

export function do_handleCtrlZ(self: InteractiveMode): void {
  if (process.platform === "win32") {
    self.showStatus("Suspend to background is not supported on Windows");
    return;
  }

  // Keep the event loop alive while suspended. Without self, stopping the TUI
  // can leave Node with no ref'ed handles, causing the process to exit on fg
  // before the SIGCONT handler gets a chance to restore the terminal.
  const suspendKeepAlive = setInterval(() => {}, 2 ** 30);

  // Ignore SIGINT while suspended so Ctrl+C in the terminal does not
  // kill the backgrounded process. The handler is removed on resume.
  const ignoreSigint = () => {};
  process.on("SIGINT", ignoreSigint);

  // Set up handler to restore TUI when resumed
  process.once("SIGCONT", () => {
    clearInterval(suspendKeepAlive);
    process.removeListener("SIGINT", ignoreSigint);
    self.ui.start();
    self.ui.requestRender(true);
  });

  try {
    // Stop the TUI (restore terminal to normal mode)
    if (self.planPanelMouseMode) self.setPlanPanelMouseMode(false);
    self.ui.stop();

    // Send SIGTSTP to process group (pid=0 means all processes in group)
    process.kill(0, "SIGTSTP");
  } catch (error) {
    clearInterval(suspendKeepAlive);
    process.removeListener("SIGINT", ignoreSigint);
    throw error;
  }
}
