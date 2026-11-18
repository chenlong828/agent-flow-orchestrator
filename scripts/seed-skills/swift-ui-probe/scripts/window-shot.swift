// 对指定 macOS App 的活动窗口截图；支持按窗口坐标裁剪区域。
//
//   window-shot --list
//   window-shot --app <owner name> [--pid <pid>] [--region x,y,w,h] --out <file.png>
//
// 实现：窗口枚举用 CGWindowListCopyWindowInfo；截图调用系统 screencapture（-l 窗口 id），
// 裁剪用 CoreGraphics。全程不引入第三方依赖。
import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct Options {
    var list = false
    var app: String?
    var pid: Int?
    var region: CGRect?
    var out: String?
}

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

func parseRegion(_ raw: String) -> CGRect {
    let parts = raw.split(separator: ",").compactMap { Double($0) }
    guard parts.count == 4 else { fail(2, "--region 需要 x,y,w,h（窗口坐标，单位 pt）") }
    return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
}

func parse(_ args: [String]) -> Options {
    var options = Options()
    var index = 0
    while index < args.count {
        switch args[index] {
        case "--list": options.list = true
        case "--app": index += 1; options.app = args[index]
        case "--pid": index += 1; options.pid = Int(args[index])
        case "--region": index += 1; options.region = parseRegion(args[index])
        case "--out": index += 1; options.out = args[index]
        default: fail(2, "未知参数 \(args[index])")
        }
        index += 1
    }
    return options
}

func boundsOf(_ window: [String: Any]) -> CGRect {
    guard let raw = window[kCGWindowBounds as String] else { return .zero }
    return CGRect(dictionaryRepresentation: raw as! CFDictionary) ?? .zero
}

func describe(_ window: [String: Any]) -> String {
    let owner = window[kCGWindowOwnerName as String] as? String ?? "?"
    let pid = window[kCGWindowOwnerPID as String] as? Int ?? -1
    let id = window[kCGWindowNumber as String] as? Int ?? -1
    let title = window[kCGWindowName as String] as? String ?? ""
    let bounds = boundsOf(window)
    let rect = "\(Int(bounds.origin.x)),\(Int(bounds.origin.y)) \(Int(bounds.width))x\(Int(bounds.height))"
    return "id=\(id) pid=\(pid) owner=\(owner) title=\(title) bounds=\(rect)"
}

func onScreenWindows() -> [[String: Any]] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    return (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
}

/// 用系统 screencapture 截指定窗口，返回 PNG 的像素数据。
func captureWindow(id: Int) -> Data? {
    let temp = FileManager.default.temporaryDirectory
        .appendingPathComponent("window-shot-\(UUID().uuidString).png")
    defer { try? FileManager.default.removeItem(at: temp) }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-x", "-o", "-l", String(id), temp.path]
    do { try process.run() } catch { return nil }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { return nil }
    return try? Data(contentsOf: temp)
}

let options = parse(CommandLine.arguments.dropFirst().map { $0 })

let windows = onScreenWindows().filter { window in
    let bounds = boundsOf(window)
    let layer = window[kCGWindowLayer as String] as? Int ?? -1
    return layer == 0 && bounds.width > 0 && bounds.height > 0
}

if options.list {
    for window in windows { print(describe(window)) }
    exit(0)
}

let candidates = windows.filter { window in
    if let wanted = options.pid { return (window[kCGWindowOwnerPID as String] as? Int) == wanted }
    guard let name = options.app else { return false }
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    return owner.compare(name, options: .caseInsensitive) == .orderedSame
}

guard let target = candidates.first else {
    fail(4, "找不到窗口：--app/--pid 指定的 App 没有 on-screen 窗口；先用 --list 查看")
}
guard let out = options.out else { fail(2, "缺少 --out <file.png>") }
if !CGPreflightScreenCaptureAccess() {
    fail(3, "没有屏幕录制权限：系统设置 → 隐私与安全性 → 屏幕录制，给宿主进程授权后重试")
}

let windowID = target[kCGWindowNumber as String] as? Int ?? -1
guard let data = captureWindow(id: windowID),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail(5, "窗口截图失败（window id \(windowID)）；确认窗口未最小化、未被系统保护")
}

let bounds = boundsOf(target)
let scale = CGFloat(image.width) / max(bounds.width, 1)
var final = image
if let region = options.region {
    let scaled = CGRect(
        x: region.origin.x * scale, y: region.origin.y * scale,
        width: region.width * scale, height: region.height * scale
    )
    let full = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    let clamped = scaled.intersection(full)
    guard !clamped.isEmpty, let cropped = image.cropping(to: clamped) else {
        fail(5, "--region 超出窗口范围：窗口 \(Int(bounds.width))x\(Int(bounds.height)) pt")
    }
    final = cropped
}

let url = URL(fileURLWithPath: out)
try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fail(6, "无法写入 \(out)")
}
CGImageDestinationAddImage(destination, final, nil)
guard CGImageDestinationFinalize(destination) else { fail(6, "写 PNG 失败：\(out)") }

print(describe(target))
print("image=\(final.width)x\(final.height) scale=\(String(format: "%.2f", scale)) out=\(out)")
