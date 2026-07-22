import { once } from "node:events";
import http from "node:http";
import type { CodeRagService, RagStatus, SemanticSearchInput } from "../../../code-index/src/index.ts";
import { QdrantVectorStore } from "../../../code-index/src/rag/vector-store.ts";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import { configureHttpDispatcher } from "../../src/core/http-dispatcher.ts";
import { createSemanticSearchToolDefinition } from "../../src/core/tools/semantic-search.ts";

const server = http.createServer((request, response) => {
	if (request.method === "GET" && request.url === "/collections/transport-test/exists") {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ result: { exists: true }, status: "ok", time: 0 }));
		return;
	}
	response.writeHead(404, { "Content-Type": "application/json" });
	response.end(JSON.stringify({ status: { error: "not found" } }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("HTTP regression server did not bind to a TCP port");

try {
	configureHttpDispatcher();
	const store = new QdrantVectorStore({ url: `http://127.0.0.1:${address.port}`, timeoutMs: 5_000 });
	const status: RagStatus = {
		state: "ready",
		workspaceRoot: "/workspace",
		repoId: "transport-repo",
		collection: "transport-test",
		generation: "transport-generation",
		indexedFiles: 1,
		indexedChunks: 1,
		sparse: { generation: "transport-generation", exact: true, driftFileCount: 0 },
	};
	const service: CodeRagService = {
		async initialize() {
			return status;
		},
		async status() {
			return status;
		},
		async search(input: SemanticSearchInput) {
			if (!(await store.collectionExists("transport-test"))) {
				throw new Error("Qdrant collection existence response was not preserved");
			}
			return {
				query: input.query,
				workspaceRoot: status.workspaceRoot,
				status,
				results: [
					{
						rank: 1,
						path: "src/transport.ts",
						startLine: 1,
						endLine: 1,
						content: "export const transport = 'fetch';",
					},
				],
				diagnostics: { durationMs: 1, truncated: false },
			};
		},
		async refresh() {
			throw new Error("not used");
		},
		async rebuild() {
			throw new Error("not used");
		},
		async dispose() {},
	};
	const tool = createSemanticSearchToolDefinition("/workspace", service);
	const result = await tool.execute(
		"transport-regression",
		{ query: "fetch transport" },
		undefined,
		undefined,
		{} as ExtensionContext,
	);
	const output = result.content.find((item) => item.type === "text")?.text ?? "";
	if (result.details?.error || !output.includes("src/transport.ts:1-1")) {
		throw new Error("semantic_search did not return the transport fixture");
	}
	process.stdout.write("semantic_search transport ok\n");
} finally {
	server.close();
	await once(server, "close");
}
