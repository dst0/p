export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "source-checkout" | "unknown";

export interface SelfUpdateCommand {
  command: string;
  args: string[];
  display: string;
  /** Semver the command installs; set only when the update check produced a validated version. */
  pinnedVersion?: string;
}

export interface PackageJson {
  name?: string;
  version?: string;
  piConfig?: {
    name?: string;
    configDir?: string;
  };
}
