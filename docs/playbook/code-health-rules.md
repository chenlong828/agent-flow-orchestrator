---
layer: playbook
module: global
status: draft
updated: 2026-10-30
---

# 代码健康规则：用报告反馈收敛

## 1. 适用边界

**适用**：本仓库的 `src/`、`tests/`、`db/migrations/` 以及工具脚本的结构性维护。目标是让 agent 在改完代码后，根据同一套可重复的反馈自行收敛，而不是靠人临场判断“这段是不是太大了”。

**不适用**：业务正确性、HTTP 契约语义、性能调优、UI 实现。契约以 `design/components/*/spec.md` 与 `openapi.yaml` 为准；本文只定义代码腐化信号、阈值和反馈方式。

规则是暂定基线，不是自然规律。改阈值必须同时给出 `bun run quality:report` 前后的数据；不能为了变绿而调阈值。

## 2. 四个级别

| 级别 | 含义 | 执行方式 |
|---|---|---|
| `HARD` | 新代码或本次改动不得引入；已有存量单独列基线 | 反馈中必须修，或走例外记录 |
| `RATCHET` | 存量只减不增；允许先记录，但本次不能变多 | 修到基线以下再收口 |
| `WARN` | 需要看，但不单独阻塞 | 在改动范围内顺手处理；范围外记录 |
| `INFO` | 只观察趋势，不进入门禁 | 月度或专项评审时看 |

当前 `quality:report` 是**反馈工具**，默认不因 WARN 退出非零；但任何外部工具失效、输出无法解析、关键输入缺失都会记为 `ERROR` 并退出非零，不再把“没测到”当 PASS。需要按阈值卡住时运行 `bun run quality:gate`（等价于 `quality:report --gate`），有 WARN 即退出 1；等存量基线清零后再接进 `bun run check` 或 pre-push。

## 3. 规则表

### 3.1 尺寸与复杂度

| ID | 规则 | 工具 | 阈值 | 级别 | 说明 |
|---|---|---|---|---|---|
| Q-01 | 文件行数 | `oxlint` + 原始行数 | >600 行 | `HARD`（新文件/本次改动）；>500 为 `WARN` | 物理行，含注释和空行；当前只有 `skill/draft.ts` 623 行超过 600 |
| Q-02 | 函数行数 | `oxlint` | >80 行 | `HARD`（新函数/本次改动） | 物理行；现有 19 个函数超限，先记基线，不要求一次清完 |
| Q-03 | 函数参数 | `oxlint` | >5 个 | `HARD` | 超过 5 个通常说明缺少参数对象或职责过多 |
| Q-04 | 圈复杂度 | `oxlint` | >15 | `HARD`（新函数/本次改动） | 与函数行数同时看；复杂度 78 的 `analyzeTopology` 不是靠拆行能解决的 |
| Q-05 | 嵌套深度 | `oxlint` | >4 层 | `WARN` | 当前 0 个超限；保留为回归护栏，不单独作为重构理由 |

### 3.2 依赖与死代码

| ID | 规则 | 工具 | 阈值 | 级别 | 说明 |
|---|---|---|---|---|---|
| Q-06 | 循环依赖 | `ts-morph` + `oxlint` | >0 个 SCC | `HARD` | 当前 0；新增即失败 |
| Q-07 | 跨组件深导入 | `ts-morph` | >0 处 | `HARD`（本次改动） | 只算 `src/components` 内部，以及 `main.ts` 绕过组件 index；`contract.ts` 视为公共子路径；`main.ts` 是组合根，但装配仍必须经组件 barrel，因此不豁免深导入（与 Q-11 的扇出豁免不同）；当前 2 处，都是 `main.ts` 绕过 `skill/index.ts` |
| Q-08 | 孤儿文件 | `ts-morph` + `knip` | >0 个 | `HARD`（新增文件） | 当前 1 个：`skill/index.ts`；它与 Q-07 是同一个问题 |
| Q-09 | 孤儿运行时导出 | `knip` | >0 个 | `RATCHET` | 当前 8 个；修一个减一个，不要求一次清完 |
| Q-10 | 孤儿类型 | `knip` | 仅报告 | `INFO` | 当前 85 个，多数是 barrel 的 `export type`；先区分公共契约和死类型，不直接删 |
| Q-11 | 组件扇出 | `ts-morph` | >8 个 | `WARN` | `main.ts` 是组合根，单独豁免；当前 `http-gateway/app.ts` 为 8，刚好在线上 |

