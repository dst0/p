import { spawn } from "node:child_process";
import type { ThinkingLevel } from "@dst0/p-agent-core";
import type { ImageContent } from "@dst0/p-ai";
import { attachJsonlLineReader } from "../../jsonl.ts";
import type { RpcSessionState } from "../../rpc-types.ts";
import type { RpcClient } from "../rpcclient.ts";
import type { ModelInfo, RpcEventListener } from "../types.ts";

export async function do_start(self: RpcClient): Promise<void> {
  if (self.process) {
    throw new Error("Client already started");
  }

  self.exitError = null;

  const cliPath = self.options.cliPath ?? "dist/cli.js";
  const args = ["--mode", "rpc"];

  if (self.options.provider) {
    args.push("--provider", self.options.provider);
  }
  if (self.options.model) {
    args.push("--model", self.options.model);
  }
  if (self.options.args) {
    args.push(...self.options.args);
  }

  const childProcess = spawn("node", [cliPath, ...args], {
    cwd: self.options.cwd,
    env: { ...process.env, ...self.options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  self.process = childProcess;

  // Collect stderr for debugging
  childProcess.stderr?.on("data", (data) => {
    self.stderr += data.toString();
    process.stderr.write(data);
  });

  childProcess.once("exit", (code, signal) => {
    if (self.process !== childProcess) return;
    const error = self.createProcessExitError(code, signal);
    self.exitError = error;
    self.rejectPendingRequests(error);
  });
  childProcess.once("error", (error) => {
    if (self.process !== childProcess) return;
    const processError = new Error(`Agent process error: ${error.message}. Stderr: ${self.stderr}`);
    self.exitError = processError;
    self.rejectPendingRequests(processError);
  });
  childProcess.stdin?.on("error", (error) => {
    if (self.process !== childProcess) return;
    const stdinError =
      self.exitError ?? new Error(`Agent process stdin error: ${error.message}. Stderr: ${self.stderr}`);
    self.exitError = stdinError;
    self.rejectPendingRequests(stdinError);
  });

  // Set up strict JSONL reader for stdout.
  self.stopReadingStdout = attachJsonlLineReader(childProcess.stdout!, (line) => {
    self.handleLine(line);
  });

  // Wait a moment for process to initialize
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (self.process.exitCode !== null) {
    const error = self.exitError ?? self.createProcessExitError(self.process.exitCode, self.process.signalCode);
    self.exitError = error;
    throw error;
  }
}

export async function do_stop(self: RpcClient): Promise<void> {
  if (!self.process) return;

  self.stopReadingStdout?.();
  self.stopReadingStdout = null;
  self.process.kill("SIGTERM");

  // Wait for process to exit
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      self.process?.kill("SIGKILL");
      resolve();
    }, 1000);

    self.process?.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  self.process = null;
  self.pendingRequests.clear();
}

export function do_onEvent(self: RpcClient, listener: RpcEventListener): () => void {
  self.eventListeners.push(listener);
  return () => {
    const index = self.eventListeners.indexOf(listener);
    if (index !== -1) {
      self.eventListeners.splice(index, 1);
    }
  };
}

export function do_getStderr(self: RpcClient): string {
  return self.stderr;
}

export async function do_prompt(self: RpcClient, message: string, images?: ImageContent[]): Promise<void> {
  await self.send({ type: "prompt", message, images });
}

export async function do_steer(self: RpcClient, message: string, images?: ImageContent[]): Promise<void> {
  await self.send({ type: "steer", message, images });
}

export async function do_followUp(self: RpcClient, message: string, images?: ImageContent[]): Promise<void> {
  await self.send({ type: "follow_up", message, images });
}

export async function do_abort(self: RpcClient): Promise<void> {
  await self.send({ type: "abort" });
}

export async function do_newSession(self: RpcClient, parentSession?: string): Promise<{ cancelled: boolean }> {
  const response = await self.send({ type: "new_session", parentSession });
  return self.getData(response);
}

export async function do_getState(self: RpcClient): Promise<RpcSessionState> {
  const response = await self.send({ type: "get_state" });
  return self.getData(response);
}

export async function do_setModel(
  self: RpcClient,
  provider: string,
  modelId: string,
): Promise<{ provider: string; id: string }> {
  const response = await self.send({ type: "set_model", provider, modelId });
  return self.getData(response);
}

export async function do_cycleModel(self: RpcClient): Promise<{
  model: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
} | null> {
  const response = await self.send({ type: "cycle_model" });
  return self.getData(response);
}

export async function do_getAvailableModels(self: RpcClient): Promise<ModelInfo[]> {
  const response = await self.send({ type: "get_available_models" });
  return self.getData<{ models: ModelInfo[] }>(response).models;
}

export async function do_setThinkingLevel(self: RpcClient, level: ThinkingLevel): Promise<void> {
  await self.send({ type: "set_thinking_level", level });
}

export async function do_cycleThinkingLevel(self: RpcClient): Promise<{ level: ThinkingLevel } | null> {
  const response = await self.send({ type: "cycle_thinking_level" });
  return self.getData(response);
}

export async function do_setSteeringMode(self: RpcClient, mode: "all" | "one-at-a-time"): Promise<void> {
  await self.send({ type: "set_steering_mode", mode });
}
