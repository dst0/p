import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  OAuthProviderInterface,
  SimpleStreamOptions,
} from "@dst0/p-ai";
import type { Static } from "typebox";
import type { ModelDefinitionSchema, ModelOverrideSchema, ModelsConfigSchema } from "./constants.ts";

export type ModelOverride = Static<typeof ModelOverrideSchema>;

export type ModelsConfig = Static<typeof ModelsConfigSchema>;

export type ModelDefinition = Static<typeof ModelDefinitionSchema>;

export interface ProviderOverride {
  baseUrl?: string;
  compat?: Model<Api>["compat"];
}

export interface ProviderRequestConfig {
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
}

export type ResolvedRequestAuth =
  | {
      ok: true;
      apiKey?: string;
      headers?: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
    };

export interface CustomModelsResult {
  models: Model<Api>[];
  /** Providers with baseUrl/headers/apiKey overrides for built-in models */
  overrides: Map<string, ProviderOverride>;
  /** Per-model overrides: provider -> modelId -> override */
  modelOverrides: Map<string, Map<string, ModelOverride>>;
  error: string | undefined;
}

export interface ProviderConfigInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
  headers?: Record<string, string>;
  authHeader?: boolean;
  /** OAuth provider for /login support */
  oauth?: Omit<OAuthProviderInterface, "id">;
  models?: Array<{
    id: string;
    name?: string;
    api?: Api;
    baseUrl?: string;
    reasoning?: boolean;
    thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
    input?: ("text" | "image")[];
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow?: number;
    maxTokens?: number;
    headers?: Record<string, string>;
    compat?: Model<Api>["compat"];
  }>;
}
