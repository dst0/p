import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type { AgentToolResult, ThinkingLevel } from "@dst0/p-agent-core";
import type { Message } from "@dst0/p-ai";
import type { AgentConfig } from "./agents.ts";
import {
  cleanupTempPrompt,
  getFinalOutput,
  getPiInvocation,
  type SingleResult,
  type SubagentDetails,
  writePromptToTempFile,
} from "./formatters.ts";
import { appendSubagentRuntimeArguments } from "./runtime-settings.ts";

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

const TERMINATION_GRACE_MS = 5_000;
const FORCE_SETTLE_GRACE_MS = 1_000;

interface StreamEvent {
  type?: unknown;
  message?: unknown;
}

function parseStreamEvent(line: string): StreamEvent | undefined {
  if (!line.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as StreamEvent) : undefined;
  } catch {
    return undefined;
  }
}

function applyAssistantUsage(result: SingleResult, message: Message): void {
  if (message.role !== "assistant") return;
  result.usage.turns++;
  const usage = message.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || 0;
  }
  if (!result.model && message.model) result.model = message.model;
  if (message.stopReason) result.stopReason = message.stopReason;
  if (message.errorMessage) result.errorMessage = message.errorMessage;
}

function safeChildKill(child: ChildProcess, signal: NodeJS.Signals): boolean {
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

export function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.pid === undefined) return safeChildKill(child, signal);
  if (process.platform === "win32") {
    try {
      const taskkill = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (!taskkill.error && taskkill.status === 0) return true;
    } catch {
      // taskkill failed, fall back to direct child kill
    }
    safeChildKill(child, signal);
    return false;
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  return safeChildKill(child, signal);
}

function processTreeIsAlive(child: ChildProcess): boolean {
  if (process.platform === "win32" || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return false;
  }
}

export async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  parentModel?: string,
  parentThinking?: ThinkingLevel,
  childBudget?: "unlimited",
): Promise<SingleResult> {
  const agent = agents.find((candidate) => candidate.name === agentName);
  if (!agent) {
    const available = agents.map((candidate) => `"${candidate.name}"`).join(", ") || "none";
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      step,
    };
  }

  if (childBudget !== "unlimited") {
    return {
      agent: agentName,
      agentSource: agent.source,
      task,
      exitCode: 1,
      messages: [],
      stderr: "Subagent blocked: a limited parent budget cannot be safely shared with a child process.",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      step,
    };
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session", "--budget", childBudget];
  const runtimeSettings = appendSubagentRuntimeArguments(args, agent, parentModel, parentThinking);
  let promptDirectory: string | null = null;
  let promptPath: string | null = null;
  const currentResult: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    model: runtimeSettings.model,
    step,
  };
  const emitUpdate = (): void => {
    onUpdate?.({
      content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
      details: makeDetails([currentResult]),
    });
  };

  try {
    if (agent.systemPrompt.trim()) {
      const promptFile = await writePromptToTempFile(agent.name, agent.systemPrompt);
      promptDirectory = promptFile.dir;
      promptPath = promptFile.filePath;
      args.push("--append-system-prompt", promptPath);
    }
    args.push(`Task: ${task}`);
    let wasAborted = false;
    let terminationUnconfirmed = false;
    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const childProcess = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";
      let directClosed = false;
      let closeCode: number | null = 1;
      let closeSignal: NodeJS.Signals | null = null;
      let settled = false;
      let escalationTimer: NodeJS.Timeout | undefined;
      let forceSettleTimer: NodeJS.Timeout | undefined;
      let terminate: (() => void) | undefined;
      const finish = (code: number | null, closeSignal?: NodeJS.Signals | null): void => {
        if (settled) return;
        settled = true;
        if (escalationTimer) clearTimeout(escalationTimer);
        if (forceSettleTimer) clearTimeout(forceSettleTimer);
        if (signal && terminate) signal.removeEventListener("abort", terminate);
        if (buffer.trim()) processLine(buffer);
        if (closeSignal) currentResult.stderr += `Subagent terminated by signal ${closeSignal}.\n`;
        resolve(code ?? 1);
      };
      const processLine = (line: string): void => {
        const event = parseStreamEvent(line);
        if (!event) return;
        if (event.type === "message_end" && event.message) {
          const message = event.message as Message;
          currentResult.messages.push(message);
          applyAssistantUsage(currentResult, message);
          emitUpdate();
        }
        if (event.type === "tool_result_end" && event.message) {
          currentResult.messages.push(event.message as Message);
          emitUpdate();
        }
      };
      childProcess.stdout?.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });
      childProcess.stderr?.on("data", (data) => {
        currentResult.stderr += data.toString();
      });
      childProcess.on("close", (code, receivedSignal) => {
        directClosed = true;
        closeCode = code;
        closeSignal = receivedSignal;
        if (!wasAborted || (!terminationUnconfirmed && !processTreeIsAlive(childProcess))) {
          finish(code, receivedSignal);
        }
      });
      childProcess.on("error", (error) => {
        currentResult.stderr += `${error instanceof Error ? error.message : String(error)}\n`;
        finish(1);
      });
      if (signal) {
        terminate = (): void => {
          if (settled) return;
          wasAborted = true;
          const termSignaled = signalProcessTree(childProcess, "SIGTERM");
          terminationUnconfirmed = !termSignaled;
          if (!termSignaled) {
            currentResult.stderr += "Failed to deliver SIGTERM to subagent process tree.\n";
          }
          escalationTimer = setTimeout(() => {
            if (settled) return;
            const killSignaled = signalProcessTree(childProcess, "SIGKILL");
            terminationUnconfirmed = !killSignaled;
            if (!killSignaled) {
              currentResult.stderr += "Failed to deliver SIGKILL to subagent process tree.\n";
            } else if (directClosed && !processTreeIsAlive(childProcess)) {
              finish(closeCode, closeSignal);
              return;
            }
            forceSettleTimer = setTimeout(() => {
              if (settled) return;
              childProcess.stdout?.destroy();
              childProcess.stderr?.destroy();
              if (!directClosed) {
                currentResult.stderr += "Subagent force-settled before process exit confirmation.\n";
              }
              finish(directClosed ? closeCode : 1, closeSignal ?? "SIGKILL");
            }, FORCE_SETTLE_GRACE_MS);
            forceSettleTimer.unref();
          }, TERMINATION_GRACE_MS);
          escalationTimer.unref();
        };
        if (signal.aborted) terminate();
        else signal.addEventListener("abort", terminate, { once: true });
      }
    });
    currentResult.exitCode = exitCode;
    if (wasAborted) {
      const message = terminationUnconfirmed
        ? "Subagent was aborted; process-tree termination could not be confirmed"
        : "Subagent was aborted";
      throw new Error(message);
    }
    return currentResult;
  } finally {
    cleanupTempPrompt(promptDirectory, promptPath);
  }
}
