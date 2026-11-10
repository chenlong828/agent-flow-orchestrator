---
layer: history
module: global
status: frozen
updated: 2026-11-03
---

# 决策：client 按工作区分支承载 DSH 进程，并屏蔽全局技能根

## 背景

调度器与 `agent-flow-client` 的边界设计原先沿用 D2「一个工作流实例绑定一个 ACP 进程」，同时 D6 写「DSH 原生 Skill catalog 关闭或为空」。client 侧 S0 实测得到两个约束：

- DSH 原生 Skill catalog 是当前技能供给的实际机制；技能在 `session/prompt` 时读取，建 session 后写技能、同 session 替换均可见。
- 技能根是**进程级**配置：默认根会同时暴露项目 `.dsh`、项目 `.agents`、用户 `DSH_HOME/skills`、`DSH_AGENTS_HOME/skills`；只维护 `.dsh/skills` 只能控制该根，其他根仍会贡献技能。client 不删除用户/项目技能根；通过 skill-filesystem 配置把用户根/打包根指向空目录，项目根保留。
- 项目根按 session cwd 解析，因此同一进程内不同 cwd 的 session 可以各自看到自己的项目根；S0-09 已实测默认根下的 A/B 隔离。全局根屏蔽后，这条路径不再要求“一工作区一进程”。

因此，「一个实例一个进程」在技能隔离上已经可行；此前“一工作区一进程”的结论基于“必须用静态 customSkillDirs 关闭默认根”的假设，现已不成立。当前是否保留“一工作区一进程”转为故障隔离/容量取舍，待确认。

## 决策

1. **一个活跃工作区一个 DSH 进程（当前选择，理由是故障隔离与独立清理；技能隔离已不再要求）。** 同一工作区的顺序节点共享该进程；每个节点新建 session，替换工作区技能后执行。
2. **fan-out 子任务各自工作区、各自进程。** 一个实例可以有一个主工作区和多个 fan-out 分支；实例结束时退出所有分支进程。
3. **client 只屏蔽全局技能根，保留项目根。** 在 DSH profile 的 skill-filesystem 配置中保持 `includeDefaultRoots: true`，把 `dshHome`、`agentsHome`、`bundledSkillDir` 指向真实存在的空目录；项目根仍按 session cwd 解析，`<project>/.dsh/skills` 与 `<project>/.agents/skills` 都保留。节点技能由 client 落在其中一个项目根。调度器仍只负责选择技能组合，不参与本地目录与 profile。
4. **继续使用 DSH 原生 Skill catalog。** 控制面分发技能内容，client 落地为原生 catalog；隔离靠项目根 + 全局根屏蔽配置，不靠关闭 catalog，也不承诺 per-session 技能根。
5. **进程清理以进程组/作业树为边界。** ACP 的 close 只保证会话层关闭，不保证工具子进程退出；崩溃/结束由 client 清理整个进程组。

### 技能根配置

```yaml
- id: skill-filesystem
  config:
    dshHome: /var/empty/dsh
    agentsHome: /var/empty/agents
    bundledSkillDir: /var/empty/bundled
```

- `includeDefaultRoots` 保持 true（默认）；项目根保留，用户根和打包根被空目录替换。
- 三个空目录要真实创建；否则 `discoverRoot` 为空，watcher 可能上溯到祖先目录，增加无谓开销（不是正确性前提）。
- `bundledSkillDir` 有 `DSH_BUNDLED_SKILL_DIR` 环境变量兜底；显式填空目录更稳。
- 不要用 `DSH_HOME` 环境变量屏蔽：它会影响 settings、credentials 等；只覆盖 skill-filesystem 的 config。
- patch 对目标行是整份 config 替换，不合并；只写这三个字段，其余走 schema 默认值。
- 项目根内已有技能会保留，视为项目上下文；需要严格“仅当前清单”时，client 另行管理项目根。

## 对既有决策的修订

| 编号 | 原内容 | 本次修订 |
|---|---|---|
| D2 | 一个工作流实例绑定一个 ACP 进程 | 当前按“一个活跃工作区一个进程”；全局根屏蔽后一实例一进程也重新可行，是否回退待确认 |
| D6 | 原生 Skill catalog 关闭或为空 | 使用原生 catalog；client 屏蔽全局根、保留项目根，节点清单落在项目根 |
| D9 | 并发分为 ACP 并发与 Session 并发 | 当前按工作区分支计；若回退 D2，则按实例进程计，fan-out 用进程内不同 cwd 的 session |
| D11 | 直接重跑，不依赖 session 恢复 | 不变 |

## 代价与约束

- fan-out 分支会增加进程数；client 容量按分支上报，调度器按容量派发。
- 跨实例共享同一工作区与「一工作区一进程」存在技能目录争用；默认每实例独立工作区，共享模式需串行或另行约束。
- client 需管理 DSH profile/patch 的生成、版本与清理；profile 成为执行信任面的一部分。
- 崩溃清理必须覆盖工具子进程；S0-11 已复现 SIGKILL 后 `sleep` 子进程存活。
- DSH 版本/技能行为可能漂移；需固定版本/commit，并在升级前复跑 S0 关键用例。

## 被否决的方案

- **一个实例一个进程 + fan-out 共用技能集**：保留 D2，但 fan-out 子任务不能有不同技能组合，或只能串行，牺牲并发与每子任务技能差异。
- **同一进程按 session 切换技能根**：DSH 当前不提供 per-session 技能根，ACP 也没有该能力；不作为 client 方案。
- **`includeDefaultRoots: false + customSkillDirs`**：也能只暴露指定目录，但会丢掉项目根，需要显式重建；当前选择保留项目根，配置更小。
- **用 `DSH_HOME` 环境变量关全局根**：会影响 settings、credentials 等其他插件；不采用。

## 待确认

- 全局根屏蔽配置使“一进程多 workspace”重新可行（S0-09 已实测默认根下 A/B 隔离）。保留“一工作区一进程”的收益是故障隔离/独立清理，代价是 fan-out 进程数；是否回退 D2 一实例一进程，待确认。

## 参考

- 边界与职责设计：`docs/works/2026-11-03-client-boundary/boundary-design.md`
- client 侧工作清单：`docs/works/2026-11-03-client-boundary/client-work.md`
- S0 结果：`agent-flow-client/docs/works/2026-11-03-s0-acp-verification/result.md`
