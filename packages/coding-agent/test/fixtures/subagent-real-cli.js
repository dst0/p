import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(fixtureDir, "..", "..");
const repoDir = join(packageDir, "..", "..");
const result = spawnSync(
  join(repoDir, "node_modules", ".bin", "tsx"),
  [
    "--tsconfig",
    join(repoDir, "tsconfig.json"),
    join(fixtureDir, "subagent-real-cli-entry.js"),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
