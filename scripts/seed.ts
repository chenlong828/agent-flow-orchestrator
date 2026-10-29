import { join } from "node:path";
import { createDb, createFileStore, createMigrator, ensureDatabase } from "../src/core/platform/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import type { Db } from "../src/core/platform/index.ts";
import type { FileStore } from "../src/core/kernel/index.ts";
import { buildSkillPackage } from "../src/components/skill/package.ts";

type LegacyHarness = {
  id: string;
  name: string;
  type: string;
  address: string;
  accessMode: string;
  tags: string[];
  health: string;
  heartbeatM: number;
  max: number;
  queuePolicy: "fifo" | "priority";
  desc: string;
};

type LegacyTool = {
  id: string;
  name: string;
  type: string;
  invocation: string;
  params: { k: string; type: "string" | "int"; desc: string }[];
  harness: string;
  timeoutMs: number;
  status: string;
  desc: string;
  lastDebugM: number | null;
};

type LegacySkill = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  pitfalls: string[];
  version: string;
  enabled: boolean;
  updatedM: number;
};

type LegacyExpert = {
  id: string;
  name: string;
  color: string;
  role: string;
  persona: string[];
  skills: string[];
  tools: string[];
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  refs: { label: string; type: string }[];
  enabled: boolean;
};

const HARNESSES: LegacyHarness[] = [
  { id: "h-build01", name: "build-01", type: "容器", address: "10.0.4.11:7801", accessMode: "容器注册", tags: ["CICD", "构建", "测试"], health: "在线", heartbeatM: 0.08, max: 20, queuePolicy: "fifo", desc: "CI 构建容器池节点" },
  { id: "h-build02", name: "build-02", type: "容器", address: "10.0.4.12:7801", accessMode: "容器注册", tags: ["CICD", "测试", "部署"], health: "在线", heartbeatM: 0.1, max: 20, queuePolicy: "fifo", desc: "CI 构建容器池节点" },
  { id: "h-agent07", name: "agent-07", type: "服务器", address: "10.0.5.23:7801", accessMode: "常驻 Agent", tags: ["审视", "检索", "批处理"], health: "高负载", heartbeatM: 0.2, max: 20, queuePolicy: "priority", desc: "批量审视专用服务器（LLM 波谷跑批）" },
  { id: "h-etl03", name: "etl-03", type: "服务器", address: "10.0.5.31:7801", accessMode: "常驻 Agent", tags: ["造数", "回放", "数据"], health: "在线", heartbeatM: 0.12, max: 30, queuePolicy: "fifo", desc: "造数与回放数据节点" },
  { id: "h-devlap", name: "dev-lap", type: "笔记本", address: "192.168.1.8:7801", accessMode: "SSH", tags: ["调试"], health: "离线", heartbeatM: 128, max: 5, queuePolicy: "fifo", desc: "个人调试用接入（下班离线）" },
];

