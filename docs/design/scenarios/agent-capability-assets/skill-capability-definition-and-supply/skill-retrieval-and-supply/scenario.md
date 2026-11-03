---
layer: design
module: agent-capability-assets
status: verified
updated: 2026-11-04
flow: FLOW-SKL-RETRIEVE-001
scenario: SCN-0003
domain: 智能体能力资产
valueStream: Skill 能力定义与供给
title: Skill 检索与供给
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-skill
    path: src/components/skill/read.ts
    symbol: createSkillRead
  - component: CMP-catalog
    path: src/components/catalog/index.ts
    symbol: createCatalog
docs:
  - path: docs/design/components/skill/spec.md
    heading: 3.2 方法契约
  - path: docs/design/components/http-gateway/spec.md
    heading: 5.3 Skill
  - path: docs/design/components/catalog/spec.md
    heading: 3.1 方法契约
tests:
  - role: R1
    id: TC-SKR-001
  - role: R2
    id: TC-SKR-002
  - role: R3
    id: TC-SKR-003
  - role: N1
    id: TC-SKR-004
externalRefs:
  - path: src/components/http-gateway/openapi.yaml
    anchor: listSkills
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: getSkill
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: getSkillDocument
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: downloadSkillPackage
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: listSkillCategories
    kind: openapi-operation
---

# Skill 检索与供给

## 1 场景与价值

管理端按名称、描述、分类、标签和启停状态检索 Skill，打开详情查看正文与文件清单；编排器或执行端取当前包的 `SKILL.md` 原文或整包 zip；`ETag` 以 `revision` 标识版本。结果：调用方拿到的是当前包，列表与详情不依赖解压附件，重复请求可用 `ETag` 得到 `304`。

Skill 有两种消费方式：管理面读 brief、正文与文件清单；编排面直接按整篇 `SKILL.md` 或整包载入。两者共用同一个当前包，不维护第二份正文。

本场景只覆盖读路径。草稿与发布见 `SCN-0002`；启停、删除与引用保护不单独建场景。

## 2 入口

入口与文档锚点以本文件 frontmatter 的 `entries`、`docs`、`externalRefs` 为准，索引由这些字段生成，不在正文重复路径。

- HTTP 入口：`CMP-http-gateway` 的 `createHttpApp`。
- 领域入口：`CMP-skill` 的 `createSkillRead`，负责 brief、包内 `SKILL.md`、整包与分类读取。
- 读模型入口：`CMP-catalog` 的 `createCatalog`，组合 `categoryLabel`、`usedByCount` 与引用查询。

## 3 运行序

流程定义：`FLOW-SKL-RETRIEVE-001`。

1. 检索列表：`GET /api/v1/skills`，支持 `q`（匹配 `name` 或 `description`）、`category`、`tag`、`enabled`、分页与 `sort`（名称、更新时间、版本）。列表只读 brief，不读 zip；返回 `categoryLabel`、有序 `tags` 与 `usedByCount`。
2. 打开详情：`GET /api/v1/skills/{id}`，读取 brief、包中央目录与 `SKILL.md`，返回 `body`（去掉 frontmatter 的正文）与 `files`。`files` 的 `SKILL.md` 首项，其余按路径升序；已保存状态全部 `readOnly=true`。
3. 取编排文档：`GET /api/v1/skills/{id}/document`，返回包内 `SKILL.md` 原始字节，`text/markdown; charset=utf-8`，`ETag: "<revision>"`。带相同 `If-None-Match` 时返回 `304`，不做 `enabled` 过滤。
4. 取整包：`GET /api/v1/skills/{id}/download`，返回当前 zip，`application/zip`，带 `Content-Length`、`Content-Disposition`（`<name>-<version>.zip`）、`ETag` 与 `Cache-Control: no-cache`。`If-None-Match` 命中返回 `304`。
5. 分类参考：`GET /api/v1/skill-categories` 返回固定四类 `coding` / `retrieval` / `review` / `testing`，按 `position` 排序，无分页。

失败路径：

- 未知 Skill：详情、文档与下载都返回 `404`；条件请求在资源存在性校验之后评估，缺失资源不返回 `304`。
- 包缺失或损坏：`500 package_unavailable`，不回落 brief；列表与摘要仍可用。
- 停用 Skill：列表可通过 `enabled` 过滤；详情、文档与下载仍可读，停用不改变包与 `SKILL.md`。
- 不提供单文件下载、Range 请求或内联预览。

## 4 不可变引用

外部客户端把后端 REST API 视为不可变契约。本场景通过 `externalRefs` 指向实际 OpenAPI 文档的 operation：

- `listSkills`、`getSkill`、`getSkillDocument`、`downloadSkillPackage`、`listSkillCategories`

引用只记录 operationId，不复制请求/响应字段；OpenAPI 的破坏性变更必须走契约决策，不能静默改。

## 5 测试映射

测试 ID 在测试标题中稳定存在，索引生成器会校验：

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-SKR-001` | 按分类、标签、关键词与启停过滤；`categoryLabel`、`usedByCount`、`tags` 正确；分类固定四类 |
| R2 | `TC-SKR-002` | 详情 `body` 与 `files` 顺序、只读标记正确；文档原文含三键 frontmatter 与正文，`ETag` 命中返回 304 |
| R3 | `TC-SKR-003` | 下载 zip 含 `SKILL.md` 与附件，文件名与 `ETag` 正确，命中返回 304；停用后详情、文档与下载仍可读 |
| N1 | `TC-SKR-004` | 未知 Skill 的详情、文档与下载返回 404，带 `If-None-Match` 也不返回 304；空检索返回 0 |

R3 中的停用操作只作为“读取不中断”的前置步骤，启停本身的 revision 语义不在本场景验收。

## 6 覆盖边界

- 不覆盖草稿、附件编辑与保存发布；这些是写路径，见 `SCN-0002`。
- 不覆盖启停、删除与引用保护：这些管理操作的边界与不建独立场景的理由见 `SCN-0002` 的覆盖边界。
- 不覆盖包缺失/损坏的 HTTP 500：组件测试直接操作存储覆盖 `package_unavailable`；HTTP 场景不篡改存储，不把该路径纳入 3+1。
- 不覆盖缓存代理、Range、内联预览与单文件下载；当前契约不支持。
- 不覆盖版本历史与旧版本读取；当前不存在版本历史，读的始终是当前包。
