import AppKit
import SwiftUI

// 焦点/按键探针：五种焦点上下文各发一次 Delete（keyCode 51）。
// 只有列表带 .onDeleteCommand；其它上下文必须 deleteCommands=0。
// 每个结果打印 firstResponder 类型，证明按键落在目标控件上。
//
// 用法：focus-delete-probe --focus list|search|body|compose|settings [--title NAME] [--log PATH]

final class HitBox: ObservableObject {
    @Published var deleteCommands = 0
    @Published var keyPresses = 0
}

let box = HitBox()

enum FocusTarget: String {
    case list, search, body, compose, settings
}

func argValue(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name),
          index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}

let mode = FocusTarget(rawValue: argValue("--focus") ?? "list") ?? .list
let windowTitle = argValue("--title") ?? "probe"

if let logPath = argValue("--log") {
    freopen(logPath, "w", stdout)
    setvbuf(stdout, nil, _IONBF, 0)
}

struct BodyTextView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSScrollView {
        let textView = NSTextView()
        textView.string = "正文焦点探针"
        textView.isEditable = true
        textView.isSelectable = true
        textView.font = .systemFont(ofSize: 13)
        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        DispatchQueue.main.async {
            scroll.window?.makeFirstResponder(textView)
        }
        return scroll
    }

    func updateNSView(_ nsView: NSScrollView, context: Context) {}
}

struct ProbeView: View {
    let focus: FocusTarget
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var listFocused: Bool
    @FocusState private var searchFocused: Bool
    @FocusState private var settingsFocused: Bool
    @FocusState private var composeFocused: Bool
    @State private var selection: Int? = 1
    @State private var query = ""
    @State private var showCompose = false

    var body: some View {
        VStack(spacing: 0) {
            TextField("搜索", text: $query)
                .focused($searchFocused)
                .padding(8)
            switch focus {
            case .settings:
                VStack(alignment: .leading, spacing: 8) {
                    Text("配置页")
                    TextField("服务器地址", text: .constant("mail.example.test"))
                        .focused($settingsFocused)
                }
                .padding()
            case .body:
                BodyTextView()
                    .frame(minHeight: 120)
            default:
                List(selection: $selection) {
                    Text("第一行").tag(1)
                    Text("第二行").tag(2)
                }
                .focusable()
                .focused($listFocused)
                .onDeleteCommand {
                    box.deleteCommands += 1
                    print("HIT_DELETE_COMMAND")
                }
                .onKeyPress(.delete) {
                    guard listFocused else { return .ignored }
                    box.keyPresses += 1
                    print("HIT_KEY_PRESS")
                    return .handled
                }
            }
        }
        .frame(minWidth: 420, minHeight: 240)
        .onAppear {
            switch focus {
            case .search: searchFocused = true
            case .settings: settingsFocused = true
            case .list: listFocused = true
            case .compose:
                showCompose = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { composeFocused = true }
            case .body: break
            }
        }
        .sheet(isPresented: $showCompose) {
            VStack(alignment: .leading, spacing: 8) {
                Text("撰写页")
                TextEditor(text: .constant("撰写正文"))
                    .focused($composeFocused)
                    .frame(minWidth: 320, minHeight: 160)
            }
            .padding()
            .onAppear { composeFocused = true }
        }
        .onAppear {
            print("SCENE_PHASE_INITIAL \(scenePhase) isActive=\(NSApp.isActive)")
        }
        .onChange(of: scenePhase) { _, phase in
            print("SCENE_PHASE \(phase) isActive=\(NSApp.isActive)")
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            print("NOTIFICATION didBecomeActive isActive=\(NSApp.isActive)")
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
            print("NOTIFICATION willResignActive isActive=\(NSApp.isActive)")
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let view = ProbeView(focus: mode)
let hosting = NSHostingView(rootView: view)
let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 460, height: 340),
    styleMask: [.titled, .closable],
    backing: .buffered,
    defer: false
)
window.title = windowTitle
window.contentView = hosting
window.makeKeyAndOrderFront(nil)
window.makeKey()
app.activate(ignoringOtherApps: true)

func sendDelete() {
    let target = window.attachedSheet ?? window
    guard let key = NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: target.windowNumber,
        context: nil,
        characters: "\u{7F}",
        charactersIgnoringModifiers: "\u{7F}",
        isARepeat: false,
        keyCode: 51
    ) else {
        print("NO_EVENT")
        return
    }
    target.sendEvent(key)
}

DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
    sendDelete()
}
DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
    let responder = (window.attachedSheet ?? window).firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
    print("RESULT focus=\(mode.rawValue) deleteCommands=\(box.deleteCommands) keyPresses=\(box.keyPresses) firstResponder=\(responder)")
    exit(0)
}

app.run()
