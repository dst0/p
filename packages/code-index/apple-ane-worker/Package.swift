// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AppleANEWorker",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "apple-ane-worker", targets: ["AppleANEWorker"])
    ],
    targets: [
        .executableTarget(
            name: "AppleANEWorker",
            dependencies: [],
            path: "Sources"
        )
    ]
)
