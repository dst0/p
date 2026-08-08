import type { ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type AgentMessage, getFinishWorkPayload } from "@dst0/p-agent-core";
import { VERSION } from "../config.ts";
import { DEFAULT_HOST, DEFAULT_PORT } from "./constants.ts";
import type { JsonObject, VoiceServerOptions } from "./types.ts";

export function printHelp(): void {
  process.stdout.write(`p-voice ${VERSION}

Serve a local browser voice interface backed by a persistent P RPC session.

Usage:
  p-voice [options] [-- <p rpc args>]

Options:
  --host <host>   Host to bind. Default: ${DEFAULT_HOST}
  --port <port>   Port to bind. Default: ${DEFAULT_PORT}
  --cwd <path>    Working directory for the P agent. Default: current directory
  --open          Open the page in the default browser after startup
  -h, --help      Show this help

Examples:
  p-voice
  p-voice --open -- --approve --model anthropic/claude-sonnet-4-5
  p-voice --cwd ~/dev/my-project -- --continue
`);
}

export function parseArgs(args: string[]): VoiceServerOptions | "help" {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let cwd = process.cwd();
  let open = false;
  let agentArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      agentArgs = args.slice(i + 1);
      break;
    }
    if (arg === "-h" || arg === "--help") {
      return "help";
    }
    if (arg === "--open") {
      open = true;
      continue;
    }
    if (arg === "--host" && args[i + 1]) {
      host = args[++i];
      continue;
    }
    if (arg === "--port" && args[i + 1]) {
      const parsedPort = Number.parseInt(args[++i], 10);
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
        throw new Error(`Invalid port: ${args[i]}`);
      }
      port = parsedPort;
      continue;
    }
    if (arg === "--cwd" && args[i + 1]) {
      cwd = resolve(args[++i]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}. Put P RPC arguments after --.`);
  }

  return { host, port, cwd, open, agentArgs };
}

export function resolveCliPath(): string {
  if (process.env.P_VOICE_CLI_PATH) {
    return resolve(process.env.P_VOICE_CLI_PATH);
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "cli.js");
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function stripSessionStateUpdates(text: string): string {
  return text.replace(/<session_state_update>\s*[\s\S]*?\s*<\/session_state_update>/g, "").trim();
}

export function textFromMessage(message: unknown): string {
  if (!isObject(message)) return "";
  const content = message.content;
  if (!Array.isArray(content)) return "";

  let text = "";
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return stripSessionStateUpdates(text);
}

export function extractFinalText(event: unknown): string | undefined {
  if (!isObject(event) || event.type !== "agent_end" || !Array.isArray(event.messages)) {
    return undefined;
  }

  const messages = event.messages as AgentMessage[];
  const finishPayload = getFinishWorkPayload(messages);
  const finishText = finishPayload?.summary;
  if (finishText?.trim()) {
    return finishText.trim();
  }

  for (let i = event.messages.length - 1; i >= 0; i--) {
    const candidate = event.messages[i];
    if (!isObject(candidate) || candidate.role !== "assistant") continue;
    const text = textFromMessage(candidate).trim();
    if (text) return text;
  }
  return undefined;
}

export function extractFinalError(event: unknown): string | undefined {
  if (!isObject(event) || event.type !== "agent_end" || !Array.isArray(event.messages)) {
    return undefined;
  }

  for (let i = event.messages.length - 1; i >= 0; i--) {
    const candidate = event.messages[i];
    if (!isObject(candidate) || candidate.role !== "assistant") continue;
    const stopReason = getString(candidate.stopReason);
    const errorMessage = getString(candidate.errorMessage);
    if ((stopReason === "error" || stopReason === "aborted") && errorMessage?.trim()) {
      return errorMessage.trim();
    }
  }
  return undefined;
}

export function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}

export function sendText(response: ServerResponse, statusCode: number, contentType: string, body: string): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}
