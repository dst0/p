import * as assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commandForAgent } from "../../src/workloads/agent-command.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";

const configDir = "/tmp/p-benchmark-tls-config";
const workspace = "/tmp/p-benchmark-tls-workspace";
const task = { prompt: "fixture prompt", timeoutSeconds: 900 };

test("keeps TLS certificate verification enabled for PI and P provider requests", () => {
  const previousTlsOverride = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const options = parseRunnerArgs(["--agents", "pi,p", "--model", "provider/model"]);
    for (const agent of ["pi", "p"] as const) {
      const command = commandForAgent(agent, options, task, configDir, workspace);
      assert.equal(command.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined, agent);

      const repositoryCa = join(homedir(), ".p", "agent", "ca.pem");
      if (existsSync(repositoryCa)) {
        assert.equal(command.env.NODE_EXTRA_CA_CERTS, repositoryCa, agent);
      }
    }
  } finally {
    if (previousTlsOverride === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsOverride;
  }
});
