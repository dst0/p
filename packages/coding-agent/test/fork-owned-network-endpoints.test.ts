import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getShareViewerUrl } from "../src/config.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Hosts p does not own, including their subdomains: upstream pi's domain, the unrelated `p.dev`,
 * and the unowned `p.pages.dev` Pages project.
 */
const UNOWNED_HOST_PATTERN = /(?<![\w-])(?:pi\.dev|p\.dev|p\.pages\.dev)(?![\w-])/i;
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".wasm"]);
const originalShareViewerUrl = process.env.P_SHARE_VIEWER_URL;

function listTextFiles(directory: string, extensions?: ReadonlySet<string>): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.split(sep).includes("node_modules"))
    .filter((file) => (extensions ? extensions.has(extname(file)) : !BINARY_EXTENSIONS.has(extname(file))));
}

function findUnownedHostReferences(files: string[]): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf-8")
      .split("\n")
      .flatMap((line, index) =>
        UNOWNED_HOST_PATTERN.test(line) ? [`${relative(packageRoot, file)}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
}

afterEach(() => {
  if (originalShareViewerUrl === undefined) delete process.env.P_SHARE_VIEWER_URL;
  else process.env.P_SHARE_VIEWER_URL = originalShareViewerUrl;
});

describe("fork-owned network endpoints", () => {
  it("recognizes unowned hosts and their subdomains but not the project's own Pages domain", () => {
    for (const reference of [
      "https://pi.dev/api/latest-version",
      "`p.pages.dev`.",
      "https://p.dev/session/",
      "https://api.pi.dev/x",
      "https://www.p.dev",
      "https://preview.p.pages.dev",
      "https://PI.DEV/x",
    ]) {
      expect(UNOWNED_HOST_PATTERN.test(reference), reference).toBe(true);
    }
    for (const reference of ["https://p-agent.pages.dev/api/report-install", "https://exe.dev", "setup.dev"]) {
      expect(UNOWNED_HOST_PATTERN.test(reference), reference).toBe(false);
    }
  });

  it("keeps runtime source and published examples free of hosts p does not own", () => {
    const files = [...listTextFiles(join(packageRoot, "src")), ...listTextFiles(join(packageRoot, "examples"))];

    expect(files.length).toBeGreaterThan(100);
    expect(findUnownedHostReferences(files)).toEqual([]);
  });

  it("keeps the package README and docs free of hosts p does not own", () => {
    const docs = listTextFiles(join(packageRoot, "docs"), new Set([".md"]));

    expect(docs.length).toBeGreaterThan(10);
    expect(findUnownedHostReferences([join(packageRoot, "README.md"), ...docs])).toEqual([]);
  });

  it("defaults /share viewer links to the project's own Pages domain", () => {
    delete process.env.P_SHARE_VIEWER_URL;

    expect(getShareViewerUrl("abc123")).toBe("https://p-agent.pages.dev/session/#abc123");
  });
});
