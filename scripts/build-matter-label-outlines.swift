// Export the specific scene captions as vector artwork, not an embeddable font.
// macOS-only authoring step; the GLB generator and browser use the saved outlines.
import Foundation
import CoreText
import CoreGraphics

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: swift build-matter-label-outlines.swift <captions.json> <outlines.json>")
}
let captions = try JSONDecoder().decode([String].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let fontName = "STHeitiSC-Medium"
let font = CTFontCreateWithName(fontName as CFString, 1000, nil)
guard CTFontCopyPostScriptName(font) as String == fontName else {
    fatalError("Required authoring font is unavailable: \(fontName)")
}
var artwork: [String: Any] = [:]
for caption in captions {
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: caption, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]))
    var commands: [[Any]] = []
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var positions = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
        for i in 0..<count {
            guard glyphs[i] != 0 else { fatalError("Missing glyph in caption: \(caption)") }
            var transform = CGAffineTransform(translationX: positions[i].x, y: positions[i].y)
            // Space glyphs have no outline; every visible glyph must yield a path.
            if let path = CTFontCreatePathForGlyph(font, glyphs[i], &transform) {
                path.applyWithBlock { pointer in
                    let e = pointer.pointee
                    func p(_ i: Int) -> [Any] { [Double(e.points[i].x), Double(e.points[i].y)] }
                    switch e.type {
                    case .moveToPoint: commands.append(["m"] + p(0))
                    case .addLineToPoint: commands.append(["l"] + p(0))
                    case .addQuadCurveToPoint: commands.append(["q"] + p(0) + p(1))
                    case .addCurveToPoint: commands.append(["c"] + p(0) + p(1) + p(2))
                    case .closeSubpath: commands.append(["z"])
                    @unknown default: fatalError("Unsupported outline element")
                    }
                }
            }
        }
    }
    guard !commands.isEmpty else { fatalError("Caption has no visible geometry: \(caption)") }
    artwork[caption] = commands
}
let document: [String: Any] = ["version": 1, "unitsPerEm": 1000, "sourceFont": fontName, "captions": artwork]
let data = try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
print("Exported \(captions.count) Chinese caption outlines.")
