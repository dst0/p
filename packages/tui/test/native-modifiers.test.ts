import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
