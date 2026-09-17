import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const lifetimeMs = 8_000;
process.on("SIGTERM", () => process.exit(0));
const descendant = spawn(
  process.execPath,
  [
    "-e",
    `process.on("SIGTERM", () => {}); process.send("ready"); setTimeout(() => process.exit(0), ${lifetimeMs})`,
  ],
  { stdio: ["ignore", "ignore", "ignore", "ipc"] },
);

descendant.once("message", () => {
  writeFileSync(join(process.cwd(), "pids.json"), JSON.stringify({ parent: process.pid, descendant: descendant.pid }));
});
setTimeout(() => process.exit(0), lifetimeMs);
