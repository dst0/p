import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Image } from "../src/components/image.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";

const transparent1x1Png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("Image Component", () => {
  beforeEach(() => {
    resetCapabilitiesCache();
  });

  const dummyTheme = {
    fallbackColor: (str: string) => str,
  };

  it("caches rendered lines if width is the same", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    const img = new Image(transparent1x1Png, "image/png", dummyTheme);

    const lines1 = img.render(80);
    const lines2 = img.render(80);
    assert.strictEqual(lines1, lines2, "Should return cached lines");

    const lines3 = img.render(40);
    assert.notStrictEqual(lines1, lines3, "Should re-render on width change");
  });

  it("invalidate() clears the cache", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    const img = new Image(transparent1x1Png, "image/png", dummyTheme);

    const lines1 = img.render(80);
    img.invalidate();
    const lines2 = img.render(80);
    assert.notStrictEqual(lines1, lines2, "Should re-render after invalidate");
  });

  it("getImageId() returns the assigned kitty image ID", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
    const img = new Image(transparent1x1Png, "image/png", dummyTheme, { imageId: 1234 });
    assert.strictEqual(img.getImageId(), 1234);

    const img2 = new Image(transparent1x1Png, "image/png", dummyTheme);
    assert.strictEqual(img2.getImageId(), undefined);
    img2.render(80);
    assert.ok(img2.getImageId() !== undefined, "Should allocate an image ID when rendered in kitty mode");
  });

  it("renders iterm2 images with cursor movement logic", () => {
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: false });
    const dims = { widthPx: 100, heightPx: 100 };
    const img = new Image(transparent1x1Png, "image/png", dummyTheme, {}, dims);

    const lines = img.render(80);

    const expectedRows = lines.length;
    assert.ok(expectedRows > 0, "Should generate some lines");

    // The first (rows-1) lines should be empty strings
    for (let i = 0; i < expectedRows - 1; i++) {
      assert.strictEqual(lines[i], "");
    }

    // The last line should contain cursor up and the image sequence
    const lastLine = lines[expectedRows - 1];
    assert.ok(lastLine.includes(`\x1b[${expectedRows - 1}A`), "Should contain cursor up sequence");
    assert.ok(lastLine.includes("\x1b]1337;File="), "Should contain iterm2 image sequence");
  });
});
