import Foundation

struct RepoProgress: Decodable {
    let phase: String?
    let percent: Double?
    let processedFiles: Int?
    let totalFiles: Int?
    let processedChunks: Int?
    let totalChunks: Int?
}

struct RepoStatusEntry: Decodable {
    let path: String
    let state: String
    let indexedFiles: Int
    let indexedChunks: Int
    let updatedAt: String
    let progress: RepoProgress?
    let lastError: String?
}

struct IndexingStatusData: Decodable {
    let pid: Int
    let running: Bool
    let startedAt: String
    let updatedAt: String
    let repos: [RepoStatusEntry]
}

struct CodeRagConfig: Decodable {
    let embeddingDevice: String?
    let searchMode: String?
    let enableTray: Bool?
}
