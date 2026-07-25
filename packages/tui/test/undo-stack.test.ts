import assert from "node:assert";
import { describe, it } from "node:test";
import { UndoStack } from "../src/undo-stack.ts";

describe("UndoStack", () => {
  it("pushes, pops, clears, and tracks length", () => {
    const stack = new UndoStack<{ val: string }>();
    assert.strictEqual(stack.length, 0);
    assert.strictEqual(stack.pop(), undefined);

    stack.push({ val: "first" });
    stack.push({ val: "second" });
    assert.strictEqual(stack.length, 2);

    const popped = stack.pop();
    assert.deepStrictEqual(popped, { val: "second" });
    assert.strictEqual(stack.length, 1);

    stack.clear();
    assert.strictEqual(stack.length, 0);
    assert.strictEqual(stack.pop(), undefined);
  });
});
