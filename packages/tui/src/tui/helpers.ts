import { KITTY_SEQUENCE_PREFIX } from "./constants.ts";
import type { Component, Focusable, KittyImageHeader, SizeValue } from "./types-part1.ts";

export function parseKittyImageHeader(line: string): KittyImageHeader | undefined {
  const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
  if (sequenceStart === -1) return undefined;

  const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
  const paramsEnd = line.indexOf(";", paramsStart);
  if (paramsEnd === -1) return undefined;

  const ids: number[] = [];
  let rows = 1;
  const params = line.slice(paramsStart, paramsEnd);
  for (const param of params.split(",")) {
    const [key, value] = param.split("=", 2);
    if (value === undefined) continue;
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 0xffffffff) continue;
    if (key === "i") {
      ids.push(numberValue);
    } else if (key === "r") {
      rows = numberValue;
    }
  }
  return { ids, rows };
}

export function extractKittyImageIds(line: string): number[] {
  return parseKittyImageHeader(line)?.ids ?? [];
}

export function extractKittyImageRows(line: string): number {
  return parseKittyImageHeader(line)?.rows ?? 1;
}

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && "focused" in component;
}

export function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  // Parse percentage string like "50%"
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (match) {
    return Math.floor((referenceSize * parseFloat(match[1])) / 100);
  }
  return undefined;
}

export function isTermuxSession(): boolean {
  return Boolean(process.env.TERMUX_VERSION);
}
