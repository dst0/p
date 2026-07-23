import { QdrantClient as QdrantClientRaw } from "@qdrant/js-client-rest";

import type { ChunkPayload, IndexConfig, IndexStatus } from "./types.ts";

export class QdrantClient {
	private client: QdrantClientRaw;
	private config: IndexConfig;

	constructor(config: IndexConfig) {
		this.client = new QdrantClientRaw({ url: config.qdrantUrl });
		this.config = config;
	}

	async createCollection(): Promise<void> {
		try {
			await this.client.deleteCollection(this.config.collection);
		} catch {
			// Collection may not exist, that's fine
		}

		await this.client.createCollection(this.config.collection, {
			vectors: {
				size: this.config.denseDim,
				distance: "Cosine",
			},
			sparse_vectors: {
				sparse: {},
			},
			optimizers_config: {
				default_segment_number: 4,
				indexing_threshold: 10000,
			},
		});

		console.log(`  ✅ Collection '${this.config.collection}' created (dense=${this.config.denseDim}, sparse=BM25)`);
	}

	async upsertBatch(
		points: Array<{
			id: number;
			vectors: { dense: number[]; sparse: { indices: number[]; values: number[] } };
			payload: ChunkPayload;
		}>,
	): Promise<void> {
		const pointsData = points.map((p) => ({
			id: p.id,
			vector: {
				dense: p.vectors.dense,
				sparse: p.vectors.sparse,
			},
			payload: p.payload as unknown as Record<string, unknown>,
		}));

		await this.client.upsert(this.config.collection, {
			wait: true,
			points: pointsData,
		});
	}

	async getStatus(): Promise<IndexStatus> {
		const info = await this.client.getCollection(this.config.collection);

		const vectorsConfig = info.config?.params?.vectors;
		let vectorDim: number | string = "?";
		if (typeof vectorsConfig === "object" && vectorsConfig !== null) {
			const vc = vectorsConfig as Record<string, unknown>;
			if (typeof vc.size === "number") {
				vectorDim = vc.size;
			} else if (typeof vc.dense === "object" && vc.dense !== null) {
				vectorDim = (vc.dense as { size?: number }).size ?? "?";
			}
		}

		return {
			points: info.points_count ?? 0,
			indexedVectors: info.indexed_vectors_count ?? 0,
			segments: info.segments_count ?? 0,
			vectorDim,
			sparseVectors: !!info.config?.params?.sparse_vectors,
		};
	}

	async deleteRepo(repo: string): Promise<void> {
		await this.client.delete(this.config.collection, {
			wait: true,
			filter: {
				must: [
					{
						key: "repo",
						match: { value: repo },
					},
				],
			},
		});

		console.log(`Deleted repo '${repo}' from index`);
	}

	async search(
		denseVec: Float32Array | number[],
		sparseVec: { indices: number[]; values: number[] },
		limit: number = 10,
	): Promise<Array<{ id: string | number; score: number; payload: ChunkPayload }>> {
		const denseArr: number[] = denseVec instanceof Float32Array ? Array.from(denseVec) : denseVec;
		const [denseResults, sparseResults] = await Promise.all([
			this.client.search(this.config.collection, {
				vector: { name: "dense", vector: denseArr },
				limit,
				with_payload: true,
			}),
			this.client.search(this.config.collection, {
				vector: { name: "sparse", vector: sparseVec },
				limit,
				with_payload: true,
			}),
		]);

		const scores = new Map<string | number, number>();
		const payloads = new Map<string | number, Record<string, unknown> | null | undefined>();
		const k = 15;

		denseResults.forEach((r, i) => {
			scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i + 1));
			payloads.set(r.id, r.payload);
		});

		sparseResults.forEach((r, i) => {
			scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + i + 1));
			if (!payloads.has(r.id)) payloads.set(r.id, r.payload);
		});

		return Array.from(scores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit)
			.map(([id, score]) => ({
				id,
				score,
				payload: (payloads.get(id) ?? {}) as unknown as ChunkPayload,
			}));
	}

	async searchDense(
		denseVec: Float32Array | number[],
		limit: number = 10,
	): Promise<Array<{ id: string | number; score: number; payload: ChunkPayload }>> {
		const denseArr: number[] = denseVec instanceof Float32Array ? Array.from(denseVec) : denseVec;
		const results = await this.client.search(this.config.collection, {
			vector: { name: "dense", vector: denseArr },
			limit,
			with_payload: true,
		});

		return results.map((r) => ({
			id: r.id,
			score: r.score,
			payload: (r.payload ?? {}) as unknown as ChunkPayload,
		}));
	}
}
