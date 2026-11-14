---
name: "swift-ui-probe"
description: "Swift 界面探针：在 macOS 图形会话里验证单测覆盖不到的 AppKit/SwiftUI 行为——键盘焦点归属、.onDeleteCommand 是否只在指定控件命中、scenePhase 与 NSApplication 前台通知、按键是否被目标控件接收；产出可复核的 evidence 文本。触发：焦点、按键、Delete、scenePhase、前台状态、界面行为验证"
version: "v1.0"
---

# 用途

界面行为验证：单元测试跑在无窗口环境里，验不了「键盘事件落到哪个控件」「只有列表响应 Delete」「应用失活/回焦时前台状态怎么变」。本技能用两个**可编译、可复跑**的小探针补这块证据。

产物是**证据文本**，不是新的产品代码；探针源码与日志一起落 task-space 的 `evidence/`。

## 何时用

- 需要证明「某快捷键/按键只在目标控件生效，其它焦点上下文不响应」；
- 需要确认 `scenePhase`、`NSApplication.willResignActiveNotification` / `didBecomeActiveNotification` 的真实触发顺序与取值；
- 需要记录 `firstResponder` 类型，证明按键确实落在目标控件上，而不是“没聚焦所以没命中”；
- 验收要求「真机/真实窗口」证据，而单测只能证明模型层逻辑。

## 何时不用

- 纯逻辑、数据转换、契约映射 → 用单元测试；
- 真实网关读写、协议抓包 → **不在本技能范围**（这类探针会改真实邮箱，需单独授权与独立脚本）；
- 需要加载被测 app 的全部真实视图做端到端点击 → 现阶段用一次性的 AX 驱动，不要套本模板。

## 两个探针

| 模式 | 源文件 | 验证什么 | 输出 |
|---|---|---|---|
| `focus` | `scripts/focus-delete-probe.swift` | 5 个焦点上下文（list / search / body / compose / settings）各发一次 Delete（keyCode 51），只有列表应触发 `.onDeleteCommand` | `ui-focus-<context>.txt` |
| `scene` | `scripts/scene-phase-probe.swift` | 真实 `WindowGroup` 窗口在 activate → deactivate → reactivate 过程中的 `scenePhase` 与 `NSApplication` 通知 | `scene-phase.txt` |

## 步骤

1. **确定目标上下文**：要验哪个控件收键盘、哪个不收；对应 `list/search/body/compose/settings`。
2. **改模板**（只在必要时）：窗口标题用 `--title`；若目标 app 的控件结构与模板不同，按 `references/writing-a-probe.md` 调整焦点目标与日志字段。
3. **编译并运行**：

   ```bash
   bash <skill>/scripts/run-probe.sh --mode focus --context list  --out <task-space>/evidence
   bash <skill>/scripts/run-probe.sh --mode focus --context search --out <task-space>/evidence
   bash <skill>/scripts/run-probe.sh --mode scene --out <task-space>/evidence
   ```

   脚本会把 `swiftc` 的模块缓存放进输出目录（避免写 `~/Library` 被沙箱拒绝），编译产物也放该目录。
4. **读结果**：每个上下文必须有 `RESULT ... firstResponder=<类型>`；列表的 `deleteCommands` 应为 1，其余为 0。
5. **落结论**：在 `dev.md`（或 `evidence/` 下的说明文件）写「上下文 → 是否命中 → firstResponder 类型 → 结论」；结论要与实现/设计改动对应。

## 判据

- `firstResponder` 必须打印具体类型（如 `SwiftUIOutlineListView`、`NSTextView`、`PlatformTextView`）；`nil` 说明没有真正聚焦，结论不成立。
- 只有目标控件允许 `deleteCommands=1`；其它上下文出现 1 即视为行为越界。
- `scene` 结论必须同时记录 `NSApp.isActive` 与通知；只记 `scenePhase` 不足以说明前台状态。
- 探针输出与源码必须一起落 `evidence/`，只留结论文字不可复核。

## 坑

- **会抢焦点**：探针需要激活窗口才能收键盘事件；一次只跑一个模式，单次约 2–6 秒后自动退出。无人值守时段跑会打断用户操作。
- **需要图形会话**：SSH / 无窗口环境下 `NSApplication.activate` 不生效，`firstResponder` 可能为 `nil`。
- **`scenePhase` 在 macOS 上不随失活变化**：实测 `@Environment(\.scenePhase)` 始终是 `.active`；需要前台状态时监听 `NSApplication` 通知（这本身就是常见设计修正）。
- **编译缓存**：直接用 `swiftc` 会尝试写 `~/Library`；用 `run-probe.sh`，它把 `CLANG_MODULE_CACHE_PATH` 与 `-module-cache-path` 指到输出目录。
- **不要打印真实数据**：窗口标题、日志里不要出现真实邮箱、账号、凭据。

## 边界

- 仅 macOS + SwiftUI/AppKit；Linux/Windows 不适用。
- 探针是“等价结构”而非加载真实 app；结论要回到目标 app 的实际控件结构上复核。
- 不包含网关写命令、AX 全树 dump（后者另行扩展）。
