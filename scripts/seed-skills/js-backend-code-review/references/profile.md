# profile：让检查适配一个仓库

profile 是项目级契约，回答“这套规则在这个仓库里看哪些路径、阈值多少、哪里允许例外”。默认值随技能版本发布；项目只写差异。

## 位置与状态

```
.workspace/
├─ scan.json                        # workspace-scan 产出
└─ checks/js-backend/
   ├─ profile.json                  # 本文件
   ├─ baseline.json                 # ratchet 基线
   ├─ tools.lock.json               # 工具版本与平台
   └─ reports/                      # 执行产物（可 gitignore）
```

profile 与 baseline 建议入库：变更可评审、可回滚。工具缓存与 reports 不入库。

## 字段

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "updated": "2026-11-18",
  "rulesVersion": "v0.1",
  "paths": {
    "source": ["src"],
    "tests": ["tests"],
    "migrations": ["db/migrations"],
    "entries": ["src/main.ts"],
    "ignore": ["src/components/http-gateway/docs-assets/**"]
  },
  "components": {
    "roots": ["src/components", "src/core"],
    "deepImportRoots": ["src/components"],
    "publicFiles": ["index.ts", "contract.ts"],
    "fanoutExempt": ["src/main.ts"],
    "deepImportExempt": []
  },
  "routes": { "roots": ["src/components/http-gateway/routes"], "methodSelector": "request.method" },
  "allow": {
    "console": ["src/main.ts", "src/components/http-gateway/respond.ts#console.error"],
    "env": ["src/core/config/"],
    "runtimeApis": { "Bun.file": ["src/core/platform/storage.ts"] }
  },
  "commit": { "taskPattern": "T-[A-Z0-9-]+", "fixPrefix": "fix", "churnTaskThreshold": 3 },
  "jscpd": { "format": "typescript", "minLines": 8, "minTokens": 70 },
  "contracts": { "command": ["bun", "test", "tests/.../openapi-fields.test.ts"] },
  "rules": {
    "Q-02": { "threshold": 90, "level": "HARD" }
  },
  "precheckRules": ["Q-01", "Q-06"],
  "meta": { "skillVersion": "v0.1", "layoutHash": "..." },
  "history": [
    { "ruleId": "Q-02", "before": 80, "after": 90, "reason": "...", "observed": "94", "at": "2026-11-18T..." }
  ]
}
```

## 约定

- **revision 只增**：每次管理态写入 +1，并记录 `history`。
- **阈值变更带证据**：`observed`（改动前实测）、`reason`（为什么不是改代码）。
- **允许清单按路径**：以 `/` 结尾表示前缀；支持 `*`；`file#expression` 精确匹配单个调用。
- **入口**：`paths.entries` 决定孤儿文件判定；多入口全部列出。
- **组件根**：`components.roots` 决定组件归属与扇出；`deepImportRoots` 只对需要门面的层做深导入检查。
- **契约命令**：`contracts.command` 为空时 Q-17 为 `SKIP`，不是 PASS。
- **规则开关**：`rules.<id>.enabled=false` 必须写明理由；不要用 profile 关闭整个规则组。

## 生成与修订

```bash
node scripts/review.mjs init --root . --write        # 首次生成草案
node scripts/review.mjs profile diff --root .        # 与默认值比较
node scripts/review.mjs calibrate --root .           # 看需要调整的项
node scripts/review.mjs calibrate --root . --accept --rule Q-02 --threshold 90 --reason "..."
```
