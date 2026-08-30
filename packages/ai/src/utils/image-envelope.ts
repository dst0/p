// Supports 8K-class custom-provider output while bounding decoded RGBA expansion.
export const MAX_IMAGE_PIXELS = 36_000_000;

function matchesBytes(buffer: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => buffer[offset + index] === value);
}

function readUint16BigEndian(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] << 8) | buffer[offset + 1];
}

function readUint16LittleEndian(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readUint24LittleEndian(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readUint32BigEndian(buffer: Uint8Array, offset: number): number {
  return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
}

function readUint32LittleEndian(buffer: Uint8Array, offset: number): number {
  return ((buffer[offset + 3] << 24) | (buffer[offset + 2] << 16) | (buffer[offset + 1] << 8) | buffer[offset]) >>> 0;
}

function hasSafeDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= Math.floor(MAX_IMAGE_PIXELS / height);
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(buffer: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let index = start; index < end; index++) value = CRC32_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function isPng(buffer: Uint8Array): boolean {
  if (buffer.length < 57 || !matchesBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return false;
  }
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= buffer.length) {
    const payloadLength = readUint32BigEndian(buffer, offset);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    const chunkEnd = payloadEnd + 4;
    if (chunkEnd > buffer.length || crc32(buffer, offset + 4, payloadEnd) !== readUint32BigEndian(buffer, payloadEnd)) {
      return false;
    }
    const isHeader = matchesBytes(buffer, offset + 4, [0x49, 0x48, 0x44, 0x52]);
    const isImageData = matchesBytes(buffer, offset + 4, [0x49, 0x44, 0x41, 0x54]);
    const isEnd = matchesBytes(buffer, offset + 4, [0x49, 0x45, 0x4e, 0x44]);
    if (!sawHeader) {
      if (
        !isHeader ||
        payloadLength !== 13 ||
        !hasSafeDimensions(readUint32BigEndian(buffer, payloadStart), readUint32BigEndian(buffer, payloadStart + 4))
      ) {
        return false;
      }
      sawHeader = true;
    } else if (isHeader) {
      return false;
    }
    if (isImageData) sawImageData ||= payloadLength > 0;
    if (isEnd) return payloadLength === 0 && sawImageData && chunkEnd === buffer.length;
    offset = chunkEnd;
  }
  return false;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function isJpeg(buffer: Uint8Array): boolean {
  if (
    buffer.length < 16 ||
    !matchesBytes(buffer, 0, [0xff, 0xd8]) ||
    !matchesBytes(buffer, buffer.length - 2, [0xff, 0xd9])
  ) {
    return false;
  }
  let offset = 2;
  let sawFrame = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset++] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) return false;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length - 2) return false;
    const segmentLength = readUint16BigEndian(buffer, offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length - 2) return false;
    if (isJpegStartOfFrame(marker)) {
      if (
        segmentLength < 8 ||
        !hasSafeDimensions(readUint16BigEndian(buffer, offset + 5), readUint16BigEndian(buffer, offset + 3))
      ) {
        return false;
      }
      sawFrame = true;
    }
    if (marker === 0xda) return sawFrame && segmentEnd < buffer.length - 2;
    offset = segmentEnd;
  }
  return false;
}

function skipGifSubBlocks(
  buffer: Uint8Array,
  initialOffset: number,
): { offset: number; hasPayload: boolean } | undefined {
  let offset = initialOffset;
  let hasPayload = false;
  while (offset < buffer.length) {
    const length = buffer[offset++];
    if (length === 0) return { offset, hasPayload };
    if (offset + length > buffer.length) return undefined;
    hasPayload = true;
    offset += length;
  }
  return undefined;
}

function gifColorTableBytes(packed: number): number {
  return packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
}

