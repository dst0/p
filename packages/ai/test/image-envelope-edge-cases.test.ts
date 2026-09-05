import { describe, expect, it } from "vitest";
import { detectImageMimeType } from "../src/utils/image-mime.ts";

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return chunk;
}

function pngChunks(...chunks: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

function imageHeader(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return pngChunk("IHDR", header);
}

function webpChunk(type: string, payload: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length & 1));
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

function webp(...chunks: Buffer[]): Buffer {
  const output = Buffer.concat([Buffer.alloc(12), ...chunks]);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WEBP", 8, "ascii");
  return output;
}

function vp8Lossless(width = 1, height = 1): Buffer {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(bits, 1);
  return webpChunk("VP8L", payload);
}

function vp8Extended(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk("VP8X", payload);
}

describe("structural image envelope edge cases", () => {
  it("rejects duplicate PNG headers and PNGs without a terminal chunk", () => {
    const header = imageHeader();
    const imageData = pngChunk("IDAT", Buffer.from([1]));
    const end = pngChunk("IEND", Buffer.alloc(0));
    expect(detectImageMimeType(pngChunks(header, header, imageData, end))).toBeUndefined();
    expect(detectImageMimeType(pngChunks(header, imageData, pngChunk("tEXt", Buffer.from("padding"))))).toBeUndefined();
  });

  it("rejects a JPEG that never declares a frame", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
    expect(detectImageMimeType(jpeg)).toBeUndefined();
  });

  it("accepts GIF extensions and rejects truncated or unsafe GIF blocks", () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const extension = Buffer.from([0x21, 0xf9, 0x01, 0x00, 0x00]);
    expect(detectImageMimeType(Buffer.concat([gif.subarray(0, 19), extension, gif.subarray(19)]))).toBe("image/gif");
    expect(detectImageMimeType(Buffer.concat([gif.subarray(0, 19), Buffer.from([0x21])]))).toBeUndefined();
    expect(
      detectImageMimeType(Buffer.concat([gif.subarray(0, 19), Buffer.from([0x21, 0xf9, 0x05, 0x00])])),
    ).toBeUndefined();
    expect(
      detectImageMimeType(Buffer.concat([gif.subarray(0, 19), Buffer.from([0x21, 0xf9, 0x01, 0x00])])),
    ).toBeUndefined();

    const unsafeDimensions = Buffer.from(gif);
    unsafeDimensions.writeUInt16LE(0xffff, 24);
    unsafeDimensions.writeUInt16LE(0xffff, 26);
    expect(detectImageMimeType(unsafeDimensions)).toBeUndefined();
    expect(detectImageMimeType(gif.subarray(0, -1))).toBeUndefined();
  });

  it("accepts lossless and extended WebP dimensions and rejects malformed variants", () => {
    expect(detectImageMimeType(webp(vp8Lossless(320, 240)))).toBe("image/webp");
    expect(detectImageMimeType(webp(vp8Extended(320, 240), vp8Lossless(320, 240)))).toBe("image/webp");

    const malformedLossless = vp8Lossless();
    malformedLossless[8] = 0;
    expect(detectImageMimeType(webp(malformedLossless))).toBeUndefined();
    expect(detectImageMimeType(webp(vp8Extended(6_001, 6_000), vp8Lossless()))).toBeUndefined();
  });
});
