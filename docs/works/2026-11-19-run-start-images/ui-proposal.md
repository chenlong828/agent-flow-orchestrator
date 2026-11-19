---
layer: works
module: run
status: active
updated: 2026-11-19
procedure: 2026-11-19-run-start-images
target: agent-flow-ui
---

# UI 提案：发起运行时粘贴图片作为初始资料

> 依据：[`proposal.md`](proposal.md) 与 2026-11-19 用户裁决（client 支持图片；只支持图片）。
>
> **2026-11-19 UI 实施结果**：UI 已实现，上传时机为「提交时上传」（点「发起运行」后逐张上传，全部成功再启动；失败回滚 DELETE）。本文已按该口径回写；若与 UI result 冲突，以 [UI result](../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md) 为准。后端契约不变。
> 本文给 `agent-flow-ui` 项目使用，描述 UI 需要实现的交互、状态与落点；后端契约以 [`proposal.md`](proposal.md) §5.1 为准。本文不改 UI 代码。

## 1 目标

在「发起运行」弹窗里，用户可以像 DSH 输入框一样：

- 从剪贴板粘贴一张或多张图片，或拖放/选择图片；
- 图片在提交前只本地暂存（缩略图、删除）；点「发起运行」时逐张上传，显示进度，失败可重试；
- 点击「发起运行」时，只把已上传成功的 `inputId` 列表随启动请求提交；
- 运行详情/人工确认页能看到本次运行的初始资料缩略图。

## 2 非目标

- 不做图片编辑、裁剪、旋转、OCR、压缩；原图上传，展示时缩放。
- 不做通用文件（PDF、文本、代码）；只接受 PNG/JPEG/WebP/GIF。
- 不做上传队列持久化；刷新页面后未提交的暂存项不会自动过期，需关闭时 DELETE 或运维清理。
- 不做断点续传。
- 不做图片重排；顺序 = 粘贴/添加顺序。
- 不做运行结束后的归档浏览（沿用 `OQ-34`）。

## 3 后端契约（UI 只依赖这些）