const TOOLS: LegacyTool[] = [
  { id: "t-trace", name: "trace_call_chain", type: "CLI", invocation: "trace --symbol {symbol} --depth {depth}", params: [{ k: "symbol", type: "string", desc: "目标符号（类/方法）" }, { k: "depth", type: "int", desc: "追踪深度，默认 3" }], harness: "h-build01", timeoutMs: 30000, status: "可用", desc: "调用链分析，圈定变更影响面", lastDebugM: 120 },
  { id: "t-meta", name: "metadata_query", type: "MCP", invocation: "mcp://meta/query?entity={entity}", params: [{ k: "entity", type: "string", desc: "实体名或 ID" }], harness: "h-build02", timeoutMs: 10000, status: "可用", desc: "实体/字段/服务元数据查询", lastDebugM: 180 },
  { id: "t-dsl", name: "dsl_search", type: "CLI", invocation: "dsl search --kw {keyword} --proj {project}", params: [{ k: "keyword", type: "string", desc: "检索关键字" }, { k: "project", type: "string", desc: "工程名" }], harness: "h-agent07", timeoutMs: 15000, status: "可用", desc: "低代码 DSL 资产检索", lastDebugM: 240 },
  { id: "t-lint", name: "linter", type: "CLI", invocation: "lint --path {path} --rules {rules}", params: [{ k: "path", type: "string", desc: "目标路径" }, { k: "rules", type: "string", desc: "规则集，缺省 default" }], harness: "h-agent07", timeoutMs: 60000, status: "可用", desc: "编码规范静态检查", lastDebugM: 15 },
  { id: "t-smell", name: "code_smell_scan", type: "CLI", invocation: "scan --path {path} --suite {suite}", params: [{ k: "path", type: "string", desc: "目标路径" }, { k: "suite", type: "string", desc: "审视套件: magic|mem|lock|param" }], harness: "h-agent07", timeoutMs: 120000, status: "可用", desc: "魔法数清理/内存释放/锁与事务/入口参数 批量审视", lastDebugM: 60 },
  { id: "t-contract", name: "contract_assert", type: "CLI", invocation: "contract assert --spec {spec} --env {env}", params: [{ k: "spec", type: "string", desc: "契约文件" }, { k: "env", type: "string", desc: "环境" }], harness: "h-build02", timeoutMs: 45000, status: "可用", desc: "接口契约断言守护", lastDebugM: 400 },
  { id: "t-factory", name: "data_factory", type: "脚本", invocation: "python tools/make_data.py --scene {scene} --rows {rows}", params: [{ k: "scene", type: "string", desc: "业务场景编码" }, { k: "rows", type: "int", desc: "生成行数" }], harness: "h-etl03", timeoutMs: 180000, status: "未验证", desc: "SVO 场景业务造数", lastDebugM: null },
  { id: "t-replay", name: "replay_clean", type: "脚本", invocation: "python tools/replay_clean.py --src {src}", params: [{ k: "src", type: "string", desc: "回放数据源目录" }], harness: "h-etl03", timeoutMs: 300000, status: "不可用", desc: "回放数据清洗与脱敏（依赖库缺失待修复）", lastDebugM: 2880 },
  { id: "t-btree", name: "business_tree_query", type: "MCP", invocation: "mcp://btree/query?node={node}", params: [{ k: "node", type: "string", desc: "功能树节点 ID" }], harness: "h-build02", timeoutMs: 10000, status: "可用", desc: "业务功能树（业务域/价值流/场景）查询，需求唯一事实来源", lastDebugM: 90 },
  { id: "t-smoke", name: "smoke_runner", type: "CLI", invocation: "smoke run --pipeline {pipeline} --stage {stage}", params: [{ k: "pipeline", type: "string", desc: "流水线 ID" }, { k: "stage", type: "string", desc: "制品级/集成运行" }], harness: "h-build01", timeoutMs: 600000, status: "可用", desc: "制品级冒烟与集成运行冒烟", lastDebugM: 360 },
];

