import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "../config.ts";

export interface IndexingTrayManagerOptions {
  agentDir?: string;
  spawnProcess?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
}

export interface IndexingTrayService {
  start(): boolean;
  stop(): void;
  isRunning(): boolean;
}

export function isGuiDesktopAvailable(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin" || platform === "win32") {
    return true;
  }
  if (platform === "linux") {
    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }
  return false;
}

export function isTrayEnabled(agentDir: string = getAgentDir()): boolean {
  const configPath = path.join(agentDir, "code-rag.json");
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      if (parsed.enableTray === false) return false;
    }
  } catch {
    // Default to true on parse errors.
  }

  const settingsPath = path.join(agentDir, "settings.json");
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      if (parsed.enableIndexingTray === false) return false;
    }
  } catch {
    // Default to true on parse errors.
  }

  return true;
}

export interface TrayCommandPlan {
  command: string;
  args: string[];
}

export function resolveTrayCommand(
  agentDir: string = getAgentDir(),
  platform: NodeJS.Platform = process.platform,
): TrayCommandPlan | undefined {
  if (platform === "darwin") {
    const candidatePaths = [
      path.join(agentDir, "indexing-service", "bin", "p-indexing-tray"),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "bin", "p-indexing-tray"),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "p-indexing-tray"),
    ];
    for (const binPath of candidatePaths) {
      if (fs.existsSync(binPath)) {
        return { command: binPath, args: [] };
      }
    }
    return undefined;
  }

  if (platform === "linux") {
    const venvPython = path.join(agentDir, "indexing-service", "venv", "bin", "python");
    const pythonExec = fs.existsSync(venvPython) ? venvPython : "python3";
    const candidateScripts = [
      path.join(agentDir, "indexing-service", "indexing_tray.py"),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "code-index", "indexing_tray.py"),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "code-index", "indexing_tray.py"),
    ];
    for (const scriptPath of candidateScripts) {
      if (fs.existsSync(scriptPath)) {
        return { command: pythonExec, args: [scriptPath] };
      }
    }
    return undefined;
  }

  return undefined;
}

export class IndexingTrayManager implements IndexingTrayService {
  private readonly agentDir: string;
  private readonly spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
  private process: ChildProcess | undefined;

  constructor(options: IndexingTrayManagerOptions = {}) {
    this.agentDir = options.agentDir ?? getAgentDir();
    this.spawnProcess = options.spawnProcess ?? ((cmd, args, opts) => spawn(cmd, args, opts));
  }

  start(): boolean {
    if (!isGuiDesktopAvailable() || !isTrayEnabled(this.agentDir)) {
      return false;
    }
    if (this.isRunning()) {
      return true;
    }
    const plan = resolveTrayCommand(this.agentDir);
    if (!plan) {
      return false;
    }
    try {
      const child = this.spawnProcess(plan.command, plan.args, {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          P_CODING_AGENT_DIR: this.agentDir,
        },
      });
      child.unref();
      this.process = child;
      child.on("exit", () => {
        if (this.process === child) {
          this.process = undefined;
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    if (!this.process) return;
    try {
      this.process.kill("SIGTERM");
    } catch {
      // Best effort process termination.
    }
    this.process = undefined;
  }

  isRunning(): boolean {
    if (!this.process || this.process.killed || this.process.exitCode !== null) return false;
    if (typeof this.process.pid === "number" && this.process.pid > 0) {
      try {
        process.kill(this.process.pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM") return true;
        if (code === "ESRCH") {
          this.process = undefined;
          return false;
        }
      }
    }
    return this.process !== undefined;
  }
}
