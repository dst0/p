import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const lifetimeMs = 8_000;
const descendant = spawn(
  process.execPath,
  ["-e", `process.on("SIGTERM", () => {}); setTimeout(() => process.exit(0), ${lifetimeMs})`],
  { stdio: "inherit" },
);

writeFileSync(join(process.cwd(), "pids.json"), JSON.stringify({ parent: process.pid, descendant: descendant.pid }));
process.on("SIGTERM", () => {});
setTimeout(() => process.exit(0), lifetimeMs);