const SKILLS: LegacySkill[] = [
  { id: "sk-cres", name: "CRES 技能", category: "编码", tags: ["CRES", "规范"], description: "遵循 CRES 专属框架规范完成代码编写，三大要点齐备；触发：CRES、代码生成", pitfalls: ["严格禁止绕过基类直接操作数据层", "禁止在 Skill 中硬编码环境配置"], version: "v1.4", enabled: true, updatedM: 30 },
  { id: "sk-ldp", name: "LDP 技能", category: "编码", tags: ["LDP", "低代码"], description: "按低代码 DSL 规范生成页面与后台服务代码；触发：LDP、低代码、DSL", pitfalls: ["禁止手改生成器产物中的标记段"], version: "v2.0", enabled: true, updatedM: 1440 },
  { id: "sk-callchain", name: "调用链分析", category: "检索", tags: ["调用链", "Trace"], description: "基于 Call Trace 定位符号引用链，圈定影响面；触发：调用链、影响面、trace", pitfalls: ["禁止只看单点调用就下结论，必须追完整链"], version: "v2.1", enabled: true, updatedM: 120 },
  { id: "sk-meta", name: "元数据查询", category: "检索", tags: ["元数据", "Metadata"], description: "查询实体/字段/服务元数据，补全上下文；触发：元数据、字段", pitfalls: ["查询结果必须记录版本号，禁止使用过期元数据"], version: "v1.2", enabled: true, updatedM: 2880 },
  { id: "sk-btree", name: "业务功能树检索", category: "检索", tags: ["功能树", "业务域"], description: "沿 业务域→价值流→场景 定位代码入口，防大海捞针；触发：功能树、业务域、场景", pitfalls: ["禁止跳过功能树直接全文搜索"], version: "v1.6", enabled: true, updatedM: 90 },
  { id: "sk-dsl", name: "DSL 检索", category: "检索", tags: ["DSL"], description: "在低代码 DSL 资产中检索扩展点与配置；触发：DSL、扩展点", pitfalls: ["禁止假设 DSL 节点存在，必须检索确认"], version: "v1.0", enabled: true, updatedM: 4320 },
  { id: "sk-ab", name: "AB 交叉审视", category: "审视", tags: ["AB", "交叉"], description: "两个独立上下文交叉审视产物，不一致时升级；触发：交叉审视、AB", pitfalls: ["禁止两个视角共享上下文，必须隔离"], version: "v1.3", enabled: true, updatedM: 60 },
  { id: "sk-lint", name: "Linter 代码体检", category: "审视", tags: ["Linter", "静态检查"], description: "静态检查优先于模型判断，工具能解决的不依赖模型；触发：lint、静态检查", pitfalls: ["禁止人工解释 Linter 告警为误报而不留证据"], version: "v3.1", enabled: true, updatedM: 15 },
  { id: "sk-contract", name: "契约断言", category: "审视", tags: ["契约", "接口"], description: "对接口契约生成断言并守护业务契约；触发：契约、断言、接口", pitfalls: ["契约变更必须同步功能树，禁止静默改契约"], version: "v1.1", enabled: true, updatedM: 720 },
  { id: "sk-svo", name: "SVO 拆分", category: "测试", tags: ["SVO"], description: "把验证目标拆到 SVO 事实锚，对接黄金标准；触发：SVO、验证目标", pitfalls: ["禁止没有事实锚就编写用例"], version: "v2.2", enabled: true, updatedM: 200 },
  { id: "sk-factory", name: "业务造数工具", category: "测试", tags: ["造数"], description: "按场景生成业务测试数据；触发：造数、数据", pitfalls: ["生产数据禁止直接回灌，必须清洗"], version: "v1.5", enabled: true, updatedM: 600 },
  { id: "sk-replay", name: "回放数据清洗", category: "测试", tags: ["回放", "流量"], description: "流量回放数据清洗与脱敏；触发：回放、清洗", pitfalls: ["清洗前禁止回放，防止脏数据污染环境"], version: "v0.9", enabled: false, updatedM: 7200 },
];

