import { writeFileSync } from "node:fs";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import {
  type ProjectInstructionAuthority,
  writeProjectInstructionResultPublication,
} from "../project-instructions/outer-authority.ts";

export function publishBenchmarkResults(
  path: string,
  document: unknown,
  certified?: boolean,
  projectInstructions?: unknown,
): ProjectInstructionAuthority | undefined {
  if (certified) {
    assertCertifiedOutputWritePath(path, true);
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return undefined;
  }
  return writeProjectInstructionResultPublication(
    path,
    document as Parameters<typeof writeProjectInstructionResultPublication>[1],
    projectInstructions,
  );
}
