import Foundation

struct EncodeRequest: Codable {
    let id: String
    let action: String
    let texts: [String]?
    let bucket: Int?
    let normalize: Bool?
}

struct EncodeResponse: Codable {
    let id: String
    let status: String
    let executionDevice: String
    let embeddings: [[Float]]?
    let error: String?
}

struct HealthResponse: Codable {
    let status: String
    let requestedBackend: String
    let selectedBackend: String
    let executionDevice: String
    let gpuAllowed: Bool
    let fallbackOccurred: Bool
}
