import type { AgentEvent } from "@dst0/p-agent-core";
import type { RpcCommand } from "../rpc-types.ts";

export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type RpcCommandBody = DistributiveOmit<RpcCommand, "id">;

export interface RpcClientOptions {
  /** Path to the CLI entry point (default: searches for dist/cli.js) */
  cliPath?: string;
  /** Working directory for the agent */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Provider to use */
  provider?: string;
  /** Model ID to use */
  model?: string;
  /** Additional CLI arguments */
  args?: string[];
}

export interface ModelInfo {
  provider: string;
  id: string;
  contextWindow: number;
  reasoning: boolean;
}

export type RpcEventListener = (event: AgentEvent) => void;
