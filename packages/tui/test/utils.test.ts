import assert from "node:assert";
import { describe, it } from "node:test";
import { truncateToWidth, wrapTextWithAnsi } from "../src/utils.ts";

describe("truncateFragmentToWidth (via truncateToWidth)", () => {
  it("truncates ellipsis with ANSI and tabs correctly", () => {
    // Truncate to width 2, where ellipsis itself is 4 chars wide with ANSI and Tab
    const res = truncateToWidth("hello", 2, "\x1b[31mA\t\x1b[0mB", false);
    // The ellipsis visible width is 1 (A) + 4 (Tab) + 1 (B) = 6.
    // It's wider than 2. So truncateFragmentToWidth is called with maxWidth 2.
    // It should yield "\x1b[31mA" which has width 1, because Tab jumps to 4 which > 2.
    // Plus the reset codes added by truncateToWidth.
    assert.equal(res.includes("\x1b[31mA"), true);
  });
});
it("truncates ascii ellipsis correctly", () => {
  // Truncate to width 2, where ellipsis is "..."
  const res = truncateToWidth("hello", 2, "...");
  // It should yield ".." because ellipsis is too wide and is ascii.
  assert.equal(res.includes(".."), true);
  assert.equal(res.includes("..."), false);
});
it("truncates ellipsis with ANSI and tabs correctly (includes tab)", () => {
  // Truncate to width 5, where ellipsis itself is 6 chars wide
  const res = truncateToWidth("hello world", 5, "\x1b[31mA\t\x1b[0mB");
  console.log(JSON.stringify(res));
  assert.equal(res.includes("\x1b[31mA\t"), true);
});

describe("AnsiCodeTracker (via wrapTextWithAnsi)", () => {
  it("preserves 256-color codes across wraps", () => {
    // fg 256 color
    const text = "\x1b[38;5;196mhello world\x1b[0m";
    const lines = wrapTextWithAnsi(text, 5);
    // Line 1: \x1b[38;5;196mhello\x1b[0m
    // Line 2: \x1b[38;5;196m world\x1b[0m (with reset of course)
    assert.equal(lines[1]!.includes("\x1b[38;5;196m"), true);
  });

  it("preserves RGB color codes across wraps", () => {
    // bg RGB color
    const text = "\x1b[48;2;255;128;0mhello world\x1b[0m";
    const lines = wrapTextWithAnsi(text, 5);
    assert.equal(lines[1]!.includes("\x1b[48;2;255;128;0m"), true);
  });
});
it("truncates ellipsis with ANSI immediately followed by tab", () => {
  // ellipsisWidth = 4. maxWidth = 4. It will call truncateFragmentToWidth.
  // ANSI is followed by Tab, which fits (0 + 4 <= 4).
  const res = truncateToWidth("hello", 4, "\x1b[31m\tB");
  assert.equal(res.includes("\x1b[31m\t"), true);
});
