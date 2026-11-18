---
name: "js-backend-code-review"
description: "JS/TS 后端代码检查：管理态校准 profile/基线/工具，执行态跑 precheck/report/gate，并配合 JS 后端判断清单审视分层、契约、错误处理与测试。触发：代码评审、提交前自检、质量门禁、质量阈值校准"
version: "v0.1"
---

# JS/TS 后端代码检查

面向 Node/Bun 后端的可复用检查技能。机器能测的交给 `scripts/review.mjs`，机器测不出的交给 `references/judgment-checklist.md`。本技能不绑定具体项目：路径、入口、组件根、允许清单、阈值都在 profile 里。

## 1. 两个阶段，交替使用

| 阶段 | 命令 | 何时用 | 写什么 |
|---|---|---|---|
| 管理态 | `init` / `tools install` / `baseline` / `calibrate` / `adopt` / `profile diff` | 首次接入、规则升级、阈值与基线调整 | `.workspace/checks/js-backend/`，需人工确认 |
| 执行态 | `doctor` / `precheck` / `report` / `gate` / `explain` | 每次进入工作区、代码评审、CI | 只读，输出 `check-report@1` |

执行态发现“规则不适用 / 阈值不合理 / 工具缺失”时，不要自己改配置；把报告里的 `calibration` 交给管理态，由人确认后 `calibrate --accept --rule ... --threshold ... --reason ...` 写入 `revision+1`。

## 2. 三层检查

1. **precheck**：只跑快规则（尺寸、类型逃逸、循环依赖、深导入、扇出、env/console/runtime API、测试卫生），只看本次 diff，目标 <10s。评审节点第一步执行，失败直接回退实现，不进入人工评审。
2. **report**：全量 30 条规则 + tsc/knip/jscpd/SQL/git/契约命令，输出 JSON 给评审与 CI。
3. **judgment**：按 `references/judgment-checklist.md` 逐项给证据；结论与机器报告分列，不互相替代。

## 3. 常用命令

```bash
node scripts/review.mjs init --root . --write
node scripts/review.mjs tools install --root .
node scripts/review.mjs doctor --root . --json
node scripts/review.mjs precheck --root . --changed --json
node scripts/review.mjs report --root . --json
node scripts/review.mjs gate --root . --json
node scripts/review.mjs calibrate --root . --json
node scripts/review.mjs calibrate --root . --accept --rule Q-02 --threshold 90 --reason "拆分后仍超限，按 2026-11-18 报告调整"
node scripts/review.mjs explain Q-07 --root .
```

## 4. 判定口径

- `FAIL`：HARD 规则超阈值（或 RATCHET 超基线），门禁阻塞。
- `WARN`：需要看，`gate` 时阻塞；`report` 不阻塞。
- `ERROR`：工具失效或输入缺失，**不能当 PASS**，先修工具。
- `SKIP`：规则未配置或本阶段不执行，报告里保留原因。

退出码：`0` 通过；`1` 门禁失败；`2` 工具或输入不可信。

## 5. 与工作区的关系

- 本技能是 `workspace-scan` 的一个 check scheme（见 `scripts/scheme.json`）。
- `workspace-start` 负责进入工作区时 `scan + doctor`，发现漂移即阻断并指向 `WORKSPACE-01`。
- `workspace-manager` 负责首次接入与校准：`init` → `tools install` → `baseline` → 人工确认 → 提交 profile 变更。
- 评审节点只执行 `precheck`，通过后再做判断清单与 `report`。

## 6. 完成标准

- 本次改动的文件没有新增 `FAIL`；新增 `WARN` 已被处理或记录理由。
- `report` 无 `ERROR`；工具缺失已修复或明确记录为环境问题。
- 判断清单每项有“查了什么 / 结论 / 证据位置”。
- profile/基线发生变化时，带 revision、理由与前后数据，并单独提交。

## 7. 失败信号

- 为了变绿改阈值，没有前后数据与理由。
- 执行态直接写 profile，或绕过管理态改基线。
- 把 `ERROR` 当通过；工具没装就报告“无违规”。
- 判断清单只写“已检查”，没有证据位置。
- 在 `src/` 之外的位置运行 `init --write`，覆盖了别的仓库配置。
