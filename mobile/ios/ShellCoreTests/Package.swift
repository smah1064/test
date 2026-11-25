// swift-tools-version: 5.9
// Tests for the iPhone app's link decisions (App/App/Shell/ShellCore.swift, linked here). Run on a Mac:
//   cd mobile/ios/ShellCoreTests && swift test
import PackageDescription

let package = Package(
    name: "ShellCore",
    platforms: [.macOS(.v12), .iOS(.v15)],
    targets: [
        .target(name: "ShellCore", path: "Sources/ShellCore"),
        .testTarget(name: "ShellCoreTests", dependencies: ["ShellCore"], path: "Tests/ShellCoreTests")
    ]
)
