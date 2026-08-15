import { describe, expect, it } from "vitest";
import { installDelegatedMethods } from "../src/utils/install-delegated-methods.ts";

class Target {
  value = 42;

  run() {
    return "explicit";
  }
}

describe("installDelegatedMethods", () => {
  it("installs delegated do_ methods on prototype", () => {
    const proto = {};
    const moduleA = {
      do_getValue(self: { value: number }, prefix: string) {
        return `${prefix}: ${self.value}`;
      },
      not_a_method: "ignored",
      do_not_a_function: 123,
    };
    installDelegatedMethods(proto, [moduleA]);
    const instance = Object.create(proto) as { value: number; getValue(p: string): string };
    instance.value = 42;
    expect(instance.getValue("Result")).toBe("Result: 42");
  });

  it("throws on duplicate delegated method names across modules", () => {
    const proto = {};
    const mod1 = {
      do_run() {
        return 1;
      },
    };
    const mod2 = {
      do_run() {
        return 2;
      },
    };
    expect(() => {
      installDelegatedMethods(proto, [mod1, mod2]);
    }).toThrow("Duplicate delegated method: run");
  });

  it("skips overwriting explicit prototype methods", () => {
    const instance = new Target();
    const mod = {
      do_run() {
        return "delegated";
      },
    };
    installDelegatedMethods(Target.prototype, [mod]);
    expect(instance.run()).toBe("explicit");
  });
});
