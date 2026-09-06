import type { SessionRunBudget } from "./session-run-budget.ts";

/** Preserve delegated generic signatures while binding every runtime entrypoint. */
export function installSessionBudgetScope(prototype: { runBudget: SessionRunBudget }): void {
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const implementation: (...args: unknown[]) => unknown = descriptor.value;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      value: function (this: { runBudget: SessionRunBudget }, ...args: unknown[]) {
        return this.runBudget.run(() => Reflect.apply(implementation, this, args));
      },
    });
  }
}
