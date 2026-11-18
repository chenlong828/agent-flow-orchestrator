# JS 后端规则目录（默认值）

本清单是引擎的默认规则集，项目可用 profile `rules.<id>` 覆盖阈值、级别与启用状态。`scope=file` 的规则在 `--changed` 下只判定改动文件；`scope=repo` 按基线或阈值判定。

| ID | 规则 | 默认级别 | 默认阈值 | 工具 | scope |
|---|---|---|---|---|---|
| Q-01 | 文件行数 | HARD | 600（>500 提醒） | ts-morph + oxlint | file |
| Q-02 | 函数行数 | HARD | 80 | oxlint | file |
| Q-03 | 函数参数 | HARD | 5 | oxlint | file |
| Q-04 | 圈复杂度 | HARD | 15 | oxlint | file |
| Q-05 | 嵌套深度 | WARN | 4 | oxlint | file |
| Q-06 | 循环依赖 | HARD | 0 组 | ts-morph | repo |
| Q-07 | 跨组件深导入 | HARD | 0 处 | ts-morph | file |
| Q-08 | 孤儿文件（入口不可达） | HARD | 0 个 | ts-morph | repo |
| Q-09 | 孤儿运行时导出 | RATCHET | 0 | knip | repo |
| Q-10 | 孤儿类型 | INFO | 仅报告 | knip | repo |
| Q-11 | 组件扇出 | WARN | 8 | ts-morph | file |
| Q-12 | 克隆块 | HARD | 0 块 | jscpd | repo |
| Q-13 | 非空断言 `!` | RATCHET | 0 | oxlint | file |
| Q-14 | `any` / `ts-ignore` | HARD | 0 | oxlint | file |
| Q-15 | 重复字符串（≥3 文件） | INFO | 仅报告 | ts-morph | file |
| Q-16 | 可选字段比例 | WARN | 30% | ts-morph | file |
| Q-17 | 契约一致性 | HARD | 0 fail | profile 命令 | repo |
| Q-18 | 表宽度 | WARN | 20 列 | pgsql-ast-parser | repo |
| Q-19 | 可空列比例 | WARN | 50% | pgsql-ast-parser | repo |
| Q-20 | 路由方法分支 | HARD | 12 | ts-morph | file |
| Q-21 | 配置外 `process.env` | HARD | 0 处 | ts-morph | file |
| Q-22 | 运行时 API 越界 | HARD | 0 处 | ts-morph | file |
| Q-23 | 非入口 `console` | HARD | 0 处 | ts-morph | file |
| Q-24 | TODO/FIXME 年龄 | WARN | 90 天 | git blame | repo |
| Q-25 | 弱断言 / skip | HARD | 0 / 0 | 文本扫描 | file |
| Q-26 | 单文件直接导出 | WARN | 20 | ts-morph | file |
| Q-27 | 单文件 import | WARN | 20 | ts-morph | file |
| Q-28 | 单文件函数数量 | WARN | 20 | ts-morph | file |
| Q-29 | 单类方法数 | WARN | 10 | ts-morph | file |
| Q-30 | git 变化信号 | INFO | 仅报告 | git | repo |
| Q-31 | 类型错误 | HARD | 0 | tsc | repo |

## 判定与豁免

- `HARD`：新代码或本次改动不得引入；`scope=file` 在 `--changed` 下只看改动文件。
- `RATCHET`：存量只减不增；有 `baseline.json` 时按基线比较，没有时按阈值。
- `WARN`：`gate` 阻塞、`report` 不阻塞；是否本轮处理由改动级别决定。
- `INFO`：只观察，不进入门禁。
- 工具缺失或输出无法解析时该规则为 `ERROR`，退出码 2；不允许降级为 PASS。

## 豁免

- 规则级：profile `rules.<id>.enabled = false`，必须写理由与范围；不要用无原因的全局关闭。
- 路径级：`components.deepImportExempt`、`components.fanoutExempt`、`allow.env`、`allow.console`、`allow.runtimeApis`。
- 存量：写入 `baseline.json`，只降不升；新增问题不得进基线。
