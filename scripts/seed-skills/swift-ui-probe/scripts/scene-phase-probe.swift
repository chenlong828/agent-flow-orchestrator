import AppKit
import SwiftUI

// scenePhase 探针：真实 SwiftUI WindowGroup 窗口，activate → deactivate → reactivate，
// 记录 scenePhase 变化与 NSApplication 前台通知。
// 用法：scene-phase-probe [--title NAME]
// 编译需要 -parse-as-library（有 @main）。

func argValue(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name),
          index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}

let probeTitle = argValue("--title") ?? "probe"

func log(_ line: String) {
    let stamped = "[\(String(format: "%.2f", ProcessInfo.processInfo.systemUptime))] \(line)"
    print(stamped)
}

@main
struct SceneProbeApp: App {
    var body: some Scene {
        WindowGroup(probeTitle) {
            SceneProbeView()
                .frame(minWidth: 380, minHeight: 220)
        }
    }
}

struct SceneProbeView: View {
    @Environment(\.scenePhase) private var phase
    @State private var scheduled = false

    var body: some View {
        Text("scenePhase probe")
            .padding(40)
            .onAppear {
                log("APPEAR scenePhase=\(phase) isActive=\(NSApp.isActive)")
                guard !scheduled else { return }
                scheduled = true
                schedule()
            }
            .onChange(of: phase) { _, newPhase in
                log("CHANGE scenePhase=\(newPhase) isActive=\(NSApp.isActive)")
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                log("NOTIFICATION didBecomeActive isActive=\(NSApp.isActive)")
            }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
                log("NOTIFICATION willResignActive isActive=\(NSApp.isActive)")
            }
    }

    private func schedule() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            log("STATE t1 isActive=\(NSApp.isActive) key=\(NSApp.keyWindow != nil)")
            log("ACTION activate")
            NSApp.activate(ignoringOtherApps: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            log("STATE t2 isActive=\(NSApp.isActive)")
            log("ACTION deactivate")
            NSApp.deactivate()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
            log("STATE t3 isActive=\(NSApp.isActive)")
            log("ACTION reactivate")
            NSApp.activate(ignoringOtherApps: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.5) {
            log("DONE isActive=\(NSApp.isActive)")
            exit(0)
        }
    }
}
