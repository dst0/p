export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "source-checkout" | "unknown";

export interface SelfUpdateCommand {
  command: string;
  args: string[];
  display: string;
}

export interface PackageJson {
  name?: string;
  version?: string;
  piConfig?: {
    name?: string;
    configDir?: string;
  };
}
