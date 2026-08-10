#!/usr/bin/env node
import process from "node:process";
import { main } from "./voice-server-cli/server-io.ts";

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
