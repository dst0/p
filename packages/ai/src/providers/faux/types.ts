import type {
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../../types.ts";

export interface FauxModelDefinition {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
}

export type FauxContentBlock = TextContent | ThinkingContent | ToolCall;

export type FauxResponseFactory = (
  context: Context,
  options: StreamOptions | undefined,
  state: { callCount: number },
  model: Model<string>,
) => AssistantMessage | Promise<AssistantMessage>;

export type FauxResponseStep = AssistantMessage | FauxResponseFactory;

export interface RegisterFauxProviderOptions {
  api?: string;
  provider?: string;
  models?: FauxModelDefinition[];
  registerImmediately?: boolean;
  preserveOnReset?: boolean;
  tokensPerSecond?: number;
  tokenSize?: {
    min?: number;
    max?: number;
  };
}

export interface FauxProviderRegistration {
  api: string;
  models: [Model<string>, ...Model<string>[]];
  register: () => void;
  getModel(): Model<string>;
  getModel(modelId: string): Model<string> | undefined;
  state: { callCount: number };
  setResponses: (responses: FauxResponseStep[]) => void;
  appendResponses: (responses: FauxResponseStep[]) => void;
  getPendingResponseCount: () => number;
  unregister: () => void;
}
