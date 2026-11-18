# check-scheme 契约

一个检查方案 = 一个技能包 + 一份 manifest + 一组标准命令。工作区只依赖契约，不依赖具体语言。

## manifest：`scripts/scheme.json`

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
    "any": ["package.json", "**/*.ts", "**/*.js"],
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

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 工作区内的唯一标识，同时是状态目录名 |
| `slug` | 是 | 技能包目录名 |
| `version` | 是 | 与 SKILL.md 一致，用于升级判断 |
| `stacks` | 是 | 技术栈标签，供展示与人工选择 |
| `appliesTo.requires` | 否 | 必须存在的文件 |
| `appliesTo.any` | 是 | 至少命中一个文件才适用 |
| `appliesTo.not` | 否 | 命中任一文件即不适用 |
| `entry` | 是 | 相对技能包根目录的入口脚本 |
| `commands` | 是 | 五个标准命令的参数模板 |
| `stateDir` | 是 | 项目内状态目录 |
| `reportSchema` | 是 | 固定 `check-report@1` |

## 命令语义

| 命令 | 读 | 写 | 退出码 |
|---|---|---|---|
| `doctor` | profile、工具、缓存、布局 | 无 | 0 可用；2 缺关键项 |
| `precheck` | 快规则、本次 diff | 无 | 0 通过；1 FAIL；2 ERROR |
| `report` | 全量规则 | 无 | 0 通过；2 ERROR |
| `gate` | 全量 + 基线 | 无 | 0 通过；1 FAIL/WARN；2 ERROR |
| `calibrate` | 实测值与 profile | 仅 `--accept` 时写 profile | 0 成功；2 参数或工具错误 |

命令参数由 manifest 模板给出，调度器会追加 `--root`、`--skills-dir`、`--state-dir`，以及用户的 `--changed`、`--profile`、`--reason`、`--accept`。

## 报告：`check-report@1`

```json
{
  "schemaVersion": 1,
  "reportSchema": "check-report@1",
  "scheme": "js-backend",
  "command": "report",
  "summary": { "pass": 0, "fail": 0, "warn": 0, "error": 0, "info": 0, "skip": 0, "violations": 0 },
  "tools": [{ "name": "oxlint", "ok": true, "detail": "" }],
  "metrics": [{ "id": "Q-01", "level": "HARD", "value": "500", "threshold": "600", "status": "PASS" }],
  "violations": [{ "ruleId": "Q-07", "level": "HARD", "path": "src/...", "line": 12, "message": "" }],
  "calibration": [{ "ruleId": "Q-02", "kind": "threshold-or-fix", "suggestion": "" }]
}
```

调度器不解释规则，只合并 `summary`、保留 `schemes[].result` 与 `schemes[].exitCode`。

## 聚合

```json
{
  "schemaVersion": 1,
  "reportSchema": "check-report@1",
  "command": "precheck",
  "root": "/abs/path",
  "schemes": [{ "scheme": "js-backend", "exitCode": 0, "result": {} }],
  "summary": { "pass": 0, "fail": 0, "warn": 0, "error": 0, "info": 0, "skip": 0, "violations": 0 },
  "exitCode": 0
}
```

## 新增方案（Java / Rust / Vue UI）

1. 新建技能包，`scripts/scheme.json` 换 `id`/`stacks`/`appliesTo`/`entry`。
2. 实现五个命令，输出 `check-report@1`。
3. 规则与判断清单放在该技能自己的 `references/`；不要写进 `workspace-scan`。
4. 工作区 `discover` 自动发现；`enable` 后生效。
5. 后端 Java 可用 SpotBugs/Checkstyle/ArchUnit，Rust 可用 clippy/cargo-audit，Vue UI 可用 eslint/vue-tsc/Playwright；这些属于各自方案的工具链，工作区不关心。
