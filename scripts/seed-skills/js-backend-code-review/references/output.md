# 输出契约：check-report@1

所有执行态命令输出同一结构（`--json`）或表格（默认）。工作区调度器按此结构聚合。

## 结构

```json
{
  "schemaVersion": 1,
  "reportSchema": "check-report@1",
  "scheme": "js-backend",
  "command": "report | precheck | gate | doctor | calibrate",
  "generatedAt": "2026-11-18T...",
  "root": "/abs/path",
  "profile": { "revision": 1, "rulesVersion": "v0.1", "path": "..." },
  "summary": { "pass": 0, "fail": 0, "warn": 0, "error": 0, "info": 0, "skip": 0, "violations": 0, "infoItems": 0, "findings": 0 },
  "tools": [{ "name": "oxlint", "ok": true, "detail": "..." }],
  "metrics": [{ "id": "Q-01", "name": "文件行数", "level": "HARD", "value": "500（...）", "threshold": "600", "status": "PASS", "detail": "" }],
  "violations": [{ "ruleId": "Q-07", "level": "HARD", "path": "src/...", "line": 12, "message": "..." }],
  "sections": [{ "title": "跨组件深导入", "rows": ["..."], "info": false }],
  "calibration": [{ "ruleId": "Q-02", "kind": "threshold-or-fix", "suggestion": "..." }]
}
```

## 状态语义

| 状态 | 含义 | 退出码影响 |
|---|---|---|
| `PASS` | 未超阈值 | 无 |
| `FAIL` | HARD/RATCHET 超限 | 1 |
| `WARN` | 需要看 | `gate` 时 1，`report` 时 0 |
| `ERROR` | 工具失效/输入缺失 | 2（最高优先级） |
| `SKIP` | 未配置或本阶段不执行 | 无 |
| `INFO` | 仅观察 | 无 |

## 命令差异

- `report`：全量；有 `ERROR` 退出 2，否则 0。
- `gate`：全量；`FAIL` 或 `WARN` 退出 1，`ERROR` 退出 2。
- `precheck`：只跑 `precheckRules`；慢规则为 `SKIP`；`FAIL` 退出 1，`WARN` 不阻塞。
- `doctor`：不跑规则，检查 profile、工具、依赖、布局漂移；缺失关键项退出 2。
- `calibrate`：输出建议或写入 revision；写操作需要 `--accept --reason`。

## --changed

- 通过 `git diff` + 未跟踪文件确定改动集合；
- `scope=file` 规则只判定改动文件；
- `scope=repo` 的 HARD 规则在有 baseline 时按基线放行存量；
- 没有 git 时退化为全量判定，并在 `detail` 中说明。
