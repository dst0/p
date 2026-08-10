import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "../../utils.ts";
import type { TUI } from "../tui.ts";

export function throwRenderWidthError(
  self: TUI,
  newLines: string[],
  line: string,
  index: number,
  width: number,
): never {
  const crashLogPath = path.join(os.homedir(), ".p", "agent", "pi-crash.log");
  const crashData = [
    `Crash at ${new Date().toISOString()}`,
    `Terminal width: ${width}`,
    `Line ${index} visible width: ${visibleWidth(line)}`,
    "",
    "=== All rendered lines ===",
    ...newLines.map(
      (renderedLine, renderedIndex) => `[${renderedIndex}] (w=${visibleWidth(renderedLine)}) ${renderedLine}`,
    ),
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
  fs.writeFileSync(crashLogPath, crashData);
  self.stop();

  throw new Error(
    [
      `Rendered line ${index} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
      "",
      "This is likely caused by a custom TUI component not truncating its output.",
      "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
      "",
      `Debug log written to: ${crashLogPath}`,
    ].join("\n"),
  );
}
