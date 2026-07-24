#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(dirname(fileURLToPath(import.meta.url)));

execFileSync("node", ["../../node_modules/vitest/dist/cli.js", "--run", "test/compaction-golden.test.ts"], {
	cwd,
	stdio: "inherit",
});
