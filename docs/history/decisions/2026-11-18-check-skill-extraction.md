---
layer: history
module: global
status: frozen
updated: 2026-11-18
---

# 决策：代码质量门禁抽取为多方案检查技能

## 背景

`scripts/quality-report.ts` 与本仓库的目录、入口、工具版本、阈值强耦合：路径写死 `src/components/http-gateway`，允许清单写在代码里，阈值散落在 `add()` 调用和 playbook 散文里，只有文本输出，无法作为可复用资产安装到 AF，也无法承载 Java/Rust/Vue 等后续检查方案。

## 决策

1. **检查能力按技术栈拆成独立技能包**：`js-backend-code-review` 自带规则、阈值、引擎与判断清单；后续 Java/Rust/Vue 各自新增同契约的技能包。
2. **工作区只做发现、编排与聚合**：`workspace-scan` 定义 `check-scheme` 契约（`scripts/scheme.json` + 五个标准命令 + `check-report@1`），按 `appliesTo` 发现方案并聚合结果，不认识任何语言规则。
3. **管理态与执行态分离**：
   - 管理态（`init` / `tools install` / `baseline` / `calibrate` / `adopt`）低频、可联网、必须人工确认，写 `.workspace/checks/<scheme>/`；
   - 执行态（`doctor` / `precheck` / `report` / `gate`）高频、离线、只读；
   - 执行态发现规则不适用或阈值不合理时输出 `calibration` 请求，由管理态带前后数据与理由写入 `profile.revision+1`。
4. **硬检查前置**：`precheck` 只跑快规则和本次 diff（实测约 1s），放在评审节点第一步；全量 `report` 给评审与 CI。
5. **AF 接入**：新增 `workspace-start` / `workspace-manager` / `workspace-end` 专家与 `WORKSPACE-01` 工作流；`workspace-start` 具备 scan/doctor 能力，可由不同执行流选用；未初始化或漂移时阻断并指向 `WORKSPACE-01`。
6. **并存**：本轮不替换现有 `quality:report`，用示例 profile 做 parity；切换另立工序。

## 备选与否决

- **单一通用引擎内置多语言规则**：规则与工具矩阵会迅速膨胀，判断清单也无法按语言区分；否决。
- **独立 workspace 工作流作为每次研发的必经前置**：AF 是单图执行，独立工作流无法被研发流调用，漏跑即断；改为「工作流 + 可复用的 start 专家」。
- **把阈值/基线交给执行态自动调整**：会出现“为变绿调阈值”；否决，改为管理态 + 人工确认 + 前后数据。
- **把工具二进制打进技能包**：受 20MB/文件、100 文件、100MB 包限制与平台矩阵约束；改为 `tools install` 按锁定版本安装并写 `tools.lock.json`。

## 装配决议（2026-11-18）

- `code-reviewer` 与 `implementer` 都装配 `js-backend-code-review`：评审先 precheck 再 report + 判断清单，实现提交前自检。
- 研发流启动节点保持 `start-node`；`workspace-start` 只服务 `WORKSPACE-01`，由需要接入/校准的项目显式选用。
- 接入专家按项目/技术栈拆分：当前为 `workspace-manager-js`，后续新增 `workspace-manager-java`、`workspace-manager-vue`，各自只挂对应检查方案；`WORKSPACE-01` 的 n3 按项目替换。
- 装配边从 39 增至 52。

## 后果

- 新增一个语言检查方案的成本 = 新增一个技能包，不改工作区代码。
- 每个项目的阈值、豁免、基线可评审、可回滚；执行态结果可复现（工具版本锁定 + 离线缓存）。
- 需要维护两处事实：技能默认值（随版本）与项目 profile（随仓库）；`adopt` 负责升级提示，`profile diff` 负责审计。
- `precheck` 的覆盖范围小于全量报告，评审仍需 `report` 与判断清单，不能只看 precheck 通过。
