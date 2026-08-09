"""Fixed real-model corpus used for embedding startup and CLI benchmarks."""

BENCHMARK_CORPUS = [
    "def calculate_vector_similarity(query_vector, document_vector): return sum(a*b for a,b in zip(query_vector, document_vector))",
    "export interface CodeIndexManifest { repository: string; compatibilityGroup: string; vectorsCount: number; }",
    "pub struct VectorStore { points: Vec<Point>, dimension: usize } impl VectorStore { pub fn search(&self) {} }",
    "import Foundation\npublic final class EmbeddingModel { public func encode() -> [[Float]] {} }",
    "# Background daemon worker loop handling filesystem events and indexing queue updates",
    "SELECT * FROM embeddings ORDER BY cosine_distance(vector, :query) ASC LIMIT 10;",
    "class EmbeddingServerManager extends SubprocessLifecycleManager { async ensureReady() {} }",
    "const batchSize = Math.max(1, this.options.batchSize ?? 8);",
]

