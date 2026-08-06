import Foundation

let model = ANEEmbeddingModel()
let encoder = JSONEncoder()
let decoder = JSONDecoder()

// Standard I/O line-delimited JSON IPC loop
while let line = readLine() {
    guard let data = line.data(using: .utf8) else { continue }
    do {
        let req = try decoder.decode(EncodeRequest.self, from: data)
        if req.action == "health" {
            let res = HealthResponse(
                status: "ready",
                requestedBackend: "apple-ane",
                selectedBackend: "apple-ane",
                executionDevice: "Apple Neural Engine",
                gpuAllowed: false,
                fallbackOccurred: false
            )
            let outData = try encoder.encode(res)
            if let outStr = String(data: outData, encoding: .utf8) {
                print(outStr)
                fflush(stdout)
            }
        } else if req.action == "encode" {
            let texts = req.texts ?? []
            let bucket = model.selectBucket(for: req.bucket ?? 512)
            let normalize = req.normalize ?? true
            let embeddings = try model.encode(texts: texts, bucket: bucket, normalize: normalize)
            let res = EncodeResponse(
                id: req.id,
                status: "ok",
                executionDevice: "Apple Neural Engine",
                embeddings: embeddings,
                error: nil
            )
            let outData = try encoder.encode(res)
            if let outStr = String(data: outData, encoding: .utf8) {
                print(outStr)
                fflush(stdout)
            }
        }
    } catch {
        let res = EncodeResponse(
            id: "err",
            status: "error",
            executionDevice: "Apple Neural Engine",
            embeddings: nil,
            error: error.localizedDescription
        )
        if let outData = try? encoder.encode(res), let outStr = String(data: outData, encoding: .utf8) {
            print(outStr)
            fflush(stdout)
        }
    }
}
