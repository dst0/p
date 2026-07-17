import { createHash } from "node:crypto";
import fs from "node:fs";

/**
 * BM25 vocabulary with document-frequency tracking for sparse vector encoding.
 *
 * Maintains a global vocabulary across all indexed chunks. Each token gets
 * a unique index, and document frequencies are tracked for IDF computation.
 */
export class BM25Vocabulary {
	tokenToIdx = new Map<string, number>();
	docFreq = new Map<string, number>();
	nextIdx = 0;
	totalDocs = 0;
	avgDl = 0;
	private totalTokens = 0;

	/**
	 * Register one document's unique tokens. Call once per chunk before encoding.
	 */
	register(text: string): void {
		const tokens = this.tokenize(text);
		const uniqueTokens = new Set(tokens);

		for (const t of uniqueTokens) {
			if (!this.tokenToIdx.has(t)) {
				this.tokenToIdx.set(t, this.nextIdx);
				this.docFreq.set(t, 0);
				this.nextIdx++;
			}
			this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
		}

		this.totalDocs++;
		this.totalTokens += tokens.length;
		this.avgDl = this.totalTokens / this.totalDocs;
	}

	/**
	 * Finalize average document length after all docs registered.
	 */
	finalize(): void {
		if (this.totalDocs > 0) {
			this.avgDl = this.totalTokens / this.totalDocs;
		}
	}

	/**
	 * Encode text to Qdrant sparse vector format.
	 *
	 * @returns Object with `indices` and `values` arrays for Qdrant sparse vector.
	 */
	encode(text: string, k1 = 1.5, b = 0.75): { indices: number[]; values: number[] } {
		const tokens = this.tokenize(text);

		if (tokens.length === 0) {
			return { indices: [], values: [] };
		}

		// Count token frequencies
		const counts = new Map<string, number>();
		for (const t of tokens) {
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}

		const nTokens = tokens.length;
		const N = Math.max(this.totalDocs, 1);
		const avgdl = Math.max(this.avgDl, 1.0);

		const indices: number[] = [];
		const values: number[] = [];

		for (const [token, count] of counts) {
			const idx = this.tokenToIdx.get(token);
			if (idx === undefined) continue;

			const n = this.docFreq.get(token) ?? 1;

			// IDF: log((N - n + 0.5) / (n + 0.5) + 1)
			const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1.0);

			// TF with BM25 saturation
			const tfNum = count * (k1 + 1);
			const tfDen = count + k1 * (1.0 - b + (b * nTokens) / avgdl);
			const tf = tfNum / tfDen;

			const score = idf * tf;

			indices.push(idx);
			values.push(score);
		}

		return { indices, values };
	}

	/**
	 * Save vocabulary to a JSON file.
	 */
	save(path: string): void {
		const dir = path.slice(0, path.lastIndexOf("/"));
		if (dir) {
			fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		}

		const data = {
			tokenToIdx: Object.fromEntries(this.tokenToIdx),
			docFreq: Object.fromEntries(this.docFreq),
			nextIdx: this.nextIdx,
			totalDocs: this.totalDocs,
			avgDl: this.avgDl,
			totalTokens: this.totalTokens,
		};

		const temporaryPath = `${path}.${process.pid}.tmp`;
		fs.writeFileSync(temporaryPath, JSON.stringify(data), { encoding: "utf-8", mode: 0o600 });
		fs.renameSync(temporaryPath, path);
	}

	/**
	 * Load vocabulary from a JSON file.
	 */
	static load(path: string): BM25Vocabulary {
		const data = JSON.parse(fs.readFileSync(path, "utf-8"));

		const v = new BM25Vocabulary();
		v.tokenToIdx = new Map(Object.entries(data.tokenToIdx).map(([k, val]) => [k, Number(val)]));
		v.docFreq = new Map(Object.entries(data.docFreq).map(([k, val]) => [k, Number(val)]));
		v.nextIdx = data.nextIdx;
		v.totalDocs = data.totalDocs;
		v.avgDl = data.avgDl;
		v.totalTokens = data.totalTokens ?? data.avgDl * data.totalDocs;

		return v;
	}

	/**
	 * Tokenize text into code-friendly tokens.
	 * Identifiers (alphanumeric + underscore, unicode letters) and numbers.
	 */
	private tokenize(text: string): string[] {
		const expanded = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
		const rawTokens = expanded.match(/[a-zA-Z_\u00C0-\u024F][a-zA-Z0-9_\u00C0-\u024F]*|\d+/g) ?? [];
		return rawTokens.flatMap((token) => {
			const normalized = token.toLowerCase();
			const parts = normalized.split("_").filter(Boolean);
			return parts.length > 1 ? [normalized, ...parts] : [normalized];
		});
	}
}

/**
 * Compute a stable point ID from file hash and line number.
 */
export function computePointId(fileHash: string, startLine: number): number {
	const hash = createHash("md5").update(`${fileHash}:${startLine}`).digest("hex");
	return parseInt(hash.slice(0, 8), 16);
}
