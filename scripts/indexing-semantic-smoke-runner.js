import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBoundedProcessCommand } from "./bounded-process-command.js";

const SMOKE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "smoke-code-index.js");
const SMOKE_TIMEOUT_MS = 30 * 60 * 1000;

export async function runRealSemanticSearchSmoke(environment, options = {}) {
  console.log("Running real semantic-search verification");
  const result = await runBoundedProcessCommand(process.execPath, [options.scriptPath ?? SMOKE_SCRIPT], {
    env: { ...process.env, ...environment },
    timeout: options.timeoutMs ?? SMOKE_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Semantic-search smoke exited with status ${result.status}`);
  return result;
}
