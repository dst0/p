import { spawnProcessSync } from "../../../utils/child-process.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { getEnv } from "../version-resolution.ts";

export function do_runCommandSync(_self: DefaultPackageManager, command: string, args: string[]): string {
  const env = getEnv();
  const result = spawnProcessSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Failed to run ${command} ${args.join(" ")}: ${result.error?.message || result.stderr || result.stdout}`,
    );
  }
  return (result.stdout || result.stderr || "").trim();
}