| 用途 | 请求 | 成功 |
|---|---|---|
| 上传单张 | `POST /api/v1/run-inputs`，`multipart/form-data`，字段 `file` | 201 `{ inputId, name, mediaType, sizeBytes, sha256, createdAt }` |
| 删除暂存 | `DELETE /api/v1/run-inputs/{inputId}` | 204；404 视为已清理；409 表示已绑定 |
| 启动 | `POST /api/v1/workflows/{id}/runs`，JSON 增加 `inputs: [{ inputId }]` | 201 `{ runId }` |
| 运行详情列表 | `GET /api/v1/runs/{id}/inputs` | 200 `{ items: RunInputView[] }` |
| 图片内容 | `GET /api/v1/runs/{id}/inputs/{inputId}/content` | 200 二进制，`Content-Type` 为 image/* |

限制（UI 本地也校验一遍，服务端为准）：

- 类型：`image/png`、`image/jpeg`、`image/webp`、`image/gif`；不接受 SVG。
- 单张 ≤8 MiB；最多 8 张；合计 ≤20 MiB。
- 暂存项不设 TTL；启动失败不消耗暂存项，可重试；关闭弹窗时 DELETE，未 DELETE 的孤儿需运维清理。

## 4 交互流程

```text
打开「发起运行」弹窗
  │
  ├─ 粘贴/拖放/选择图片
  │    ├─ 本地校验：类型/单张体积/数量/合计
  │    ├─ 缩略图 + 可删除；提交前零服务端状态
  │    └─ 点「发起运行」后才逐张 POST /run-inputs（并发 3）
  │
  ├─ 上传
  │    ├─ 全部成功 → 按列表顺序提交 inputs:[{inputId}]
  │    └─ 任一失败 → abort 其余、DELETE 已上传项，保留本地 File 可重试
  │
  ├─ 启动
  │    ├─ 成功：markBound；关闭弹窗不删除；跳转详情
  │    └─ 失败：DELETE 已上传暂存；保留弹窗与本地图片，可重试
  │
  └─ 关闭/取消：abort 上传；DELETE 未绑定项；释放 object URL
```

## 5 状态模型

每张图一个本地项：

```ts
type LocalInput = {
  localId: string;            // UI 内部，crypto.randomUUID()
  file: File;
  objectUrl: string;          // URL.createObjectURL(file)，用于缩略图
  state: "staged" | "uploading" | "uploaded" | "bound" | "failed";
  progress: number;           // 0–100；无 total 时用不确定态
  inputId: string | null;     // 提交上传成功后才由服务端返回
  serverName: string | null;  // 服务端清洗后的 name
  error: string | null;       // 展示文案
  abort: AbortController | null;
};
```

规则：

- 点「发起运行」后，所有 `staged`/`failed` 项按列表顺序上传；全部 `uploaded` 后才进入启动 `inputs`。
- 同一文件重复添加允许；服务端绑定时按 `-2` 去重文件名。
- 提交前删除只动本地；上传后的回滚/关闭删除才调 `DELETE`，404 不报错。
- 启动成功（201）后把所有 `uploaded` 项标记为 `bound`，不再允许删除；关闭弹窗只释放 URL。
- 上传失败或启动失败时回滚：`DELETE` 已上传项，本地项恢复 `staged`，保留 File 供重试。

## 6 界面与交互细节

### 6.1 发起弹窗

在「启动意图（Markdown）」之后增加一个字段：

- 标题：`初始资料（图片）`，提示：`支持 PNG/JPEG/WebP/GIF；单张 ≤8 MiB，最多 8 张；点「发起运行」后上传`。
- 一条横向附件栏（不换行、可横向滚动；隐藏滚动条）：
  - 64px 方形缩略图；
  - 右下角删除按钮（hover/focus 可见，触屏常显）；
  - 上传中：底部细进度条；到 100% 但服务端未返回时显示「处理中」；
  - 失败：缩略图上覆盖「重试」按钮，tooltip 显示错误；
  - 文件名/大小不必全显示；tooltip 或下方状态行给 `name` 与 `size`。
- 右侧/末尾一个「添加图片」按钮，触发隐藏的 `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple>`。
- 数量/合计超出时 toast：`最多 8 张图片` / `图片合计不能超过 20 MiB` / `单张不能超过 8 MiB`。
- 空态不占大块空间；只在字段下方显示一行提示。

### 6.2 粘贴与拖放

- 在弹窗 `body` 上以**捕获阶段**监听 `paste`：
  - 从 `event.clipboardData.items` 取 `kind === "file"` 且 `type.startsWith("image/")` 的项；
  - 有图片时 `preventDefault()`，阻止 Milkdown 把图片以 base64 塞进 Markdown；
  - 没有图片（纯文本）时不拦截，交给编辑器。
- 监听 `dragover`/`drop`：
  - `dragover` 只有携带文件时才 `preventDefault()` 并显示拖放提示；
  - `drop` 过滤图片文件，其余忽略并 toast「只支持图片」。
- 文件选择走隐藏 input；选择后追加到同一队列。
- 粘贴/拖放可能一次多张：按 `DataTransfer.files` 顺序加入。

### 6.3 上传

- 上传只在点「发起运行」后触发；粘贴/拖放/选择只入本地队列，不产生服务端状态。
- `POST /api/v1/run-inputs` 用 `XMLHttpRequest`（而不是 `fetch`）以拿到 `upload.onprogress`；同源 BFF 会转发。
- 并发上限 3；其余排队；任一项失败不阻塞其他项。
- 请求头由浏览器自动带 multipart boundary；不要手写 `Content-Type`。
- 超时：沿用 BFF 的 120 s；XHR 侧设 120 s 超时，超时归为可重试失败。
- 进度到 100% 只表示浏览器已把 body 交给 BFF；BFF 是缓冲转发，之后等服务端响应期间显示「处理中」。
- 取消：删除/关闭时 `abort()`；服务端可能已落盘，未拿到 `inputId` 的请求成为孤儿，暂存项不会自动过期，需运维清理。

### 6.4 提交

- 点「发起运行」后：先做原有工作流/Harness/工作区/意图校验 → 禁用按钮并显示「上传中…」→ `uploadAll()`（并发 3，按列表顺序）→ 全部成功后再调启动接口。
- 任一上传失败：abort 其余、`DELETE` 已上传项、恢复本地项为 `staged`，toast 首个错误，保留弹窗可重试。
- 启动失败：`DELETE` 已上传项，保留本地图片与弹窗；重试会重新上传。
- 提交体：

```js
{
  harnessId,
  workspacePath,
  intentMarkdown,
  autoConfirm,
  inputs: uploadedItems.map(function (item) { return { inputId: item.inputId }; })
}
```

- 无图片时不传 `inputs`（或传 `[]`，后端等价）。
- 提交期间按钮显示「启动中…」；失败恢复可点。

### 6.5 关闭与清理

- `onClose`：
  1. 中止所有 `uploading` 的 XHR；
  2. 对 `uploaded` 且未绑定的项尽力 `DELETE /run-inputs/{id}`（`keepalive` 可选；失败忽略）；
  3. `URL.revokeObjectURL` 所有缩略图；
  4. 清空本地状态。
- 启动成功后不要执行第 2 步（已绑定，DELETE 会 409）；只释放 URL。
- 页面刷新/崩溃：未提交的暂存项不会自动过期；下次打开无法恢复，需运维清理。

## 7 代码落点

| 文件 | 改动 |
|---|---|
| `assets/js/run/input-upload.js`（新） | 上传队列：本地校验、并发 3、XHR 进度、abort、重试、`uploadAll()`、`dispose()` |
| `assets/js/run/data.js` | `uploadInput(file, { onProgress, signal })`、`deleteInput(inputId)`；`start(workflowId, input)` 透传 `inputs` |
| `assets/js/pages/instances.js` | 弹窗新增字段与附件栏；`onMount` 初始化 uploader + paste/drop/file input；`onOk` 校验并提交 `inputs`；`onClose` 清理 |
| `assets/js/pages/instance-detail.js` | 运行详情新增「初始资料」区：`runs.inputs(runId)` + 缩略图；人工确认页同区块 |
| 样式（现有页面 CSS 或组件样式） | 附件栏、64px 缩略图、进度条、重试/删除按钮、拖放高亮 |
| `bff/index.js` | 预计不改：`/api/v1/` 白名单、multipart 转发、25 MiB/120 s 已满足 |
| `tests/…` | 上传状态机、提交 payload、删除/关闭清理、详情渲染、错误文案 |

`run/data.js` 新增函数示意：

```js
function uploadInput(file, options) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    var form = new FormData();
    form.append('file', file);
    xhr.open('POST', BASE + '/run-inputs');
    xhr.timeout = 120000;
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignored */ }
      if (xhr.status === 201) return resolve(data);
      reject(normalize(xhr.status, data));
    };
    xhr.onerror = xhr.ontimeout = function () { reject(networkError()); };
    xhr.onabort = function () { reject(abortError()); };
    if (options.signal) {
      options.signal.addEventListener('abort', function () { xhr.abort(); }, { once: true });
    }
    xhr.send(form);
  });
}

