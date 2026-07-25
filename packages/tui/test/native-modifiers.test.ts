import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isNativeModifierPressed } from "../src/native-modifiers.ts";

describe("isNativeModifierPressed", () => {
  it("returns boolean without throwing on any platform", () => {
    const result = isNativeModifierPressed("shift");
    assert.equal(typeof result, "boolean");
  });

  it("handles all modifier keys", () => {
    assert.equal(typeof isNativeModifierPressed("command"), "boolean");
    assert.equal(typeof isNativeModifierPressed("control"), "boolean");
    assert.equal(typeof isNativeModifierPressed("option"), "boolean");
  });
});

import {
  _test_isNativeModifiersHelper,
  _test_loadNativeModifiersHelper,
  _test_resetNativeModifiersHelper,
} from "../src/native-modifiers.ts";

describe("native-modifiers internals", () => {
  afterEach(() => {
    _test_resetNativeModifiersHelper();
  });

  it("isNativeModifiersHelper validates correctly", () => {
    assert.equal(_test_isNativeModifiersHelper(null), false);
    assert.equal(_test_isNativeModifiersHelper(undefined), false);
    assert.equal(_test_isNativeModifiersHelper({}), false);
    assert.equal(_test_isNativeModifiersHelper({ isModifierPressed: "not-a-func" }), false);
    assert.equal(_test_isNativeModifiersHelper({ isModifierPressed: () => true }), true);
  });

  it("loadNativeModifiersHelper skips non-darwin", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      _test_resetNativeModifiersHelper();
      assert.equal(_test_loadNativeModifiersHelper(), undefined);
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    }
  });

  it("loadNativeModifiersHelper skips unsupported arch on darwin", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const origArch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "ia32" });
    try {
      _test_resetNativeModifiersHelper();
      assert.equal(_test_loadNativeModifiersHelper(), undefined);
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
      if (origArch) Object.defineProperty(process, "arch", origArch);
    }
  });

  it("loadNativeModifiersHelper attempts to load and caches result", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const origArch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { value: "darwin" });
    Object.defineProperty(process, "arch", { value: "x64" }); // Or arm64
    try {
      _test_resetNativeModifiersHelper();
      const res1 = _test_loadNativeModifiersHelper();
      const res2 = _test_loadNativeModifiersHelper();
      assert.equal(res1, res2);
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
      if (origArch) Object.defineProperty(process, "arch", origArch);
    }
  });
});
