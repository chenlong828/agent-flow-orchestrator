---
layer: history
module: global
status: frozen
updated: 2026-10-24
---

# 2026-10-24 组件边界、命名与文档目录调整

## 背景

B1 组件规格最初使用 `CMP-ctl-*` / `control-*` 命名，并把 `kernel` 只写在 `architecture.md` 的共享契约层，没有独立规格。评审时确认：

- 全部 B1 组件都属于控制面，逐个加 `control-` 没有区分度；
- `http` 实际是交付网关，`http-gateway` 更准确；
- `kernel` 只定义共享契约与端口，`platform` 只提供运行时基础设施，两者变化轴不同；
- `expert`、`tool` 等方法契约应归组件规格，HTTP DTO 只做传输映射；
- `docs/design/components/` 是按文档类型分的目录，不是“只有这里才是组件”。

## 决策

1. **组件改为 8 个**：`CMP-kernel`、`CMP-platform`、`CMP-harness`、`CMP-tool`、`CMP-skill`、`CMP-expert`、`CMP-catalog`、`CMP-http-gateway`。组件 ID 保留 `CMP-`，目录使用短名。
2. **`kernel` 与 `platform` 不合并成 `core` 组件**：`kernel` 负责共享错误、分页、`ReferenceGuard`/时钟/ID 端口；`platform` 负责配置、DB/事务、迁移、健康检查。`core` 只可作为物理目录容器，不是组件，不写 spec。
3. **`http` 改名 `http-gateway`**：它只做 HTTP 传输、DTO 与错误映射，不承载业务规则，也不定义领域方法。
4. **方法定义归组件规格**：`harness`、`tool`、`skill`、`expert`、`catalog`、`platform` 各自写方法契约与领域/视图类型；`http-gateway` 只保留端点、DTO、错误映射和「端点 → 组件方法」表。
5. **文档目录保留 `docs/design/components/`**：组件规格与未来的 `docs/design/scenarios/` 是兄弟类型目录；`architecture.md` 是系统视图。三者不扁平化，避免组件目录与场景领域目录混名。
6. **实现任务顺延**：`T-B1-I01` 改为 `kernel`，`T-B1-I02` 为 `platform`，用例切片顺延至 `T-B1-I03`～`I08`，验收为 `T-B1-I09`。

## 被否决的方案

- **保留 `CMP-ctl-*` / `control-*`**：所有组件都在控制面，前缀不提供信息；`control-http` 与 `control-catalog` 的职责也不属于“控制”。
- **`kernel + platform` 合成 `CMP-core`**：一个组件同时承担共享契约与运行时基础设施两个变化轴，违反单一主目标；`core` 名字过泛，容易成为杂物间。
- **去掉 `docs/design/components/` 扁平化**：后续 `scenarios/` 出现后，组件目录与场景领域目录无法靠路径区分；`architecture.md` 也会与组件目录混层。
- **继续把方法/字段定义留在 HTTP DTO**：REST 传输形状会成为事实上的领域契约，组件层失去权威来源。

## 后果

- 组件规格由 7 份变为 8 份；REST 路径、DTO 字段、错误码不变，`agent-flow-ui` 不受影响。
- `docs/design/components/` 下目录为 `kernel`、`platform`、`harness`、`tool`、`skill`、`expert`、`catalog`、`http-gateway`。
- 方法契约、领域输入/输出类型与 `http-gateway` 的端点映射已落到对应 spec；表级设计与实现尚未开始。
- 本次只改文档与目录，不写代码、不建表、不跨项目修改。
