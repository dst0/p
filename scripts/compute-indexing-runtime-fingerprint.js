#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { computeIndexingRuntimeConfigFingerprint } from "../packages/coding-agent/dist/core/indexing-runtime-config.js";

const agentDir = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
console.log(computeIndexingRuntimeConfigFingerprint(agentDir));
