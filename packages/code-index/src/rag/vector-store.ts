import { QdrantClient as QdrantClientRaw, type Schemas } from "@qdrant/js-client-rest";
import type {
	RagVectorStore,
	SparseVector,
	StoredChunkPayload,
	VectorPoint,
	VectorSearchFilters,
	VectorSearchResult,
} from "./types.ts";

export interface QdrantVectorStoreOptions {
	url: string;
	timeoutMs: number;
}

/** HNSW query beam width — lower than default 100 for faster traversal. */
const HNSW_EF = 60;
/** HNSW graph max degree — leaner graph reduces traversal nodes. */
const HNSW_M = 10;
/** HNSW construction beam — higher than query ef for better build quality. */
const HNSW_EF_CONSTRUCTION = 128;

export class QdrantVectorStore implements RagVectorStore {
	private client: QdrantClientRaw;

	constructor(options: QdrantVectorStoreOptions) {
		this.client = new QdrantClientRaw({ url: options.url, timeout: options.timeoutMs, checkCompatibility: false });
	}

	async createCollection(collection: string, denseDimensions: number): Promise<void> {
		const existence = await this.client.collectionExists(collection);
		if (existence.exists) {
			const status = await this.collectionStatus(collection);
			if (status.dimensions !== denseDimensions) {
				throw new Error(
					`Collection ${collection} has ${status.dimensions ?? "unknown"} dimensions; expected ${denseDimensions}`,
				);
			}
			return;
		}
		await this.client.createCollection(collection, {
			vectors: { dense: { size: denseDimensions, distance: "Cosine" } },
			sparse_vectors: { sparse: {} },
			on_disk_payload: true,
			hnsw_config: { m: HNSW_M, ef_construction: HNSW_EF_CONSTRUCTION },
			quantization_config: { scalar: { type: "int8" } },
		});
		await this.createPayloadIndexes(collection);
	}

	async deleteCollection(collection: string): Promise<void> {
		const existence = await this.client.collectionExists(collection);
		if (existence.exists) await this.client.deleteCollection(collection);
	}

	async collectionStatus(collection: string): Promise<{ points: number; dimensions: number | undefined }> {
		const info = await this.client.getCollection(collection);
		const vectors = info.config?.params?.vectors;
		let dimensions: number | undefined;
		if (vectors && typeof vectors === "object" && !Array.isArray(vectors)) {
			const dense = (vectors as Record<string, unknown>).dense;
			if (dense && typeof dense === "object" && !Array.isArray(dense)) {
				const size = (dense as Record<string, unknown>).size;
				if (typeof size === "number") dimensions = size;
			}
		}
		return { points: info.points_count ?? 0, dimensions };
	}

	async createPayloadIndexes(collection: string): Promise<void> {
		const indexes: Array<{ field_name: string; field_schema: Schemas["PayloadSchemaType"] }> = [
			{ field_name: "repoId", field_schema: "keyword" },
			{ field_name: "language", field_schema: "keyword" },
			{ field_name: "isTest", field_schema: "bool" },
			{ field_name: "isGenerated", field_schema: "bool" },
		];
		for (const idx of indexes) {
			try {
				await this.client.createPayloadIndex(collection, {
					field_name: idx.field_name,
					field_schema: idx.field_schema,
				});
			} catch {
				// Index may already exist from a prior run; best effort.
			}
		}
	}

	async upsert(collection: string, points: VectorPoint[]): Promise<void> {
		if (points.length === 0) return;
		await this.client.upsert(collection, {
			wait: true,
			points: points.map((point) => ({
				id: point.id,
				vector: point.vectors,
				payload: point.payload as unknown as Record<string, unknown>,
			})),
		});
	}

	async deleteFileVersions(collection: string, repoId: string, fileId: string, keepFileHash?: string): Promise<void> {
		const filter: Schemas["Filter"] = {
			must: [
				{ key: "repoId", match: { value: repoId } },
				{ key: "fileId", match: { value: fileId } },
			],
		};
		if (keepFileHash) {
			filter.must_not = [{ key: "fileHash", match: { value: keepFileHash } }];
		}
		await this.client.delete(collection, { wait: true, filter });
	}

	async search(
		collection: string,
		dense: Float32Array,
		sparse: SparseVector,
		filters: VectorSearchFilters,
		limit: number,
	): Promise<VectorSearchResult[]> {
		const filter = createSearchFilter(filters);
		const requestLimit = Math.max(limit, 1);
		const densePromise = this.client.search(collection, {
			vector: { name: "dense", vector: Array.from(dense) },
			filter,
			limit: requestLimit,
			with_payload: true,
			params: { hnsw_ef: HNSW_EF, quantization: { rescore: true } },
		});
		const sparsePromise =
			sparse.indices.length > 0
				? this.client.search(collection, {
						vector: { name: "sparse", vector: sparse },
						filter,
						limit: requestLimit,
						with_payload: true,
						params: { hnsw_ef: HNSW_EF },
					})
				: Promise.resolve([]);
		const [denseResults, sparseResults] = await Promise.all([densePromise, sparsePromise]);

		const scores = new Map<string | number, number>();
		const payloads = new Map<string | number, StoredChunkPayload>();
		const rrfK = 60;
		for (const [rank, result] of denseResults.entries()) {
			scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (rrfK + rank + 1));
			if (result.payload) payloads.set(result.id, result.payload as unknown as StoredChunkPayload);
		}
		for (const [rank, result] of sparseResults.entries()) {
			scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (rrfK + rank + 1));
			if (result.payload && !payloads.has(result.id)) {
				payloads.set(result.id, result.payload as unknown as StoredChunkPayload);
			}
		}
		return [...scores.entries()]
			.filter(([id]) => payloads.has(id))
			.sort((left, right) => right[1] - left[1])
			.slice(0, requestLimit)
			.map(([id, score]) => ({ id, score, payload: payloads.get(id)! }));
	}
}

function createSearchFilter(filters: VectorSearchFilters): Schemas["Filter"] {
	const must: Schemas["Condition"][] = [{ key: "repoId", match: { value: filters.repoId } }];
	const mustNot: Schemas["Condition"][] = [];
	if (filters.languages && filters.languages.length > 0) {
		must.push({ key: "language", match: { any: filters.languages } });
	}
	if (!filters.includeTests) mustNot.push({ key: "isTest", match: { value: true } });
	if (!filters.includeGenerated) mustNot.push({ key: "isGenerated", match: { value: true } });
	return { must, ...(mustNot.length > 0 ? { must_not: mustNot } : {}) };
}