const EXPERTS: LegacyExpert[] = [
  {
    id: "e1", name: "需求分析专家", color: "#2563eb", role: "厘清客户真实需求，结合业务功能树展开为成体系的需求描述", persona: ["严谨", "刨根问底"], skills: ["sk-cres", "sk-btree", "sk-meta"], tools: ["t-meta", "t-btree"], duty: "从 Issue/人工输入出发完成意图识别、范围识别与交叉探索，产出结构化需求 Spec", skillOrder: "先业务功能树检索圈定范围 → 元数据查询补全上下游 → CRES 规范约束文档产出", verifyOrder: "需求完整性自检 → 与功能树逐节点对照 → 格式规范校验", notes: "对\"一句话需求\"保持警惕，必须追问到可实施粒度", refs: [{ label: "金融证券交易业务规则汇编", type: "行业规则" }, { label: "workspace:/knowledge/requirements-spec-template.md", type: "运行期注入" }], enabled: true,
  },
  { id: "e2", name: "方案设计专家", color: "#7c3aed", role: "在遗留方案基础上给出全面、深入、无遗漏的变更方案", persona: ["全局观", "谨慎"], skills: ["sk-cres", "sk-callchain", "sk-dsl"], tools: ["t-trace", "t-dsl", "t-meta"], duty: "输出技术方案 Spec、任务拆分与测试分析，标记可顺带处理的技术债", skillOrder: "调用链分析摸清现状 → DSL 检索确认扩展点 → 按 CRES 规范产出设计", verifyOrder: "方案完整性对照检查单 → 变更影响面交叉验证", notes: "优先复用公共技术平台能力，避免重复造轮子", refs: [{ label: "架构设计红线的 Brief", type: "经验" }], enabled: true },
  { id: "e3", name: "开发实现专家", color: "#16a34a", role: "按独立任务完成代码与自动化测试用例编写", persona: ["规范控", "高效"], skills: ["sk-cres", "sk-ldp", "sk-lint"], tools: ["t-lint", "t-dsl", "t-trace"], duty: "遵循架构/编码/低代码 DSL 规范完成 CRES、LDP 框架代码与用例", skillOrder: "任务计划 → LDP 脚手架生成 → CRES 编码规范实现 → Linter 自检", verifyOrder: "基础逻辑自测通过 → 编码规范零告警", notes: "禁止绕过收敛约束直接提交", refs: [{ label: "编码规范约束手册", type: "规范" }], enabled: true },
  { id: "e4", name: "测试验证专家", color: "#ea580c", role: "设计并执行场景化用例，组织测试环境与验证金标准", persona: ["挑剔", "数据敏感"], skills: ["sk-svo", "sk-factory", "sk-replay"], tools: ["t-factory", "t-smoke", "t-replay"], duty: "基于场景用例调度 CICD 完成版本构建、部署与穿测", skillOrder: "SVO 拆分定位验证目标 → 业务造数 → 冒烟/回归执行", verifyOrder: "黄金标准数据比对 → 覆盖率核查", notes: "业务正确性以 DevOps 验证代码与预期结果为准", refs: [{ label: "SVO 事实锚说明", type: "规范" }], enabled: true },
  { id: "e5", name: "代码审视专家", color: "#0d9488", role: "按调用链/模块/文件级别批量审视代码与产物并修复缺陷", persona: ["细致", "多疑"], skills: ["sk-ab", "sk-lint", "sk-callchain", "sk-dsl"], tools: ["t-lint", "t-trace", "t-smell", "t-meta", "t-dsl"], duty: "执行魔法数清理、内存释放审视、入口参数校验等批量任务", skillOrder: "DSL 检索圈定目标 → 调用链定位 → AB 交叉审视输出", verifyOrder: "审视结论双通道一致 → 修复后 Linter 复检", notes: "审视结论必须给出证据位置（文件+行号）", refs: [{ label: "历史踩坑记录索引", type: "经验" }], enabled: true },
  { id: "e6", name: "评审专家", color: "#dc2626", role: "以独立、否决的视角对阶段产物进行评审准出", persona: ["独立", "否决视角", "不留情面"], skills: ["sk-ab", "sk-cres"], tools: ["t-lint", "t-meta"], duty: "输出通过/回退指令，回退时携带结构化评审意见", skillOrder: "对照阶段准出清单逐项核验 → 输出结论", verifyOrder: "证据链完整性检查", notes: "评审与被评审角色必须在上下文上隔离，禁止读取执行过程的内心独白", refs: [{ label: "约 50 项准出标准（需求/方案/代码/测试）", type: "规范" }], enabled: true },
  { id: "e7", name: "集成验证专家", color: "#4f46e5", role: "基于 CICD 与 Agent Runtime 完成多组件和场景化验证", persona: ["流程控"], skills: ["sk-svo", "sk-contract", "sk-smoke2"], tools: ["t-smoke", "t-contract", "t-replay"], duty: "场景串接化测试验证、版本编制与内部部署调度", skillOrder: "环境组织 → 契约断言 → E2E 穿测", verifyOrder: "健康质检点全绿 → 回归通过", notes: "关注版本 RP 合并前的资产一致性校验", refs: [{ label: "CICD 基础服务接入指南", type: "规范" }], enabled: true },
  { id: "e8", name: "知识库运营专家", color: "#0ea5e9", role: "维护分层知识索引与技能沉淀，防止技能老化与冲突", persona: ["归纳癖"], skills: ["sk-btree", "sk-meta"], tools: ["t-meta", "t-btree"], duty: "人工校准问题回写知识库、专家技能库，维护索引迭代", skillOrder: "变更收集 → 索引更新 → 冲突检测", verifyOrder: "索引一致性校验", notes: "知识库膨胀是最大风险，坚持渐进式披露", refs: [{ label: "知识库运营手册", type: "经验" }], enabled: true },
];

