import { parseSizeValue } from "../helpers.ts";
import type { TUI } from "../tui.ts";
import type { OverlayAnchor, OverlayOptions } from "../types-part1.ts";

export function do_resolveOverlayLayout(
  self: TUI,
  options: OverlayOptions | undefined,
  overlayHeight: number,
  termWidth: number,
  termHeight: number,
): { width: number; row: number; col: number; maxHeight: number | undefined } {
  const opt = options ?? {};

  // Parse margin (clamp to non-negative)
  const margin =
    typeof opt.margin === "number"
      ? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin }
      : (opt.margin ?? {});
  const marginTop = Math.max(0, margin.top ?? 0);
  const marginRight = Math.max(0, margin.right ?? 0);
  const marginBottom = Math.max(0, margin.bottom ?? 0);
  const marginLeft = Math.max(0, margin.left ?? 0);

  // Available space after margins
  const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
  const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

  // === Resolve width ===
  let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
  // Apply minWidth
  if (opt.minWidth !== undefined) {
    width = Math.max(width, opt.minWidth);
  }
  // Clamp to available space
  width = Math.max(1, Math.min(width, availWidth));

  // === Resolve maxHeight ===
  let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
  // Clamp to available space
  if (maxHeight !== undefined) {
    maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
  }

  // Effective overlay height (may be clamped by maxHeight)
  const effectiveHeight = maxHeight !== undefined ? Math.min(overlayHeight, maxHeight) : overlayHeight;

  // === Resolve position ===
  let row: number;
  let col: number;

  if (opt.row !== undefined) {
    if (typeof opt.row === "string") {
      // Percentage: 0% = top, 100% = bottom (overlay stays within bounds)
      const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
      if (match) {
        const maxRow = Math.max(0, availHeight - effectiveHeight);
        const percent = parseFloat(match[1]) / 100;
        row = marginTop + Math.floor(maxRow * percent);
      } else {
        // Invalid format, fall back to center
        row = self.resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
      }
    } else {
      // Absolute row position
      row = opt.row;
    }
  } else {
    // Anchor-based (default: center)
    const anchor = opt.anchor ?? "center";
    row = self.resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
  }

  if (opt.col !== undefined) {
    if (typeof opt.col === "string") {
      // Percentage: 0% = left, 100% = right (overlay stays within bounds)
      const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
      if (match) {
        const maxCol = Math.max(0, availWidth - width);
        const percent = parseFloat(match[1]) / 100;
        col = marginLeft + Math.floor(maxCol * percent);
      } else {
        // Invalid format, fall back to center
        col = self.resolveAnchorCol("center", width, availWidth, marginLeft);
      }
    } else {
      // Absolute column position
      col = opt.col;
    }
  } else {
    // Anchor-based (default: center)
    const anchor = opt.anchor ?? "center";
    col = self.resolveAnchorCol(anchor, width, availWidth, marginLeft);
  }

  // Apply offsets
  if (opt.offsetY !== undefined) row += opt.offsetY;
  if (opt.offsetX !== undefined) col += opt.offsetX;

  // Clamp to terminal bounds (respecting margins)
  row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
  col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));

  return { width, row, col, maxHeight };
}

export function do_resolveAnchorRow(
  _self: TUI,
  anchor: OverlayAnchor,
  height: number,
  availHeight: number,
  marginTop: number,
): number {
  switch (anchor) {
    case "top-left":
    case "top-center":
    case "top-right":
      return marginTop;
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
      return marginTop + availHeight - height;
    case "left-center":
    case "center":
    case "right-center":
      return marginTop + Math.floor((availHeight - height) / 2);
  }
}

export function do_resolveAnchorCol(
  _self: TUI,
  anchor: OverlayAnchor,
  width: number,
  availWidth: number,
  marginLeft: number,
): number {
  switch (anchor) {
    case "top-left":
    case "left-center":
    case "bottom-left":
      return marginLeft;
    case "top-right":
    case "right-center":
    case "bottom-right":
      return marginLeft + availWidth - width;
    case "top-center":
    case "center":
    case "bottom-center":
      return marginLeft + Math.floor((availWidth - width) / 2);
  }
}
