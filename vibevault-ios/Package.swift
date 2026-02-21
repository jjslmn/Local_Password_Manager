// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VibeVault",
    platforms: [.iOS(.v16)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
        .package(url: "https://github.com/nicklama/swift-argon2.git", from: "1.0.0"),
    ],
    targets: [
        .executableTarget(
            name: "VibeVault",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Argon2Swift", package: "swift-argon2"),
            ],
            path: "VibeVault"
        ),
    ]
)
