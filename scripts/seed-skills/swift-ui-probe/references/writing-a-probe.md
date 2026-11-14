# 改探针的常见场景

模板是「等价结构」，不是加载真实 app。目标 app 的控件结构与模板不同时，按下表改。

## 1 焦点目标不同

`focus-delete-probe.swift` 里 `FocusTarget` 枚举列出上下文，`ProbeView` 用 `switch focus` 决定渲染哪种控件：

- 目标控件是列表 → 保留 `List` + `.onDeleteCommand`；
- 目标控件是 `NSTextView` → 参考 `BodyTextView` 的 `NSViewRepresentable`，在 `makeNSView` 里 `makeFirstResponder`；
- 目标控件是搜索框/配置页 → 保留 `TextField` + `@FocusState`。

改完必须保证：**只有目标控件挂 `.onDeleteCommand`**，其它控件保持不挂，否则探针失去判别力。

## 2 按键不同

`sendDelete()` 里构造 `NSEvent.keyEvent` 的 `keyCode` 与 `characters`：

| 按键 | keyCode | characters |
|---|---|---|
| Delete（退格） | 51 | `"\u{7F}"` |
| Forward Delete | 117 | `"\u{F728}"` |
| Enter | 36 | `"\r"` |

## 3 前台状态不同

`scene-phase-probe.swift` 验证的是 `scenePhase` 与 `NSApplication` 通知的联动。若目标 app 用的是别的机制（例如 `NSWindow.didBecomeKeyNotification`），在 `SceneProbeView` 里追加对应的 `onReceive`，并在结论里写清「哪个通知触发、`NSApp.isActive` 取值」。

## 4 证据格式

一次运行至少记录：

```
$ run-probe.sh --mode focus --context list --out evidence
已写入：evidence/ui-focus-list.txt

$ cat evidence/ui-focus-list.txt
SCENE_PHASE_INITIAL ... isActive=false
HIT_DELETE_COMMAND
RESULT focus=list deleteCommands=1 keyPresses=0 firstResponder=SwiftUIOutlineListView
```

结论写成一行一句，落到 `dev.md` 或 `evidence/README.md`：

- `list`：`deleteCommands=1`、`firstResponder=SwiftUIOutlineListView` → 命中；
- `search`：`deleteCommands=0`、`firstResponder=_SystemTextFieldFieldEditor` → 未命中，符合预期；
- `scene`：`scenePhase` 始终 `.active`，但 `didBecomeActive` 通知会触发 → 设计改用 `NSApplication` 通知。

## 5 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `firstResponder=nil` | 窗口未激活或不在图形会话 | 确认有 GUI 会话；`app.activate` 后延迟再发键 |
| 编译报 `no such module 'SwiftUI'` | 用了非 Xcode 工具链 | 用系统 `xcrun swiftc` |
| 编译时写 `~/Library` 被拒 | 没走 `run-probe.sh` | 用脚本，模块缓存已指向输出目录 |
| 探针窗口不出现 | `NSApplication` 未 `run()` 或激活策略错误 | 保留 `app.setActivationPolicy(.regular)` 与 `app.run()` |
| 结论与真实 app 不符 | 模板是等价结构 | 拿真实 app 的 AX 树/控件类型复核，必要时改 `ProbeView` |
