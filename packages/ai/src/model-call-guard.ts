import type { Api, ImagesApi, ImagesModel, Model, Usage } from "./types.ts";

export interface ModelCallAdmission {
  kind: "text" | "image";
  model: Model<Api> | ImagesModel<ImagesApi>;
  signal?: AbortSignal;
}

export interface ModelCallReceipt {
  /** Called exactly once, before terminal completion; undefined means unknown usage. */
  settle(usage: Usage | undefined): void;
}

export type ModelCallGuard = (call: ModelCallAdmission) => ModelCallReceipt | undefined;

let guard: ModelCallGuard | undefined;

/** Install one admission authority. The resolver may select an async-local scope. */
export function registerModelCallGuard(next: ModelCallGuard): () => void {
  if (guard) throw new Error("A model-call admission authority is already registered");
  guard = next;
  return () => {
    if (guard === next) guard = undefined;
  };
}

export function admitModelCall(call: ModelCallAdmission): ModelCallReceipt | undefined {
  return guard?.(call);
}
