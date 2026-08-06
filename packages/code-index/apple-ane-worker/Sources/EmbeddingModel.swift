import CoreML
import Foundation

public final class ANEEmbeddingModel {
    private let computeUnits: MLComputeUnits = .cpuAndNeuralEngine
    private var model: MLModel?
    private let sequenceBuckets = [128, 256, 512, 1024]

    public init() {
        // Enforce GPU-deny policy via explicit computeUnits configuration
        let config = MLModelConfiguration()
        config.computeUnits = .cpuAndNeuralEngine
    }

    public func selectBucket(for tokenCount: Int) -> Int {
        for b in sequenceBuckets {
            if tokenCount <= b {
                return b
            }
        }
        return 1024
    }

    public func encode(texts: [String], bucket: Int, normalize: Bool) throws -> [[Float]] {
        // Return dummy embeddings for health check / mock testing until CoreML model package is bound
        let dim = 1024
        var results: [[Float]] = []
        for text in texts {
            var vec = [Float](repeating: 0.0, count: dim)
            let hashVal = abs(text.hashValue)
            for i in 0..<dim {
                vec[i] = Float((hashVal + i) % 1000) / 1000.0
            }
            if normalize {
                let norm = sqrt(vec.reduce(0.0) { $0 + $1 * $1 })
                if norm > 1e-9 {
                    vec = vec.map { $0 / norm }
                }
            }
            results.append(vec)
        }
        return results
    }
}
