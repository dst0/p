import { describe, it } from "node:test";
import { ProcessTerminal } from "../src/terminal.ts";

describe("ProcessTerminal clean test", () => {
  it("covers drainInput clean", async () => {
    const terminal = new ProcessTerminal();
    terminal.start(
      () => {},
      () => {},
    );
    await terminal.drainInput(10, 5);
    terminal.stop();
  });
});
