import type { Component } from "../tui.ts";
import { applyBackgroundToLine, visibleWidth } from "../utils.ts";

type RenderCache = {
  childLines: string[];
  width: number;
  bgSample: string | undefined;
  accentSample: string | undefined;
  lines: string[];
};

/**
 * Box component - a container that applies padding and background to all children
 */
export class Box implements Component {
  children: Component[] = [];
  private paddingX: number;
  private paddingY: number;
  private bgFn?: (text: string) => string;
  private accentFn?: (text: string) => string;

  // Cache for rendered output
  private cache?: RenderCache;

  constructor(paddingX = 1, paddingY = 1, bgFn?: (text: string) => string, accentFn?: (text: string) => string) {
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.bgFn = bgFn;
    this.accentFn = accentFn;
  }

  addChild(component: Component): void {
    this.children.push(component);
    this.invalidateCache();
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
      this.invalidateCache();
    }
  }

  clear(): void {
    this.children = [];
    this.invalidateCache();
  }

  setBgFn(bgFn?: (text: string) => string): void {
    this.bgFn = bgFn;
    // Don't invalidate here - we'll detect bgFn changes by sampling output
  }

  setAccentFn(accentFn?: (text: string) => string): void {
    this.accentFn = accentFn;
  }

  private invalidateCache(): void {
    this.cache = undefined;
  }

  private matchCache(
    width: number,
    childLines: string[],
    bgSample: string | undefined,
    accentSample: string | undefined,
  ): boolean {
    const cache = this.cache;
    return (
      !!cache &&
      cache.width === width &&
      cache.bgSample === bgSample &&
      cache.accentSample === accentSample &&
      cache.childLines.length === childLines.length &&
      cache.childLines.every((line, i) => line === childLines[i])
    );
  }

  invalidate(): void {
    this.invalidateCache();
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number): string[] {
    if (this.children.length === 0) {
      return [];
    }

    const accentWidth = this.accentFn ? 1 : 0;
    const contentWidth = Math.max(1, width - this.paddingX * 2 - accentWidth);
    const leftPad = " ".repeat(this.paddingX);

    // Render all children
    const childLines: string[] = [];
    for (const child of this.children) {
      const lines = child.render(contentWidth);
      for (const line of lines) {
        childLines.push(leftPad + line);
      }
    }

    if (childLines.length === 0) {
      return [];
    }

    // Check if bgFn/accentFn output changed by sampling
    const bgSample = this.bgFn ? this.bgFn("test") : undefined;
    const accentSample = this.accentFn ? this.accentFn("test") : undefined;

    // Check cache validity
    if (this.matchCache(width, childLines, bgSample, accentSample)) {
      return this.cache!.lines;
    }

    // Apply background, accent bar, and padding
    const result: string[] = [];
    const accentPrefix = this.accentFn ? this.accentFn("\u2502") : "";

    // Top padding
    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg(accentPrefix, width));
    }

    // Content
    for (const line of childLines) {
      result.push(this.applyBg(accentPrefix + line, width));
    }

    // Bottom padding
    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg(accentPrefix, width));
    }

    // Update cache
    this.cache = { childLines, width, bgSample, accentSample, lines: result };

    return result;
  }

  private applyBg(line: string, width: number): string {
    const visLen = visibleWidth(line);
    const padNeeded = Math.max(0, width - visLen);
    const padded = line + " ".repeat(padNeeded);

    if (this.bgFn) {
      return applyBackgroundToLine(padded, width, this.bgFn);
    }
    return padded;
  }
}
