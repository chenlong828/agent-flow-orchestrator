# 工具链：版本、获取与离线

## 工具矩阵

| 工具 | 默认版本 | 用途 | 获取 |
|---|---|---|---|
| oxlint | 1.90.0 | 尺寸、复杂度、类型逃逸、非空断言 | npm，平台原生包自动选择 |
| typescript (tsc) | 7.0.2 | 类型检查 | npm |
| knip | 6.43.0 | 孤儿文件/导出/类型 | npm |
| jscpd | 5.4.2 | 克隆块 | npm |
| ts-morph | 28.0.0 | 依赖图、扇出、深导入、可选字段 | npm |
| pgsql-ast-parser | 12.0.2 | migration 表结构 | npm |
| git | 系统 | TODO 年龄、churn | 系统安装 |

## 解析顺序

1. `--tools-dir` 指定目录；
2. 目标仓库 `node_modules/.bin` 与 `node_modules`；
3. `.workspace/checks/js-backend/tools/node_modules`（管理态安装）；
4. 技能自带 `node_modules`（通常不存在）。

先命中先用。执行态不联网；管理态 `tools install` 才下载。

## 管理态安装

```bash
node scripts/review.mjs tools install --root .
```

- 用 `npm install --prefix .workspace/checks/js-backend/tools` 安装 `config/tools.json` 中锁定的版本；
- 写入 `tools.lock.json`：平台、版本、可执行文件 sha256；
- 安装失败退出 2，不静默跳过。

## 执行态判断

- `doctor` 逐个报告二进制与依赖是否可加载；
- 任一必需工具缺失，相关规则为 `ERROR`，整体退出 2；
- `ERROR` 不是“没有违规”，必须修工具或记录环境问题后再评审。

## 离线与缓存

- 工具缓存按平台存放，跨仓库复用；CI 可挂载同一缓存目录。
- 没有网络时，先在有网环境跑一次 `tools install`，再把 `.workspace/checks/js-backend/tools` 或平台缓存带过去。
- 不要把二进制提交进仓库；不要把工具版本随意升级，升级视为规则集变更，走管理态与人工确认。