/**
 * UI 夹具里 e7 引用了不存在的 sk-smoke2；为保持 12 个 Skill 与 23 条装配边，
 * 种子把它映射到语义最接近的 sk-replay，不新增第 13 个 Skill。
 */
const SKILL_ALIASES: Record<string, string> = { "sk-smoke2": "sk-replay" };

const KIND: Record<string, string> = {
  容器: "container",
  服务器: "server",
  桌面: "desktop",
  笔记本: "laptop",
};
const ACCESS: Record<string, string> = {
  容器注册: "container_registry",
  常驻Agent: "agent",
  "常驻 Agent": "agent",
  SSH: "ssh",
};
const HEALTH: Record<string, string> = {
  在线: "online",
  高负载: "overloaded",
  离线: "offline",
  未知: "unknown",
};
const TOOL_KIND: Record<string, string> = { CLI: "cli", MCP: "mcp", 脚本: "script" };
const TOOL_STATUS: Record<string, string> = {
  可用: "available",
  未验证: "unverified",
  不可用: "unavailable",
};
const CATEGORY: Record<string, string> = {
  编码: "coding",
  检索: "retrieval",
  审视: "review",
  测试: "testing",
};

function uuidFrom(scope: string, legacyId: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(`${scope}:${legacyId}`).digest("hex");
  const variant = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function minutesAgo(now: number, minutes: number): Date {
  return new Date(now - minutes * 60_000);
}

function skillSections(id: string, name: string) {
  return {
    overview: "① 适用场景与前置条件 ② 执行步骤总览 ③ 输入输出约定 ④ 与其他 Skill 的配合",
    steps:
      "1. 载入角色上下文与收敛约束\n2. 按 " +
      name +
      " 标准流程逐步执行，禁止跳步\n3. 每步产物写入 workspace 对应目录\n4. 完成后执行完成验证方案自检",
    examples: `workspace:/skills/${id}/examples/case-01.md（含输入样例与期望产物模板）`,
    scripts: `workspace:/skills/${id}/scripts/usage.md — 脚本参数与调用方式说明`,
    verification: "产物格式校验脚本 + 关键检查单逐项打勾，不通过禁止标记完成",
  };
}

function skillPackageKey(skill: LegacySkill): string {
  return `seed-${skill.id}-${skill.version}.zip`;
}

function skillPackageBody(skill: LegacySkill): string {
  const sections = skillSections(skill.id, skill.name);
  const blocks = [
    `## 适用场景\n\n${sections.overview}`,
    `## 执行步骤\n\n${sections.steps}`,
    `## 示例\n\n${sections.examples}`,
    `## 脚本\n\n${sections.scripts}`,
    `## 完成验证\n\n${sections.verification}`,
  ];
  if (skill.pitfalls.length > 0) {
    blocks.push(`## 常见踩坑\n\n${skill.pitfalls.map((item) => `- ${item}`).join("\n")}`);
  }
  blocks.push(
    "## 参考资料\n\n- 关联 Skill: AB交叉审视\n- 外部规范: 平台接入指南 v2.3",
  );
  return blocks.join("\n\n");
}

function skillPackageFiles(skill: LegacySkill) {
  return [
    {
      path: "references/usage.md",
      data: new TextEncoder().encode(
        `# ${skill.name}\n\n${skill.description}\n\n版本：${skill.version}\n`,
      ),
    },
  ];
}

export type SeedResult = {
  harnesses: number;
  tools: number;
  skills: number;
  experts: number;
  expertSkills: number;
  expertTools: number;
};

/**
 * 写入 UI 夹具对应的演示数据。种子 ID 由 legacy ID 稳定派生，重复执行会覆盖同一批种子行。
 */
export async function seedAll(db: Db, store: FileStore): Promise<SeedResult> {
  const now = Date.now();
  return db.transaction(async (tx) => {
    for (const harness of HARNESSES) {
      const id = uuidFrom("harness", harness.id);
      await tx.query(
        `insert into harness
          (id, name, kind, address, access_mode, description, concurrency_max,
           queue_policy, enabled, health, last_heartbeat_at, revision,
           created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, 1, $11, $11, 'seed', 'seed')
         on conflict (id) do update set
           name = excluded.name, kind = excluded.kind, address = excluded.address,
           access_mode = excluded.access_mode, description = excluded.description,
           concurrency_max = excluded.concurrency_max, queue_policy = excluded.queue_policy,
           health = excluded.health, last_heartbeat_at = excluded.last_heartbeat_at,
           updated_at = excluded.updated_at, updated_by = 'seed'`,
        [
          id,
          harness.name,
          KIND[harness.type]!,
          harness.address,
          ACCESS[harness.accessMode]!,
          harness.desc,
          harness.max,
          harness.queuePolicy,
          HEALTH[harness.health]!,
          minutesAgo(now, harness.heartbeatM),
          new Date(now),
        ],
      );
      await tx.query("delete from harness_tag where harness_id = $1", [id]);
      for (const [position, tag] of harness.tags.entries()) {
        await tx.query(
          "insert into harness_tag (harness_id, position, tag) values ($1, $2, $3)",
          [id, position, tag],
        );
      }
    }

    for (const tool of TOOLS) {
      const id = uuidFrom("tool", tool.id);
      const harnessId = uuidFrom("harness", tool.harness);
      await tx.query(
        `insert into tool
          (id, name, kind, invocation, description, harness_id, timeout_ms, status,
           last_debug_at, revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10, 'seed', 'seed')
         on conflict (id) do update set
           name = excluded.name, kind = excluded.kind, invocation = excluded.invocation,
           description = excluded.description, harness_id = excluded.harness_id,
           timeout_ms = excluded.timeout_ms, status = excluded.status,
           last_debug_at = excluded.last_debug_at, updated_at = excluded.updated_at,
           updated_by = 'seed'`,
        [
          id,
          tool.name,
          TOOL_KIND[tool.type]!,
          tool.invocation,
          tool.desc,
          harnessId,
          tool.timeoutMs,
          TOOL_STATUS[tool.status]!,
          tool.lastDebugM === null ? null : minutesAgo(now, tool.lastDebugM),
          new Date(now),
        ],
      );
      await tx.query("delete from tool_param where tool_id = $1", [id]);
      for (const [position, param] of tool.params.entries()) {
        await tx.query(
          `insert into tool_param (tool_id, position, param_key, param_type, description)
           values ($1, $2, $3, $4, $5)`,
          [id, position, param.k, param.type, param.desc],
        );
      }
    }

    for (const skill of SKILLS) {
      const id = uuidFrom("skill", skill.id);
      const updatedAt = minutesAgo(now, skill.updatedM);
      const packageKey = skillPackageKey(skill);
      const packageBytes = buildSkillPackage({
        name: skill.name,
        description: skill.description,
        version: skill.version,
        body: skillPackageBody(skill),
        files: skillPackageFiles(skill),
      });
      await store.put(`packages/${packageKey}`, packageBytes);
      await tx.query(
        `insert into skill
          (id, name, category_code, description, package_key, version, enabled,
           revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8, 'seed', 'seed')
         on conflict (id) do update set
           name = excluded.name, category_code = excluded.category_code,
           description = excluded.description, package_key = excluded.package_key,
           version = excluded.version, enabled = excluded.enabled,
           updated_at = excluded.updated_at, updated_by = 'seed'`,
        [
          id,
          skill.name,
          CATEGORY[skill.category]!,
          skill.description,
          packageKey,
          skill.version,
          skill.enabled,
          updatedAt,
        ],
      );
      await tx.query("delete from skill_tag where skill_id = $1", [id]);
      for (const [position, tag] of skill.tags.entries()) {
        await tx.query(
          "insert into skill_tag (skill_id, position, tag) values ($1, $2, $3)",
          [id, position, tag],
        );
      }
    }

    let expertSkills = 0;
    let expertTools = 0;
    for (const expert of EXPERTS) {
      const id = uuidFrom("expert", expert.id);
      await tx.query(
        `insert into expert
          (id, name, color, role, enabled, duty, skill_order, verify_order, notes,
           revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10, 'seed', 'seed')
         on conflict (id) do update set
           name = excluded.name, color = excluded.color, role = excluded.role,
           enabled = excluded.enabled, duty = excluded.duty,
           skill_order = excluded.skill_order, verify_order = excluded.verify_order,
           notes = excluded.notes, updated_at = excluded.updated_at,
           updated_by = 'seed'`,
        [
          id,
          expert.name,
          expert.color,
          expert.role,
          expert.enabled,
          expert.duty,
          expert.skillOrder,
          expert.verifyOrder,
          expert.notes,
          new Date(now),
        ],
      );
      await tx.query("delete from expert_persona where expert_id = $1", [id]);
      for (const [position, value] of expert.persona.entries()) {
        await tx.query(
          "insert into expert_persona (expert_id, position, value) values ($1, $2, $3)",
          [id, position, value],
        );
      }
      await tx.query("delete from expert_ref where expert_id = $1", [id]);
      for (const [position, ref] of expert.refs.entries()) {
        await tx.query(
          `insert into expert_ref (expert_id, position, label, ref_type, path)
           values ($1, $2, $3, $4, $5)`,
          [id, position, ref.label, ref.type, null],
        );
      }
      await tx.query("delete from expert_skill where expert_id = $1", [id]);
      let skillPosition = 0;
      for (const rawSkillId of expert.skills) {
        const legacySkillId = SKILL_ALIASES[rawSkillId] ?? rawSkillId;
        await tx.query(
          "insert into expert_skill (expert_id, position, skill_id) values ($1, $2, $3)",
          [id, skillPosition, uuidFrom("skill", legacySkillId)],
        );
        skillPosition += 1;
        expertSkills += 1;
      }
      await tx.query("delete from expert_tool where expert_id = $1", [id]);
      for (const [position, legacyToolId] of expert.tools.entries()) {
        await tx.query(
          "insert into expert_tool (expert_id, position, tool_id) values ($1, $2, $3)",
          [id, position, uuidFrom("tool", legacyToolId)],
        );
        expertTools += 1;
      }
    }

    return {
      harnesses: HARNESSES.length,
      tools: TOOLS.length,
      skills: SKILLS.length,
      experts: EXPERTS.length,
      expertSkills,
      expertTools,
    };
  });
}

if (import.meta.main) {
  const config = await loadConfig();
  await ensureDatabase(config.databaseUrl);
  const db = createDb(config.databaseUrl);
  try {
    const migrator = createMigrator({
      db,
      directory: join(process.cwd(), "db", "migrations"),
    });
    await migrator.up();
    const store = createFileStore(config.skillStorageRoot);
    const result = await seedAll(db, store);
    console.log(
      `种子完成：Harness ${result.harnesses}、工具 ${result.tools}、Skill ${result.skills}、专家 ${result.experts}；关联边 Skill ${result.expertSkills} / 工具 ${result.expertTools}`,
    );
  } finally {
    await db.close();
  }
}
