import { describe, expect, it } from "vitest";
import { type DelegatedMethods, installDelegatedMethods } from "../src/utils/install-delegated-methods.ts";

const arithmeticDelegates = {
  do_add(self: { value: number }, increment: number): number {
    self.value += increment;
    return self.value;
  },
  ignoredExport: "not a delegated method",
};

type ArithmeticMethods = DelegatedMethods<{ value: number }, typeof arithmeticDelegates>;

describe("installDelegatedMethods", () => {
  it("installs named, non-enumerable prototype methods that receive the instance", () => {
    const prototype = {};
    installDelegatedMethods(prototype, [arithmeticDelegates]);
    const instance = Object.assign(Object.create(prototype) as ArithmeticMethods & { value: number }, { value: 2 });

    expect(instance.add(3)).toBe(5);
    expect(instance.value).toBe(5);
    expect(instance.add.name).toBe("add");
    expect(Object.keys(prototype)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(prototype, "add")).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: true,
    });
  });

  it("preserves explicit methods", () => {
    const explicit = () => "explicit";
    const prototype = { explicit };

    installDelegatedMethods(prototype, [{ do_explicit: () => "delegated" }]);

    expect(prototype.explicit).toBe(explicit);
    expect(prototype.explicit()).toBe("explicit");
  });

  it("rejects duplicate delegated method names", () => {
    expect(() =>
      installDelegatedMethods({}, [{ do_duplicate: () => "first" }, { do_duplicate: () => "second" }]),
    ).toThrow("Duplicate delegated method: duplicate");
  });
});
