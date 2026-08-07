import { segmenter } from "../constants.ts";
import type { Input } from "../input.ts";

export function do_getValue(self: Input): string {
  return self.value;
}

export function do_setValue(self: Input, value: string): void {
  self.value = value;
  self.cursor = Math.min(self.cursor, value.length);
  self.scrollOffset = 0;
  if (self.cursor > 0 && self.cursor < value.length) {
    let pos = 0;
    for (const { segment } of segmenter.segment(value)) {
      if (pos + segment.length > self.cursor) {
        self.cursor = pos;
        break;
      }
      pos += segment.length;
    }
  }
}
