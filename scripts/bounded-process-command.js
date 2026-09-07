import { spawn } from "node:child_process";

export function sanitizeDiagnostics(text, maxLength = 500) {
  if (typeof text !== "string" || !text) return "";
  const sanitized = text
    .replace(/(?:\/[a-zA-Z0-9_.-]+){2,}/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s:;"')\]>]+/g, "[path]");
  const trimmed = sanitized.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

export async function terminateProcessGroup(pid, isGroupLeader, graceMs = 300) {
  if (typeof pid !== "number" || pid <= 0) return;
  const isPosix = process.platform !== "win32";
  const useGroup = isPosix && isGroupLeader;

  const target = useGroup ? -pid : pid;

  const sendSignal = (signal) => {
    try {
      process.kill(target, signal);
      return { gone: false };
    } catch (error) {
      if (error && error.code === "ESRCH") {
        return { gone: true };
      }
      if (useGroup) {
        try {
          process.kill(pid, signal);
        } catch {
          // Process already exited
        }
      }
      return { gone: false };
    }
  };

  const isAlive = () => {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      if (error && error.code === "ESRCH") {
        return false;
      }
      return true;
    }
  };

  const termResult = sendSignal("SIGTERM");
  if (termResult.gone) {
    return;
  }
  if (graceMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, graceMs));
  }
  if (isAlive()) {
    sendSignal("SIGKILL");
  }
}

export function runBoundedProcessCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? 30000;
    const maxBuffer = options.maxBuffer ?? 4 * 1024 * 1024;
    const graceMs = options.graceMs ?? 300;
    const isPosix = process.platform !== "win32";

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        detached: isPosix,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (spawnError) {
      const diag = sanitizeDiagnostics(spawnError instanceof Error ? spawnError.message : String(spawnError));
      reject(new Error(`Command spawn failed: ${diag}`));
      return;
    }

    const isGroupLeader = isPosix && typeof child.pid === "number" && child.pid > 0;
    const childPid = child.pid;

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timeoutId = null;
    let terminalError = null;
    let isClosed = false;
    let resolveClose = null;

    const closePromise = new Promise((res) => {
      resolveClose = res;
    });

    const clearTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const triggerTermination = async (error) => {
      if (terminalError || isClosed) return;
      terminalError = error;
      clearTimer();

      await terminateProcessGroup(childPid, isGroupLeader, graceMs);
      await closePromise;
      reject(terminalError);
    };

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        if (terminalError || isClosed) return;
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxBuffer) {
          void triggerTermination(new Error(`Command stdout exceeded buffer limit of ${maxBuffer} bytes`));
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        if (terminalError || isClosed) return;
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
        if (stderrBytes > maxBuffer) {
          void triggerTermination(new Error(`Command stderr exceeded buffer limit of ${maxBuffer} bytes`));
        }
      });
    }

    child.on("error", (error) => {
      if (terminalError || isClosed) return;
      const diag = sanitizeDiagnostics(error instanceof Error ? error.message : String(error));
      void triggerTermination(new Error(`Command execution failed: ${diag}`));
    });

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (terminalError || isClosed) return;
        void triggerTermination(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    }

    child.on("close", (status, signal) => {
      clearTimer();
      isClosed = true;
      if (resolveClose) {
        resolveClose();
      }

      if (!terminalError) {
        resolve({
          signal: signal ?? undefined,
          status: status ?? (signal ? 1 : 0),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        });
      }
    });
  });
}