### 3.3 复制与类型逃逸

| ID | 规则 | 工具 | 阈值 | 级别 | 说明 |
|---|---|---|---|---|---|
| Q-12 | 克隆块 | `jscpd` | 新增块 >0；存量只减不增 | `HARD`（新增）/`RATCHET`（存量） | 当前 12 块、2.21%；最小检测 8 行/70 tokens |
| Q-13 | 非空断言 `!` | `oxlint` | 新增 >0；存量只减不增 | `HARD`（新增）/`RATCHET`（存量） | 当前 17 处；先用局部变量或显式校验替代 |
| Q-14 | `any` / `ts-ignore` / `ts-expect-error` | `oxlint` | >0 | `HARD` | 当前均为 0；不能靠注释绕过类型检查 |
| Q-15 | 重复字符串 | `ts-morph` | 仅报告 | `INFO` | 只统计跨 ≥3 个文件的字符串；当前 50 组，多为字段名和校验消息；不作为门禁 |
| Q-16 | 可选字段比例 | `ts-morph` | >30% | `WARN` | 排除 `Update*`、`Patch*`、`*Query`；当前 `CreateExpert` 75%，需要语义判断 |

### 3.4 契约、数据与运行时边界

| ID | 规则 | 工具 | 阈值 | 级别 | 说明 |
|---|---|---|---|---|---|
| Q-17 | OpenAPI/DTO 字段一致 | 既有字段测试 | >0 fail | `HARD` | 当前 13 pass / 0 fail；契约变更必须跑 |
| Q-18 | 表宽度 | `pgsql-ast-parser` | >20 列 | `WARN` | 当前 `harness` 16 列 |
| Q-19 | 可空列比例 | `pgsql-ast-parser` | >50% | `WARN` | 当前 `skill_draft` 62.5%；草稿/JSON 表可能合理，逐列确认 |
| Q-20 | 路由方法分支 | `ts-morph` | >12 | `HARD`（本次改动） | 按 `IfStatement` 计数，避免 `&&` 重复计数；当前 `routes/skill.ts` 14；应下沉到 handler/用例 |
| Q-21 | 配置外 `process.env` | `ts-morph` | >0 | `HARD` | 当前 0；环境读取统一走 `core/config` |
| Q-22 | Bun 文件/SQL API 越界 | `ts-morph` | >0 | `HARD` | 当前 0；只允许在批准的平台/配置/文档模块 |
| Q-23 | 非入口 `console` | `ts-morph` | >0 | `HARD` | 当前 0；入口启动日志和错误边界 `console.error` 例外 |
| Q-24 | TODO/FIXME 年龄 | `git` | >90 天 | `WARN` | 当前 0；只做提醒，不作为清理任务 |
| Q-25 | 弱断言 / skip | 文本扫描 | >0 | `HARD` | 当前 0；`toBeDefined`/`toBeTruthy` 不等于行为断言 |

### 3.5 预算与历史观察

| ID | 规则 | 工具 | 阈值 | 级别 | 说明 |
|---|---|---|---|---|---|
| Q-26 | 单文件直接导出 | `ts-morph` | >20 | `WARN` | 只数本文件直接声明，排除 re-export；含 `export type` 与默认导出；当前 18（`catalog/index.ts`） |
| Q-27 | 单文件 import | `ts-morph` | >20 | `WARN` | 当前 17 |
| Q-28 | 单文件函数数量 | `ts-morph` | >20 | `WARN` | 当前 18；`skill/package.ts` 是解析器，不构成上帝对象 |
| Q-29 | 单类方法数 | `ts-morph` | >10 | `WARN` | 当前 6 |
| Q-30 | git 热点 / fix churn / 多任务 churn | `git` | 仅报告 | `INFO` | 当前热点 0、fix 0、多任务 23；历史信号，不进入单次门禁 |

