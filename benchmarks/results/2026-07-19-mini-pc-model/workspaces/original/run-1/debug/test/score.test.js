const test = require("node:test");
const assert = require("node:assert/strict");
const { average } = require("../src/score.js");

test("keeps fractional averages", () => {
  assert.equal(average([1, 2, 4]), 7 / 3);
});

test("handles empty input", () => {
  assert.equal(average([]), 0);
});
