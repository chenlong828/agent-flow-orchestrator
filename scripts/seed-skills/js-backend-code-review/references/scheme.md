# 作为 check scheme 接入工作区

本技能实现 `workspace-scan` 定义的 check-scheme 契约。工作区不需要认识 JS 规则，只读取 manifest 并调用命令。

## manifest

`scripts/scheme.json`：

```json
{
  "schemaVersion": 1,
  "id": "js-backend",
  "displayName": "JS/TS 后端",
  "slug": "js-backend-code-review",
  "version": "v0.1",
  "stacks": ["javascript", "typescript", "node", "bun"],
  "appliesTo": {
    "requires": ["package.json"],
    "any": ["package.json", "**/*.ts", "**/*.js", "**/*.mjs"],
    "not": ["**/*.vue"]
  },
  "entry": "scripts/review.mjs",
  "commands": {
    "doctor": ["doctor", "--json"],
    "precheck": ["precheck", "--json"],
    "report": ["report", "--json"],
    "gate": ["gate", "--json"],
    "calibrate": ["calibrate", "--json"]
  },
  "stateDir": ".workspace/checks/js-backend",
  "reportSchema": "check-report@1"
}
```

## 约定

- `appliesTo.requires` 必须存在的文件；`any` 至少命中一个；`not` 命中任一即不适用。
- 命令固定为 `doctor/precheck/report/gate/calibrate`，输出必须是 `check-report@1`。
- 状态目录由 `stateDir` 指定，工作区调度器会传 `--state-dir`。
- 新增 Java/Rust/Vue 检查方案时，复制契约、换 manifest 与引擎，不改工作区代码。
- 未实现的命令返回退出码 3，由调度器记为不可用，不冒充通过。
