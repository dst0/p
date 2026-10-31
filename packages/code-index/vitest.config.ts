import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		setupFiles: ["./test/setup-qdrant-client-without-version-check.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text-summary", "lcov", "json-summary"],
			include: ["src/**/*.ts"],
			reportOnFailure: true,
		},
	},
});
