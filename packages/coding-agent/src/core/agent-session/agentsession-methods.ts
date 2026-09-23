import type { AgentSessionCoreMethods } from "./agentsession-core-methods.ts";
import type { AgentSessionRuntimeMethods } from "./agentsession-runtime-methods.ts";
import type { AgentSessionVerificationMethods } from "./agentsession-verification-methods.ts";

export interface AgentSessionMethods
  extends AgentSessionCoreMethods,
    AgentSessionRuntimeMethods,
    AgentSessionVerificationMethods {}
