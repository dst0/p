import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  _test_resetNativeModifiersHelper,
  _test_setNativeModifiersHelper,
  isNativeModifiersHelperAvailable,
} from "../src/native-modifiers.ts";
import { hasAppleTerminalShiftEnterFallback } from "../src/terminal.ts";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalTermProgram = process.env.TERM_PROGRAM;
const isDarwinHost = process.platform === "darwin";
const fakeHelper = { isModifierPressed: () => false };

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("native modifier helper availability", () => {
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    _test_resetNativeModifiersHelper();
  });

  it("is unavailable off macOS", () => {
    setPlatform("linux");
    _test_resetNativeModifiersHelper();

    assert.equal(isNativeModifiersHelperAvailable(), false);
  });

  it("loads the packaged prebuilt binary on a macOS host", { skip: !isDarwinHost }, () => {
    _test_resetNativeModifiersHelper();

    assert.equal(isNativeModifiersHelperAvailable(), true);
  });
});

describe("hasAppleTerminalShiftEnterFallback", () => {
  beforeEach(() => {
    setPlatform("darwin");
    process.env.TERM_PROGRAM = "Apple_Terminal";
    _test_setNativeModifiersHelper(fakeHelper);
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = originalTermProgram;
    _test_resetNativeModifiersHelper();
  });

  it("is true for a local Apple Terminal session whose native modifier helper loaded", () => {
    assert.equal(hasAppleTerminalShiftEnterFallback(), true);
  });

  it("is false when the native modifier helper is missing", () => {
    _test_setNativeModifiersHelper(null);

    assert.equal(hasAppleTerminalShiftEnterFallback(), false);
  });

  it("is false in other terminals even when the helper loaded", () => {
    process.env.TERM_PROGRAM = "iTerm.app";

    assert.equal(hasAppleTerminalShiftEnterFallback(), false);
  });

  it("is false when TERM_PROGRAM is unset", () => {
    delete process.env.TERM_PROGRAM;

    assert.equal(hasAppleTerminalShiftEnterFallback(), false);
  });

  it("is false for an Apple Terminal session that is not on a macOS host", () => {
    setPlatform("linux");

    assert.equal(hasAppleTerminalShiftEnterFallback(), false);
  });
});
