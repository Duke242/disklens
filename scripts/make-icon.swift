// Draws the 1024px app icon (a little treemap). macOS only; run: swift scripts/make-icon.swift app-icon.png
// Then: npx tauri icon app-icon.png
import AppKit

let px = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

// Background squircle
let bg = NSRect(x: 100, y: 100, width: 824, height: 824)
NSGradient(colors: [color(0x1F2333), color(0x2B3048)])!.draw(in: NSBezierPath(roundedRect: bg, xRadius: 185, yRadius: 185), angle: -90)

// Treemap tiles, in the app's category colors (y is flipped: origin bottom-left)
let tiles: [(NSRect, UInt32)] = [
    (NSRect(x: 180, y: 180, width: 380, height: 664), 0x6E5BE8), // code
    (NSRect(x: 580, y: 524, width: 264, height: 320), 0xE0508C), // ai
    (NSRect(x: 580, y: 344, width: 264, height: 160), 0x4D7BE3), // caches
    (NSRect(x: 580, y: 180, width: 124, height: 144), 0xF07B3F), // documents
    (NSRect(x: 720, y: 180, width: 124, height: 144), 0x2E9E5B), // safe
]
for (r, c) in tiles {
    color(c).setFill()
    NSBezierPath(roundedRect: r, xRadius: 34, yRadius: 34).fill()
}
// Hatching on the "safe to remove" tile, like the app
NSGraphicsContext.saveGraphicsState()
NSBezierPath(roundedRect: tiles[4].0, xRadius: 34, yRadius: 34).addClip()
NSColor.white.withAlphaComponent(0.45).setStroke()
var x: CGFloat = tiles[4].0.minX - 160
while x < tiles[4].0.maxX {
    let p = NSBezierPath(); p.lineWidth = 9
    p.move(to: NSPoint(x: x, y: tiles[4].0.minY)); p.line(to: NSPoint(x: x + 160, y: tiles[4].0.maxY)); p.stroke()
    x += 30
}
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
