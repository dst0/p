import { formatOsc8Close, formatOsc8Hyperlink, parseOsc8Hyperlink } from "./helpers-part3.ts";
import type { ActiveHyperlink } from "./types.ts";

export class AnsiCodeTracker {
  // Track individual attributes separately so we can reset them specifically
  private bold = false;
  private dim = false;
  private italic = false;
  private underline = false;
  private blink = false;
  private inverse = false;
  private hidden = false;
  private strikethrough = false;
  private fgColor: string | null = null; // Stores the full code like "31" or "38;5;240"
  private bgColor: string | null = null; // Stores the full code like "41" or "48;5;240"
  private activeHyperlink: ActiveHyperlink | null = null;

  process(ansiCode: string): void {
    // OSC 8 hyperlink: \x1b]8;;<url>\x1b\\ (open) or \x1b]8;;\x1b\\ (close).
    // Preserve the original terminator because some terminals only make BEL-terminated
    // links clickable. OAuth login URLs use BEL, so reopening wrapped lines with ST
    // made only the first physical line clickable in those terminals.
    const hyperlink = parseOsc8Hyperlink(ansiCode);
    if (hyperlink !== undefined) {
      this.activeHyperlink = hyperlink;
      return;
    }

    if (!ansiCode.endsWith("m")) {
      return;
    }

    // Extract the parameters between \x1b[ and m
    const match = ansiCode.match(/\x1b\[([\d;]*)m/);
    if (!match) return;

    const params = match[1];
    if (params === "" || params === "0") {
      // Full reset
      this.reset();
      return;
    }

    // Parse parameters (can be semicolon-separated)
    const parts = params.split(";");
    let i = 0;
    while (i < parts.length) {
      const code = Number.parseInt(parts[i], 10);

      // Handle 256-color and RGB codes which consume multiple parameters
      if (code === 38 || code === 48) {
        // 38;5;N (256 color fg) or 38;2;R;G;B (RGB fg)
        // 48;5;N (256 color bg) or 48;2;R;G;B (RGB bg)
        if (parts[i + 1] === "5" && parts[i + 2] !== undefined) {
          // 256 color: 38;5;N or 48;5;N
          const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
          if (code === 38) {
            this.fgColor = colorCode;
          } else {
            this.bgColor = colorCode;
          }
          i += 3;
          continue;
        } else if (parts[i + 1] === "2" && parts[i + 4] !== undefined) {
          // RGB color: 38;2;R;G;B or 48;2;R;G;B
          const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
          if (code === 38) {
            this.fgColor = colorCode;
          } else {
            this.bgColor = colorCode;
          }
          i += 5;
          continue;
        }
      }

      // Standard SGR codes
      switch (code) {
        case 0:
          this.reset();
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 3:
          this.italic = true;
          break;
        case 4:
          this.underline = true;
          break;
        case 5:
          this.blink = true;
          break;
        case 7:
          this.inverse = true;
          break;
        case 8:
          this.hidden = true;
          break;
        case 9:
          this.strikethrough = true;
          break;
        case 21:
          this.bold = false;
          break; // Some terminals
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 23:
          this.italic = false;
          break;
        case 24:
          this.underline = false;
          break;
        case 25:
          this.blink = false;
          break;
        case 27:
          this.inverse = false;
          break;
        case 28:
          this.hidden = false;
          break;
        case 29:
          this.strikethrough = false;
          break;
        case 39:
          this.fgColor = null;
          break; // Default fg
        case 49:
          this.bgColor = null;
          break; // Default bg
        default:
          // Standard foreground colors 30-37, 90-97
          if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
            this.fgColor = String(code);
          }
          // Standard background colors 40-47, 100-107
          else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
            this.bgColor = String(code);
          }
          break;
      }
      i++;
    }
  }

  private reset(): void {
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.blink = false;
    this.inverse = false;
    this.hidden = false;
    this.strikethrough = false;
    this.fgColor = null;
    this.bgColor = null;
    // SGR reset does not affect OSC 8 hyperlink state
  }

  /** Clear all state for reuse. */
  clear(): void {
    this.reset();
    this.activeHyperlink = null;
  }

  getActiveCodes(): string {
    const codes: string[] = [];
    if (this.bold) codes.push("1");
    if (this.dim) codes.push("2");
    if (this.italic) codes.push("3");
    if (this.underline) codes.push("4");
    if (this.blink) codes.push("5");
    if (this.inverse) codes.push("7");
    if (this.hidden) codes.push("8");
    if (this.strikethrough) codes.push("9");
    if (this.fgColor) codes.push(this.fgColor);
    if (this.bgColor) codes.push(this.bgColor);

    let result = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
    if (this.activeHyperlink) {
      result += formatOsc8Hyperlink(this.activeHyperlink);
    }
    return result;
  }

  hasActiveCodes(): boolean {
    return (
      this.bold ||
      this.dim ||
      this.italic ||
      this.underline ||
      this.blink ||
      this.inverse ||
      this.hidden ||
      this.strikethrough ||
      this.fgColor !== null ||
      this.bgColor !== null ||
      this.activeHyperlink !== null
    );
  }

  /**
   * Get reset codes for attributes that need to be turned off at line end.
   * Underline must be closed to prevent bleeding into padding.
   * Active OSC 8 hyperlinks must be closed and re-opened on the next line.
   * Returns empty string if no attributes need closing.
   */
  getLineEndReset(): string {
    let result = "";
    if (this.underline) {
      result += "\x1b[24m"; // Underline off only
    }
    if (this.activeHyperlink) {
      result += formatOsc8Close(this.activeHyperlink.terminator); // Re-opened at line start via getActiveCodes()
    }
    return result;
  }
}