function isGif(buffer: Uint8Array): boolean {
  if (
    buffer.length < 20 ||
    !matchesBytes(buffer, 0, [0x47, 0x49, 0x46, 0x38]) ||
    (buffer[4] !== 0x37 && buffer[4] !== 0x39) ||
    buffer[5] !== 0x61 ||
    !hasSafeDimensions(readUint16LittleEndian(buffer, 6), readUint16LittleEndian(buffer, 8))
  ) {
    return false;
  }
  let offset = 13 + gifColorTableBytes(buffer[10]);
  let sawImage = false;
  while (offset < buffer.length) {
    const marker = buffer[offset++];
    if (marker === 0x3b) return sawImage && offset === buffer.length;
    if (marker === 0x21) {
      if (offset >= buffer.length) return false;
      const extension = skipGifSubBlocks(buffer, offset + 1);
      if (!extension) return false;
      offset = extension.offset;
      continue;
    }
    if (marker !== 0x2c || offset + 9 > buffer.length) return false;
    if (!hasSafeDimensions(readUint16LittleEndian(buffer, offset + 4), readUint16LittleEndian(buffer, offset + 6))) {
      return false;
    }
    offset += 9;
    offset += gifColorTableBytes(buffer[offset - 1]);
    if (offset >= buffer.length) return false;
    offset++;
    const imageData = skipGifSubBlocks(buffer, offset);
    if (!imageData?.hasPayload) return false;
    sawImage = true;
    offset = imageData.offset;
  }
  return false;
}

function webpDimensions(buffer: Uint8Array, chunkOffset: number, chunkLength: number): [number, number] | undefined {
  const payload = chunkOffset + 8;
  if (matchesBytes(buffer, chunkOffset, [0x56, 0x50, 0x38, 0x20])) {
    if (chunkLength < 10 || !matchesBytes(buffer, payload + 3, [0x9d, 0x01, 0x2a])) return undefined;
    return [readUint16LittleEndian(buffer, payload + 6) & 0x3fff, readUint16LittleEndian(buffer, payload + 8) & 0x3fff];
  }
  if (matchesBytes(buffer, chunkOffset, [0x56, 0x50, 0x38, 0x4c])) {
    if (chunkLength < 5 || buffer[payload] !== 0x2f) return undefined;
    const width = 1 + (((buffer[payload + 2] & 0x3f) << 8) | buffer[payload + 1]);
    const height = 1 + ((buffer[payload + 4] & 0x0f) << 10) + (buffer[payload + 3] << 2) + (buffer[payload + 2] >> 6);
    return [width, height];
  }
  return undefined;
}

function isWebp(buffer: Uint8Array): boolean {
  if (
    buffer.length < 26 ||
    !matchesBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) ||
    readUint32LittleEndian(buffer, 4) !== buffer.length - 8 ||
    !matchesBytes(buffer, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return false;
  }
  let offset = 12;
  let sawImage = false;
  while (offset + 8 <= buffer.length) {
    const chunkLength = readUint32LittleEndian(buffer, offset + 4);
    const chunkEnd = offset + 8 + chunkLength;
    const paddedEnd = chunkEnd + (chunkLength & 1);
    if (paddedEnd > buffer.length) return false;
    const dimensions = webpDimensions(buffer, offset, chunkLength);
    if (dimensions) {
      if (!hasSafeDimensions(...dimensions)) return false;
      sawImage = true;
    } else if (matchesBytes(buffer, offset, [0x56, 0x50, 0x38, 0x58])) {
      if (
        chunkLength !== 10 ||
        !hasSafeDimensions(
          readUint24LittleEndian(buffer, offset + 12) + 1,
          readUint24LittleEndian(buffer, offset + 15) + 1,
        )
      ) {
        return false;
      }
    }
    offset = paddedEnd;
  }
  return sawImage && offset === buffer.length;
}

export function detectImageMimeType(buffer: Uint8Array): string | undefined {
  if (isJpeg(buffer)) return "image/jpeg";
  if (isPng(buffer)) return "image/png";
  if (isGif(buffer)) return "image/gif";
  if (isWebp(buffer)) return "image/webp";
  return undefined;
}
