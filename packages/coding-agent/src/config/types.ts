export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "source-checkout" | "unknown";

export interface SelfUpdateCommandStep {
  command: string;
  args: string[];
  display: string;
}

export interface SelfUpdateCommand extends SelfUpdateCommandStep {
  steps?: SelfUpdateCommandStep[];
}

export interface PackageJson {
  name?: string;
  version?: string;
  piConfig?: {
    name?: string;
    configDir?: string;
  };
}
