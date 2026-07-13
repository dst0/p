import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageManifest = {
	scripts: Record<string, string>;
};

describe("AI package build script", () => {
	it("does not regenerate tracked model catalogs", () => {
		const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
		const manifest = JSON.parse(packageJson) as PackageManifest;

		expect(manifest.scripts.generate).toBe("npm run generate-models && npm run generate-image-models");
		expect(manifest.scripts.build).toBe("tsgo -p tsconfig.build.json");
	});
});
