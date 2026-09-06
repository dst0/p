import type { Api, Context, Model, SimpleStreamOptions } from "@dst0/p-ai";
import type { AgentContext } from "./types.ts";

/** Exact provider-visible request prepared immediately before a model call. */
export interface PrepareModelCallContext {
  context: Context;
  model: Model<Api>;
  maxTokens?: number;
  attempt: number;
}

/** Final request cap and optional raw context replacement to prepare again. */
export interface PrepareModelCallResult {
  maxTokens?: number;
  retryContext?: AgentContext;
}

export interface ModelCallPreparationConfig
  extends Omit<SimpleStreamOptions, "reasoning" | "onPayload" | "onResponse"> {
  /** Called on the exact transformed request immediately before each provider invocation. */
  prepareModelCall?: (
    context: PrepareModelCallContext,
  ) => PrepareModelCallResult | undefined | Promise<PrepareModelCallResult | undefined>;
}
