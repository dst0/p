import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeIndexingVersion } from "../src/core/indexing-version.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { force: true, recursive: true });
});

describe("NPU installers in computeIndexingVersion", () => {
  it.each(["install-amd-ryzen-ai.js", "install-intel-openvino-npu.js"])(
    "changes the hash when %s changes",
    (filename) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-npu-installer-version-"));
      temporaryDirectories.push(root);
      fs.mkdirSync(path.join(root, "scripts"));
      const installer = path.join(root, "scripts", filename);
      fs.writeFileSync(installer, "export const version = 1;\n");
      const before = computeIndexingVersion(root);

      fs.writeFileSync(installer, "export const version = 2;\n");

      expect(computeIndexingVersion(root)).not.toBe(before);
    },
  );
});
