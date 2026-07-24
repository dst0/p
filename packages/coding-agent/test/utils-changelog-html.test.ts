import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { compareVersions, getNewEntries, normalizeChangelogLinks, parseChangelog } from "../src/utils/changelog.ts";
import { decodeHtmlEntity, decodeHtmlEntityAt } from "../src/utils/html.ts";

describe("changelog utils", () => {
	it("normalizes links in changelog markdown", () => {
		const input = "Check [docs](docs/README.md) and [legacy](https://github.com/dst0/p-mono/blob/main/foo.ts)";
		const normalized = normalizeChangelogLinks(input, "0.4.45");

		expect(normalized).toContain("https://github.com/dst0/p/");
		expect(normalized).toContain("v0.4.45");
	});

	it("compares version entries correctly", () => {
		const v1 = { major: 1, minor: 0, patch: 0, content: "" };
		const v2 = { major: 1, minor: 2, patch: 0, content: "" };
		const v3 = { major: 1, minor: 2, patch: 5, content: "" };

		expect(compareVersions(v1, v2)).toBeLessThan(0);
		expect(compareVersions(v2, v1)).toBeGreaterThan(0);
		expect(compareVersions(v2, v3)).toBeLessThan(0);
		expect(compareVersions(v1, v1)).toBe(0);
	});

	it("filters new entries", () => {
		const entries = [
			{ major: 0, minor: 4, patch: 10, content: "v10" },
			{ major: 0, minor: 4, patch: 20, content: "v20" },
			{ major: 0, minor: 5, patch: 0, content: "v5" },
		];

		const newOnes = getNewEntries(entries, "0.4.15");
		expect(newOnes.length).toBe(2);
		expect(newOnes[0].patch).toBe(20);
		expect(newOnes[1].minor).toBe(5);
	});

	it("parses CHANGELOG.md file format", () => {
		const tmpFile = path.join(os.tmpdir(), `test-changelog-${Date.now()}.md`);
		const content = `# Changelog\n\n## [0.2.0] - 2026-01-01\nAdded feature A\n\n## [0.1.0] - 2025-12-01\nInitial release\n`;

		fs.writeFileSync(tmpFile, content, "utf-8");
		try {
			const entries = parseChangelog(tmpFile);
			expect(entries.length).toBe(2);
			expect(entries[0].major).toBe(0);
			expect(entries[0].minor).toBe(2);
			expect(entries[0].content).toContain("Added feature A");
		} finally {
			fs.unlinkSync(tmpFile);
		}

		expect(parseChangelog("/nonexistent/file.md")).toEqual([]);
	});
});

describe("html entity utils", () => {
	it("decodes named, hex, and decimal entities", () => {
		expect(decodeHtmlEntity("amp")).toBe("&");
		expect(decodeHtmlEntity("lt")).toBe("<");
		expect(decodeHtmlEntity("gt")).toBe(">");
		expect(decodeHtmlEntity("quot")).toBe('"');
		expect(decodeHtmlEntity("apos")).toBe("'");
		expect(decodeHtmlEntity("#x26")).toBe("&");
		expect(decodeHtmlEntity("#38")).toBe("&");
		expect(decodeHtmlEntity("unknown")).toBeUndefined();
		expect(decodeHtmlEntity("#x1100000")).toBeUndefined();
	});

	it("decodes html entity at specific string index", () => {
		const str = "Foo &amp; Bar";
		const res = decodeHtmlEntityAt(str, 4);
		expect(res).toEqual({ text: "&", length: 5 });

		expect(decodeHtmlEntityAt("No entity", 0)).toBeUndefined();
		expect(decodeHtmlEntityAt("&toolongentityname1234567890;", 0)).toBeUndefined();
	});
});
