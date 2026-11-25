// Prints the text on a screenshot, one line per piece of text (macOS Vision). Used by test/device/ios.mjs on the
// GitHub Mac to check what the iPhone simulator shows and to explain failures in the log.
//   swiftc -O test/device/ocr.swift -o /tmp/ocr && /tmp/ocr screenshot.png
import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("usage: ocr <image.png>\n".data(using: .utf8)!)
    exit(2)
}

func recognize(_ languages: [String]) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = languages
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}

do {
    // Arabic needs a recent Vision; fall back to English only if it isn't supported here.
    let lines = (try? recognize(["ar-SA", "en-US"])) ?? (try recognize(["en-US"]))
    for line in lines { print(line) }
} catch {
    FileHandle.standardError.write("ocr failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
