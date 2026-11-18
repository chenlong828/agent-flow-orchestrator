---
name: "swift-ui-probe"
description: "Swift/macOS 界面探针：对指定 App 的活动窗口截图（可按区域），配合 harness 的 read_image 迭代观察任意组件区域（工具栏/列表/正文/侧栏/弹窗），用于 GUI 渲染、布局、文案的视觉验证。触发：界面验收、视觉回归、截图取证、看真实 macOS 窗口；Web 程序不适用"
version: "v1.2"
---

# 用途

macOS GUI 程序最终交付的是**屏幕上的样子**。本技能提供一条最小命令：定位指定 App 的活动窗口 → 截图（可只截一块区域）→ PNG 落盘，模型用 harness 的 `read_image` 直接读图判断。

观察单位是**界面的任意组件区域**（工具栏、列表、正文、侧栏、弹窗、菜单、状态栏……），不限于某一种控件。典型的迭代方式：先截整窗 → 读图定位组件 → 按坐标截区域 → 再读图看细节。

它是 L3 视觉证据的**标准工具**，不是每次任务临时写探针。

## 何时用

- 需要判断界面渲染是否正确：布局、文案、颜色、白底/深色、破版、对齐；
- 验收要求「真实窗口/真实 App」的视觉证据；
- 视觉回归：同一区域改动前后各截一张对比。

## 何时不用

- 纯逻辑、数据转换、契约映射 → 单元测试（L1）；
- 需要证明「点击后发生了什么」「键盘落在哪个控件」 → 交互驱动探针或 UI 测试；
- Web 程序（浏览器渲染）→ 用无头浏览器导出截图，不在本技能范围；
- 本技能只面向 macOS 本机开发环境，不做远程/无显示器场景。

## 通用观察流程：整窗 → 读图 → 定位 → 区域 → 再读图

1. **截整窗**，拿到窗口尺寸与整体布局：

   ```bash
   "$B/window-shot" --app uumail --out <task-space>/evidence/window.png
   # image=3024x1768 scale=2.00（窗口 1512x884 pt）
   ```

2. **读图定位**（harness 的 `read_image`）：在预览图上找到目标组件的像素范围。注意预览可能被等比缩小，**以图里报的预览尺寸为基准**换算。

3. **换算到窗口坐标**（工具参数 `--region` 用窗口 pt）：

   ```
   region_x = 预览x / 预览宽 * 窗口宽(pt)
   region_w = 预览w / 预览宽 * 窗口宽(pt)
   region_y、region_h 同理用高度换算
   ```

   例：预览 1512x884、窗口 1512x884 pt、目标在预览里是 (700,80)-(1500,580) →
   `--region 700,80,800,500`。

4. **截区域并再读图**：区域越小，预览里单位像素越大，小字越清楚。文字看不清就再收紧一次范围。

5. **落结论**：把区域截图与结论写进 `test.md` / `review.md`，引用文件名与窗口信息行。

这条循环对**任何组件**都成立：工具栏、列表行、阅读区头部、正文画布、对话框按钮、菜单项。定位靠读图，不靠猜坐标。

## 命令

编译一次（产物放临时目录，不写技能目录）：

```bash
SK=<skill 目录>
B=${TMPDIR:-/tmp}/app-shot
mkdir -p "$B"
CLANG_MODULE_CACHE_PATH="$B/mc" swiftc -O "$SK/scripts/window-shot.swift" -o "$B/window-shot"
```

列出当前窗口（确认 App 的 owner 名与标题）：

```bash
"$B/window-shot" --list
# id=389735 pid=6402 owner=uumail title=收件箱 bounds=0,33 1512x884
```

截活动窗口：

```bash
"$B/window-shot" --app uumail --out <task-space>/evidence/inbox.png
```

只截一块区域（坐标是**窗口坐标，单位 pt**，原点在窗口左上角）：

```bash
"$B/window-shot" --app uumail --region 700,80,800,500 --out <task-space>/evidence/reading-pane.png
```

参数：

| 参数 | 说明 |
|---|---|
| `--list` | 列出所有 on-screen 窗口（id / pid / owner / title / bounds） |
| `--app <owner>` | 按窗口 owner 名匹配（大小写不敏感），取最前面的那个窗口 |
| `--pid <pid>` | 按进程匹配（App 有多窗口时更精确） |
| `--region x,y,w,h` | 裁剪区域，窗口坐标 pt；超出窗口会被拒绝 |
| `--out <file.png>` | 输出路径，目录不存在会自动创建 |

退出码：`0` 成功；`2` 参数错误；`3` 无屏幕录制权限；`4` 找不到窗口；`5` 截图或区域失败；`6` 写文件失败。

## 输出

stdout 两行：

```
id=389735 pid=6402 owner=uumail title=收件箱 bounds=0,33 1512x884
image=3024x1768 scale=2.00 out=<task-space>/evidence/inbox.png
```

- `scale` 是 Retina 倍率（通常 2.00）；`image` 尺寸 = `bounds` × `scale`；
- 区域截图时 `image` 尺寸 = `region` × `scale`。

## 判据

- 退出码 0，PNG 文件存在且非空；
- `image` 与 `bounds`/`region` 的倍率关系成立（防止截错窗口或缩放错误）；
- 图里能读到目标界面（标题栏、目标区域）；读不出说明窗口没到目标状态，先让 App 进入目标状态再截；
- 截图落 `task-space/evidence/`，在 `test.md` / `review.md` 里引用文件名。

## 坑

- **需要屏幕录制权限**：系统设置 → 隐私与安全性 → 屏幕录制，给宿主进程（终端/DSH）授权；否则退出码 3。
- **窗口必须在屏**：最小化、被系统保护、或无窗口时找不到；先激活 App 并打开目标窗口。
- **多窗口**：`--app` 取最前面的那个；需要固定窗口时用 `--list` 找 id 再用 `--pid`。
- **隐私**：真实邮件、账号、正文会进图。落 evidence 前裁剪到目标区域，或先换成假数据/测试账号；不要把真实凭据、身份证件、完整邮箱地址留在图里。
- **时序**：截图是瞬时状态；切换邮件/主题后要等界面更新完成再截，必要时先截一张确认再截目标张。