## 4. 阈值为什么是 600 和 80

这两个数不是自然常数，是“先用数据选一个能产生反馈的线”，再靠 ratchet 收敛。

### 文件行数

当前物理行数分布：

```text
>300：8 个文件
>400：6 个文件
>500：5 个文件
>600：1 个文件（skill/draft.ts，623）
```

- 取 **600 作为硬上限**：只卡住最大的一个，适合作为新文件的绝对上限，不会把现有中大型文件全部判死。
- 取 **500 作为提醒线**：能覆盖 `expert/service.ts` 537、`workflow/graph.ts` 518、`catalog/index.ts` 513、`workflow/service.ts` 502；这四个文件不一定要马上拆，但不应继续长。
- 如果按“非空非注释行”计，`skill/draft.ts` 只有 575 行，600 会直接放行。因此规则明确采用**物理行**，避免同一个文件在不同工具下得到相反结论。

### 函数行数

当前物理行数分布：

```text
>80：19 个函数
>100：16 个函数
>120：12 个函数
>150：9 个函数
```

- 80 不是分布里的天然断点；100 或 120 也能用。选 80 的理由是它对应“一屏能读完”的维护单位，能同时抓住 `handleSkill` 148、`createHttpApp` 92、`createHarnessStore` 121 这类路由/工厂函数。
- 选 100 会少抓 3 个，选 120 会少抓 7 个，选 150 会少抓 10 个；如果团队觉得 80 太激进，最先应调整的是**存量基线**，而不是把 80 改成 120。
- 对存量 19 个函数，第一次不要求清零；先按文件/函数记基线，新函数和本次改到的函数必须 ≤80。

## 5. agent 的反馈闭环

1. 改完代码，运行 `bun run quality:report`。
2. 只处理**本次改动文件**上的 `HARD`/`RATCHET`/`WARN`；范围外的存量记录，不顺手扩大重构。
3. 如果修改让某个指标从 WARN 变 PASS，不调阈值；如果新增 WARN，先改代码。
4. 重复跑同一命令，确认没有新增 WARN；报告是唯一事实来源，不在对话里另记一套数。
5. 确实需要例外时，把原因写进本次工序的 `brief.md`/`result.md` 或规则允许列表；不要用无原因的 inline disable 把规则静音。

## 6. 当前最该处理的三件事

不是 30 项一起改，而是按“规则反馈”收敛：

1. `skill/draft.ts`：623 行 / `createSkillDraftService` 424 行；先拆工厂，再拆 `saveDraft`。
2. `workflow/graph.ts`：`analyzeTopology` 复杂度 78；按拓扑阶段拆函数，不按行数硬切。
3. `routes/skill.ts`：`handleSkill` 复杂度 57、14 个方法分支；把方法分发下沉到独立 handler。

## 7. 工具与命令

```bash
bun run quality:report
bun run quality:gate
```

- `oxlint`：尺寸、复杂度、类型逃逸等 ESLint 兼容规则；
- `knip`：未使用文件/导出/类型；
- `jscpd`：克隆块；
- `ts-morph`：依赖图、扇出、深导入、路由分支、可选字段；
- `pgsql-ast-parser`：migration 表结构；
- `git`：churn 与 commit 大小；
- 既有 OpenAPI 字段测试：契约一致性。

工具本身的限制也写进规则：`typescript-eslint` 当前不支持 TypeScript 7.0，所以不用 ESLint；`dependency-cruiser` 同样要求 TS <7，依赖图改由 `ts-morph` 计算。工具不可用时先换工具，不降级规则。
