import type { AgentSessionCoreMethods } from "./agentsession-core-methods.ts";
import type { AgentSessionRuntimeMethods } from "./agentsession-runtime-methods.ts";

export interface AgentSessionMethods extends AgentSessionCoreMethods, AgentSessionRuntimeMethods {}
