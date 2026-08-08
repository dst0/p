export type DelegatedMethods<Self, MethodModule> = {
  [Key in keyof MethodModule as Key extends `do_${infer MethodName}`
    ? MethodModule[Key] extends (self: Self, ...args: infer _Args) => infer _Result
      ? MethodName
      : never
    : never]: MethodModule[Key] extends (self: Self, ...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : never;
};

export function installDelegatedMethods<Self extends object>(prototype: Self, methodModules: readonly object[]): void {
  const explicitMethods = new Set(Object.getOwnPropertyNames(prototype));
  const installedMethods = new Set<string>();

  for (const methodModule of methodModules) {
    for (const [exportName, implementation] of Object.entries(methodModule)) {
      if (!exportName.startsWith("do_") || typeof implementation !== "function") continue;
      const methodName = exportName.slice(3);
      if (installedMethods.has(methodName)) {
        throw new Error(`Duplicate delegated method: ${methodName}`);
      }
      installedMethods.add(methodName);
      if (explicitMethods.has(methodName)) continue;

      const delegatedMethod = function (this: Self, ...args: unknown[]): unknown {
        return Reflect.apply(implementation, undefined, [this, ...args]);
      };
      Object.defineProperty(delegatedMethod, "name", { value: methodName });
      Object.defineProperty(prototype, methodName, {
        configurable: true,
        value: delegatedMethod,
        writable: true,
      });
    }
  }
}
