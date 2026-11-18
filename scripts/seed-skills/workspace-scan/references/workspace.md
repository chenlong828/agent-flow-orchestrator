# 工作区状态与漂移

## 状态文件

```
.workspace/
├─ scan.json                     # 扫描结果（建议入库）
├─ checks.json                   # 启用的检查方案（建议入库）
├─ checks/<scheme>/
│  ├─ profile.json               # 项目规则配置（建议入库）
│  ├─ baseline.json              # 基线（建议入库）
│  ├─ tools.lock.json            # 工具版本/平台（建议入库）
│  ├─ tools/                     # 工具缓存（不入库）
│  └─ reports/                   # 执行产物（不入库）
```

## 漂移判断

`scan` 计算 `layoutHash`（package.json、tsconfig、Cargo.toml、pom.xml、锁文件、顶层目录）。profile 的 `meta.layoutHash` 记录初始化时的值。

| 状态 | 条件 | 动作 |
|---|---|---|
| `uninitialized` | 没有启用方案或没有 profile | 进入 `WORKSPACE-01` 初始化 |
| `ready` | 哈希一致、profile/工具齐全 | 继续执行 |
| `drift` | 哈希不一致或缺工具锁 | 阻断，人工确认后校准并提交 revision |

漂移不自动修：`workspace-start` 只报告差异与建议，由 `workspace-manager` 在人工确认后更新。

## 再次进入

- 每次 run 开始都跑 `scan --check` 与 `doctor`；成本在秒级。
- 没有变化：直接进入开发/评审。
- 有变化：阻断并给出“哪些方案需要校准、缺什么工具、profile 哪一版落后”。
- 校准完成后必须提交一次只含状态文件的 commit，便于回滚与审计。

## 文档与 git

- 文档骨架、git 初始化/检查、`intent.md` 属于工作区初始化流程，由 `workspace-init` 系列步骤完成，不写进检查方案。
- 检查方案只写自己的状态目录，不碰文档、源码与 git 历史。
- 临时产物（报告、缓存）不入库；需要长期留存的证据放 task-space。
