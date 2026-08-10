import type { ExtensionFactory } from "../core/extensions/types.ts";

export type ResolvedSession =
  | { type: "path"; path: string } // Direct file path
  | { type: "local"; path: string } // Found in current project
  | { type: "global"; path: string; cwd: string } // Found in different project
  | { type: "not_found"; arg: string };

export interface MainOptions {
  extensionFactories?: ExtensionFactory[];
}
