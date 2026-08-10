import type { ServerResponse } from "node:http";

export interface VoiceServerOptions {
  host: string;
  port: number;
  cwd: string;
  open: boolean;
  agentArgs: string[];
}

export interface PromptBody {
  message: string;
  mode: "auto" | "prompt" | "steer" | "follow_up";
}

export interface SseClient {
  id: number;
  response: ServerResponse;
}

export type JsonObject = Record<string, unknown>;