function deleteInput(inputId) {
  return request({ method: 'DELETE', path: BASE + '/run-inputs/' + encodeURIComponent(inputId) });
}
```

> 注意：`shared/http.js` 的 `request()` 会 `JSON.stringify` 非 FormData body，但拿不到进度；上传单独走 XHR 更直接。启动仍用现有 `runs.start`。

## 8 错误处理与文案

| 场景 | 处理 |
|---|---|
| 上传 400（类型/魔数/文件名） | 整体回滚，错误文案「不支持的图片格式」；保留本地可删除/重试 |
| 上传 413 | 「图片超过 8 MiB」；整体回滚，保留本地 |
| 上传 500/503/超时/断网 | 「上传失败，请重试」；按钮重试 |
| 本地超数量/合计 | toast，不加入队列 |
| 启动 409 `client_unsupported` | 「执行节点暂不支持图片（未升级或未上线）」；DELETE 已上传暂存项，本地图片保留可重试 |
| 启动 409 `run_conflict` | 「该工作区已有运行」；DELETE 已上传暂存项，本地图片保留可重试 |
| 启动 400 `inputs[i]` unknown | 「有图片已失效，请重新添加」；把对应项标 failed |
| 启动 400 `inputs[i]` already_bound | 「图片已被某次运行使用；请刷新运行列表确认，不要重复上传」；本地项保留 |
| 启动 413 `run_input_bytes` | 「图片合计超过 20 MiB」；提示删除 |
| 启动其他错误 | 沿用现有 `run/data.js` 错误归一与 toast |
| 删除 404 | 视为已清理，不提示 |
| 删除 409 | 说明已绑定；不应发生；刷新详情 |

## 9 运行详情/确认页预览

- 进入详情时并行请求 `GET /runs/{id}/inputs`；为空不渲染区块。
- 有值则显示「初始资料（N）」+ 横向缩略图；`<img src="/api/v1/runs/{id}/inputs/{inputId}/content" loading="lazy" alt="...">`。
- 缩略图点击可复用现有图片预览组件；没有就用新标签页打开原图，不新增依赖。
- 加载失败显示占位与文件名；单张 ≤8 MiB，浏览器可承受。
- 确认页把该区块放在决策按钮附近，方便人工确认时查看。

## 10 可访问性与性能

- 附件栏用按钮/列表语义；删除、重试、添加都有 `aria-label`。
- 上传状态变化用 `aria-live="polite"` 播报（「第 2 张上传完成」/「上传失败」）。
- 缩略图 `alt` 用文件名。
- 同一时间最多 3 个上传；每个缩略图 64px，原图仅用于上传与详情预览。
- 用完即 `revokeObjectURL`；不在 DOM 里保留 File 以外的 base64。
- 不把图片放进 Markdown 编辑器，避免把大 base64 写进意图正文。

## 11 验收

手工/自动化至少覆盖：

1. 粘贴 1 张、3 张、8 张：提交前零上传；点发起后按顺序并发 3 上传，启动 payload 的 `inputId` 顺序正确。
2. 粘贴第 9 张：toast 拒绝，已有 8 张不受影响。
3. 单张 >8 MiB：本地/服务端拒绝，不进入上传。
4. 上传失败后重试成功；上传中删除会 abort。
5. 关闭弹窗：已上传未绑定项被 DELETE；失败则暂存项留存，object URL 释放。
6. 启动失败（client_unsupported/run_conflict）后回滚已上传项；重试重新上传。
7. 运行详情显示 N 张缩略图，点击可看原图；无图片不显示区块。
8. 纯文本粘贴仍进入 Markdown 编辑器，不被图片逻辑拦截。
9. 拖放非图片文件被忽略并提示。
10. 人工确认页能看到初始资料。

## 12 待定

| # | 问题 | 建议 |
|---|---|---|
| `QU-01` | 关闭弹窗时是否立即 DELETE 暂存项？ | 立即 DELETE（best effort）；无 TTL，未 DELETE 的孤儿需运维清理 |
| `QU-02` | 缩略图点击行为：灯箱 / 新标签页 / 不处理？ | 复用现有图片预览；没有就新标签页，首期不新增灯箱依赖 |
| `QU-03` | 是否显示单张文件名与大小？ | 缩略图 tooltip + 状态行；不占横向空间 |
| `QU-04` | 上传并发数 | 3；再多对本地/ BFF 收益有限 |
| `QU-05` | 是否支持重新排序？ | 首期不做；顺序 = 添加顺序，删除不改变相对顺序 |

## 13 参考

- 后端契约与限制：[`proposal.md`](proposal.md) §5.1、§6。
- 现有发起弹窗：[`instances.js`](../../../../agent-flow-ui/assets/js/pages/instances.js)。
- 现有运行数据层：[`run/data.js`](../../../../agent-flow-ui/assets/js/run/data.js)。
- 现有请求层：[`shared/http.js`](../../../../agent-flow-ui/assets/js/shared/http.js)。
- BFF 转发：[`bff/index.js`](../../../../agent-flow-ui/bff/index.js)。
- DSH 草稿附件交互参考：`@deepseek-ai/dsh-client-ui-attachment` 的 README（Desktop `app.asar` 内）。
