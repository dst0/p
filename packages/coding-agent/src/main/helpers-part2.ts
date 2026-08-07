import chalk from "chalk";
import type { Args } from "../cli/args.ts";
import { selectSession } from "../cli/session-picker.ts";
import { assertValidSessionId, SessionManager } from "../core/session-manager.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.ts";
import { findLocalSessionByExactId, promptConfirm, resolveSessionPath } from "./helpers-part1.ts";

export function validateSessionIdFlags(parsed: Args): void {
  if (parsed.sessionId === undefined) return;

  const conflictingFlags = [
    parsed.session ? "--session" : undefined,
    parsed.continue ? "--continue" : undefined,
    parsed.resume ? "--resume" : undefined,
    parsed.noSession ? "--no-session" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    console.error(chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`));
    process.exit(1);
  }

  try {
    assertValidSessionId(parsed.sessionId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export function forkSessionOrExit(
  sourcePath: string,
  cwd: string,
  sessionDir?: string,
  sessionId?: string,
): SessionManager {
  try {
    return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function createSessionManager(
  parsed: Args,
  cwd: string,
  sessionDir: string | undefined,
  settingsManager: SettingsManager,
): Promise<SessionManager> {
  if (parsed.noSession || parsed.help || parsed.listModels !== undefined) {
    return SessionManager.inMemory(cwd);
  }

  if (parsed.fork) {
    if (parsed.sessionId) {
      const existingTarget = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
      if (existingTarget) {
        console.error(chalk.red(`Session already exists with id '${parsed.sessionId}'`));
        process.exit(1);
      }
    }

    const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);

    switch (resolved.type) {
      case "path":
      case "local":
      case "global":
        return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);

      case "not_found":
        console.error(chalk.red(`No session found matching '${resolved.arg}'`));
        process.exit(1);
    }
  }

  if (parsed.session) {
    const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);

    switch (resolved.type) {
      case "path":
      case "local":
        return SessionManager.open(resolved.path, sessionDir);

      case "global": {
        console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
        const shouldFork = await promptConfirm("Fork this session into current directory?");
        if (!shouldFork) {
          console.log(chalk.dim("Aborted."));
          process.exit(0);
        }
        return forkSessionOrExit(resolved.path, cwd, sessionDir);
      }

      case "not_found":
        console.error(chalk.red(`No session found matching '${resolved.arg}'`));
        process.exit(1);
    }
  }

  if (parsed.resume) {
    initTheme(settingsManager.getTheme(), true);
    try {
      const selectedPath = await selectSession(
        (onProgress) => SessionManager.list(cwd, sessionDir, onProgress),
        (onProgress) => SessionManager.listAll(sessionDir, onProgress),
      );
      if (!selectedPath) {
        console.log(chalk.dim("No session selected"));
        process.exit(0);
      }
      return SessionManager.open(selectedPath, sessionDir);
    } finally {
      stopThemeWatcher();
    }
  }

  if (parsed.continue) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  if (parsed.sessionId) {
    const existingSession = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
    if (existingSession) {
      return SessionManager.open(existingSession.path, sessionDir);
    }
  }

  return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}
