import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingProviderHttp } from "../src/embed/http.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

function captureEmbeddingRequests(): string[][] {
	const requests: string[][] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { input: string[] };
			requests.push(body.input);
			return new Response(JSON.stringify({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
	return requests;
}

describe("EmbeddingProviderHttp.encodeQuery", () => {
	it("uses Qwen's instruction-query format for Qwen3 embedding models", async () => {
		const requests = captureEmbeddingRequests();
		const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "Qwen/Qwen3-Embedding-0.6B");

		await provider.encodeQuery("tool definition system");

		expect(requests).toHaveLength(1);
		expect(requests[0][0]).toBe(
			"Instruct: Given a natural-language description of software behaviour, " +
				"retrieve the relevant source-code functions, types, interfaces, modules, and tool definitions.\n" +
				"Query: tool definition system",
		);
	});

	it("does not impose a Qwen-specific instruction on other embedding models", async () => {
		const requests = captureEmbeddingRequests();
		const provider = new EmbeddingProviderHttp("http://127.0.0.1:18742", 3, false, "acme/code-embed-v1");

		await provider.encodeQuery("tool definition system");

		expect(requests).toEqual([["tool definition system"]]);
	});
});
