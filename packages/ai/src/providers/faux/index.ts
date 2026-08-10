export { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "./scenario-parsing.ts";
export { registerFauxProvider } from "./tool-response-generation.ts";
export type {
  FauxContentBlock,
  FauxModelDefinition,
  FauxProviderRegistration,
  FauxResponseFactory,
  FauxResponseStep,
  RegisterFauxProviderOptions,
} from "./types.ts";
