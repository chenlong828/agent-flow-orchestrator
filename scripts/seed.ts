import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createDb, createFileStore, createMigrator, ensureDatabase } from "../src/core/platform/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import type { Db } from "../src/core/platform/index.ts";
import type { FileStore } from "../src/core/kernel/index.ts";
import { buildSkillPackage, parseSkillMarkdown } from "../src/components/skill/package.ts";
import { sha256Hex } from "../src/components/skill/digest.ts";
import type { WorkflowGraph, WorkflowNode } from "../src/components/workflow/index.ts";

type SkillSeed = {
  /** DSH 技能名（kebab-case），同时是 `scripts/seed-skills/<slug>/` 的目录名与包内 frontmatter 的 name。 */
  slug: string;
  /** 控制面展示名。 */
  name: string;
  category: string;
  tags: string[];
  enabled: boolean;
  updatedM: number;
};

type ExpertSeed = {
  id: string;
  name: string;
  color: string;
  role: string;
  persona: string[];
  skills: string[];
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  refs: { label: string; type: string }[];
  enabled: boolean;
};

type WorkflowSeed = {
  id: string;
  name: string;
  type: string;
  description: string;
  graph: WorkflowGraph;
};

/**
 * 技能内容在 `scripts/seed-skills/<slug>/`，frontmatter 的 name/description/version 即包内元数据。
 * 只放有真实出处的内容：前五个来自 `~/skills/af-dev-skill`；`workflow-init` 与 `review-verdict`
 * 是流程必需、由本项目新写的技能，首次落地时单独说明。
 */
const SKILLS: SkillSeed[] = [
  { slug: "workflow-init", name: "工作流初始化", category: "process", tags: ["初始化", "诉求落盘"], enabled: true, updatedM: 30 },
  { slug: "req-scenario-spec", name: "需求到场景", category: "process", tags: ["需求", "场景", "验收"], enabled: true, updatedM: 60 },
  { slug: "design-before-coding", name: "先设计后编码", category: "process", tags: ["设计", "组件"], enabled: true, updatedM: 90 },
  { slug: "arch-design-spec", name: "架构设计规格", category: "process", tags: ["架构", "契约", "定级"], enabled: true, updatedM: 120 },
  { slug: "dev-execution-spec", name: "开发执行纪律", category: "coding", tags: ["执行", "验收", "提交"], enabled: true, updatedM: 150 },
  { slug: "doc-layout-spec", name: "文档布局", category: "docs", tags: ["文档", "目录"], enabled: true, updatedM: 180 },
  { slug: "task-split", name: "任务拆分", category: "process", tags: ["拆分", "任务表", "依赖"], enabled: true, updatedM: 195 },
  { slug: "scenario-verify", name: "场景验证", category: "testing", tags: ["场景", "3+1", "验收"], enabled: true, updatedM: 200 },
  { slug: "implementation-accept", name: "实现鉴定", category: "review", tags: ["鉴定", "准出", "证据"], enabled: true, updatedM: 205 },
  { slug: "review-verdict", name: "审核判定", category: "review", tags: ["审核", "verdict"], enabled: true, updatedM: 210 },
  { slug: "af-flow-rule", name: "AF 流程公共规则", category: "process", tags: ["公共规则", "证据分级", "人工门", "越权"], enabled: true, updatedM: 340 },
  { slug: "swift-ui-probe", name: "Swift 界面探针", category: "testing", tags: ["截图", "界面", "观察", "macOS"], enabled: true, updatedM: 350 },
  { slug: "auto-confirm", name: "无人值守自动确认", category: "process", tags: ["自动确认", "无人值守", "默认值"], enabled: true, updatedM: 360 },
  { slug: "workspace-scan", name: "工作区扫描", category: "process", tags: ["工作区", "扫描", "检查方案"], enabled: true, updatedM: 380 },
  { slug: "js-backend-code-review", name: "JS 后端代码检查", category: "review", tags: ["代码检查", "质量门禁", "JS 后端"], enabled: true, updatedM: 390 },
];

const EXPERTS: ExpertSeed[] = [
  {
    id: "start-node", name: "启动节点", color: "#64748b",
    role: "工作流的第一个节点，只做运行初始化与诉求落盘",
    persona: ["克制"],
    skills: ["workflow-init"],
    duty: "把本次运行的诉求原文写入 task-space 的 intent.md，确认目录可写；不展开业务工作",
    skillOrder: "工作流初始化",
    verifyOrder: "intent.md 与诉求原文一致 → 未写出 task-space",
    notes: "不解读、不摘要诉求；不创建后续节点才该产出的文件",
    refs: [], enabled: true,
  },
  {
    id: "req-analyst", name: "需求分析专家", color: "#2563eb",
    role: "把一句话诉求澄清成可实施的需求卡、场景与任务表",
    persona: ["严谨", "刨根问底"],
    skills: ["req-scenario-spec", "doc-layout-spec", "af-flow-rule", "auto-confirm"],
    duty: "读 intent.md，产出需求卡与场景卡，明确范围与非目标后交给设计",
    skillOrder: "需求到场景 → 文档布局",
    verifyOrder: "每条需求有验收场景 → 场景四元素齐 → 文档就位",
    notes: "追问到可实施粒度；不为「以后可能需要」扩大范围；不自签确认记录、不替人拍板；无人值守时按推荐/默认自动确认并继续，记录「默认确认（未经人工）」，不停下等待",
    refs: [], enabled: true,
  },
  {
    id: "solution-designer", name: "方案设计专家", color: "#7c3aed",
    role: "在现状基线上给出组件级修改方案与取舍",
    persona: ["全局观", "谨慎"],
    skills: ["design-before-coding", "arch-design-spec", "doc-layout-spec", "af-flow-rule", "auto-confirm"],
    duty: "读需求产物，输出组件与契约层面的方案、候选与否决理由，标出未决问题",
    skillOrder: "先设计后编码 → 文档布局",
    verifyOrder: "组件定位清楚 → 契约变更写明 → 未决问题列全",
    notes: "不为臆想需求预付抽象；结论必须落到文件；不自我批准——方案评审由评审节点做；无人值守时按推荐/默认自动确认并记录「默认确认（未经人工）」，不停下等待",
    refs: [], enabled: true,
  },
  {
    id: "arch-reviewer", name: "架构评审专家", color: "#dc2626",
    role: "以否决视角审查方案的结构、契约与改动级别",
    persona: ["独立", "否决视角"],
    skills: ["arch-design-spec", "review-verdict", "af-flow-rule", "auto-confirm"],
    duty: "按架构规格核验方案的切分、依赖、契约与 P 级，给出 pass/fail 与可执行理由；把评审报告与 verdict 依据写进 task-space 的 review.md",
    skillOrder: "架构设计规格 → 审核判定",
    verifyOrder: "模块地图与依赖矩阵齐全 → 契约不泄漏实现 → 定级与确认门一致 → review.md 与 verdict 一致",
    notes: "证据不足视为 fail；评审上下文与被评审隔离；只判定，不改仓库状态位、不改设计产物、不代写确认记录；verdict 按 review-verdict 技能调用 mcp__agentflow__signal 提交，不要只在正文写结论",
    refs: [], enabled: true,
  },
  {
    id: "task-splitter", name: "任务拆分专家", color: "#0891b2",
    role: "把已评审的设计转成可独立交付的开发任务",
    persona: ["结构化", "依赖敏感"],
    skills: ["task-split", "doc-layout-spec", "af-flow-rule", "auto-confirm"],
    duty: "输入：需求卡、场景卡、组件规格与评审结论；输出：任务表（ID/类型/组件/依赖/出口）与并行关系，写入项目 doc/plan/roadmap.md",
    skillOrder: "任务拆分 → 文档布局",
    verifyOrder: "每个任务能指到组件规格 → 依赖无环 → 出口可检查 → 已落表 roadmap",
    notes: "不写实现细节、不改代码；设计不足回退设计，不硬拆；一个任务对应一次可提交的改动；无人值守时按推荐/默认自动确认门并记录「默认确认（未经人工）」；不伪造人确认",
    refs: [], enabled: true,
  },
  {
    id: "implementer", name: "开发实现专家", color: "#16a34a",
    role: "按已定方案完成代码、测试与提交",
    persona: ["规范控", "小步"],
    skills: ["dev-execution-spec", "doc-layout-spec", "af-flow-rule", "js-backend-code-review", "swift-ui-probe", "auto-confirm"],
    duty: "在 workspace 内按方案实现并自测，提交前运行 precheck 自检，提交绑定任务与场景；把改动、commit、测试命令与 precheck 结果写进 task-space 的 dev.md，验收证据（命令输出、Outbox 行、MIME 头、AX 字段值等，脱敏后）写进 evidence/；发现方案冲突先停下来更新方案",
    skillOrder: "开发执行纪律 → 文档布局 → JS 后端检查",
    verifyOrder: "逐条核对任务出口 → 测试先红后绿 → 提交前 precheck 无 FAIL → git status 干净 → commit 一件事 → dev.md 记录 commit、测试结果与建议状态",
    notes: "不顺手重构；不夹带无关改动；只写 dev.md 与 evidence/，不改 result.md；不得把场景标 verified、需求标 delivered（只在 dev.md 写「建议翻转」，由收尾在评审通过后执行）；precheck 的 ERROR 不当通过，不为了变绿改阈值；人工门无人值守时按推荐/默认自动确认并记录「默认确认（未经人工）」，不停下等待；不得伪造“发起人确认”，不可逆/破坏性操作仍停",
    refs: [], enabled: true,
  },
  {
    id: "code-reviewer", name: "评审专家", color: "#ea580c",
    role: "以独立、否决视角对实现产物做准出评审",
    persona: ["细致", "多疑"],
    skills: ["review-verdict", "js-backend-code-review", "af-flow-rule", "swift-ui-probe", "auto-confirm"],
    duty: "先运行 precheck（本次改动），再运行 report 并按 JS 判断清单逐项核对；对照方案与规范审视代码与产物，给出 pass/fail 与可执行意见；把机器报告摘要、判断清单证据、verdict 依据与「状态翻转清单」（哪些场景可转 verified、哪个需求可转 delivered、哪个任务可标完成）写进 task-space 的 review.md",
    skillOrder: "审核判定 → JS 后端检查",
    verifyOrder: "precheck 无 FAIL → report 无 ERROR 与新增 FAIL → 判断清单每项有证据位置 → 验收证据在 task-space 内可复核（缺证据按 fail）→ review.md 与 verdict 一致",
    notes: "不读执行过程独白，只看产物与方案；机器报告是证据，不替代 review-verdict 裁决，也不为了变绿改阈值；只判定，不改产品代码与测试、不改设计产物、不代写确认记录，状态翻转由收尾在评审通过后执行；verdict 按 review-verdict 技能调用 mcp__agentflow__signal 提交，不要只在正文写结论",
    refs: [], enabled: true,
  },
  {
    id: "accept-reviewer", name: "实现鉴定专家", color: "#a21caf",
    role: "判定本次实现是否真正走完",
    persona: ["怀疑", "证据导向"],
    skills: ["implementation-accept", "review-verdict", "doc-layout-spec", "af-flow-rule", "swift-ui-probe", "auto-confirm"],
    duty: "输入：场景卡 3 正 1 反、test.md 与 evidence/、实现提交；输出：pass/fail 结论；fail 时写明回退到哪个实现节点、改什么、怎么复现",
    skillOrder: "实现鉴定 → 审核判定 → 文档布局",
    verifyOrder: "每条例子有结果 → 证据可复核 → 依赖场景无回归 → 提交卫生 → 结论与证据一致",
    notes: "不替开发改代码、不补证据、不代写确认记录；不默认放行；fail 必须给回退目标与复现步骤；只判定不改状态",
    refs: [], enabled: true,
  },
  {
    id: "test-verifier", name: "测试验证专家", color: "#0d9488",
    role: "把验收场景落成可执行用例并给出证据",
    persona: ["挑剔", "数据敏感"],
    skills: ["scenario-verify", "doc-layout-spec", "af-flow-rule", "swift-ui-probe", "auto-confirm"],
    duty: "输入：场景卡 3 正 1 反例子与可执行 ID、实现提交；输出：逐例验证结果 test.md + evidence/；例子缺测试时补 Tests/（不改产品代码）",
    skillOrder: "场景验证 → 文档布局",
    verifyOrder: "3+1 逐条有结果 → 依赖场景回归 → 证据可在 task-space 复核",
    notes: "不改产品代码、不翻转状态；环境不可用标阻塞，不伪造；失败必须给复现步骤",
    refs: [], enabled: true,
  },
  {
    id: "summarizer", name: "收尾专家", color: "#475569",
    role: "汇总本次运行产物，给出可追溯的最终结论",
    persona: ["克制"],
    skills: ["doc-layout-spec"],
    duty: "读取 task-space 记录（intent 与各节点产物）汇总成 result.md；评审 pass 时按 review.md 的状态翻转清单修改项目文档状态位（场景 verified、需求 delivered、roadmap 任务标完成）并提交一次收口 commit；评审 fail 时只汇总、不改状态",
    skillOrder: "文档布局",
    verifyOrder: "只翻转 review pass 明确列出的项 → 收口 commit 只含状态位与证据行 → git status 干净",
    notes: "不改代码与设计正文；不做二次验证：不跑测试、不跑构建；fail 时不翻转任何状态；只读 dev.md、review.md 与 intent.md，不覆盖它们；不把没写在 task-space 里的东西写成结论；不新增范围、不掩盖失败",
    refs: [], enabled: true,
  },
  {
    id: "workspace-start", name: "工作区启动", color: "#475569",
    role: "工作区接入与启动：诉求落盘、扫描工作区、判断是否就绪",
    persona: ["克制", "守门"],
    skills: ["workflow-init", "workspace-scan", "af-flow-rule", "auto-confirm"],
    duty: "把本次诉求原文写入 task-space 的 intent.md；运行 workspace scan 与 doctor，报告技术栈、启用的检查方案与漂移；未初始化或漂移时阻断，并指向 WORKSPACE-01，不自动改配置",
    skillOrder: "工作流初始化 → 工作区扫描",
    verifyOrder: "intent.md 与诉求原文一致 → scan/doctor 有输出 → 未就绪时明确阻断并给出下一步",
    notes: "不解读诉求；不写 .workspace 配置；不跑代码检查；缺工具或漂移只报告，不自行修",
    refs: [], enabled: true,
  },
  {
    id: "workspace-manager-js", name: "工作区接入专家（JS）", color: "#0f766e",
    role: "JS/TS 项目的首次接入与校准：扫描、发现检查方案、落盘 profile/基线/工具",
    persona: ["严谨", "可追溯"],
    skills: ["workspace-scan", "js-backend-code-review", "doc-layout-spec", "af-flow-rule", "auto-confirm"],
    duty: "运行 scan/discover；与用户确认启用的检查方案；执行各方案 init、tools install、baseline，必要时 calibrate；把 profile revision、工具版本、基线与理由写入 task-space，并提交只含状态文件的 commit",
    skillOrder: "工作区扫描 → JS 后端检查",
    verifyOrder: "启用的方案与确认一致 → profile 有 revision 与理由 → 工具可解析 → 基线已采集 → 变更已提交",
    notes: "不改产品代码与测试；阈值、豁免、基线变更必须人工确认并记录前后数据；不把工具缓存提交进仓库",
    refs: [], enabled: true,
  },
  // 按项目/技术栈会有多个接入专家：workspace-manager-js / workspace-manager-java / workspace-manager-vue。
  // 每个只挂对应检查方案，WORKSPACE-01 的 n3 按项目替换，避免把全部语言技能塞进一个专家。
  {
    id: "workspace-end", name: "工作区收尾", color: "#334155",
    role: "工作区接入的收尾：核对状态文件与提交，输出结论",
    persona: ["简洁", "对账"],
    skills: ["doc-layout-spec", "af-flow-rule"],
    duty: "核对 .workspace 状态文件与 commit；把启用方案、profile revision、工具版本与未决问题写入本工序的 result 摘要；不重复初始化",
    skillOrder: "文档布局",
    verifyOrder: "状态文件齐全 → commit 只含状态文件 → 结论与证据一致",
    notes: "不改规则与阈值；不跑检查；不覆盖 manager 的记录",
    refs: [], enabled: true,
  },
];

/** 流程节点：`expertId` 传 null 表示人工节点（confirm），不绑专家。 */
function flowNode(
  id: string,
  name: string,
  type: WorkflowNode["type"],
  expertId: string | null,
  x: number,
  y: number,
): WorkflowNode {
  return {
    id,
    name,
    type,
    stageId: null,
    expertId: expertId === null ? null : uuidFrom("expert", expertId),
    layout: { x, y },
  };
}

/** 10 节点研发流程：启动 → 需求 → 方案 → 方案评审 → 任务拆分 → 实现 → 代码评审 → 测试 → 实现鉴定 → 收尾。 */
function devFlowGraph(): WorkflowGraph {
  const node = flowNode;
  return {
    stages: [],
    nodes: [
      node("n1", "启动", "start", "start-node", 0, 0),
      node("n2", "需求", "agent", "req-analyst", 160, 0),
      node("n3", "方案", "agent", "solution-designer", 320, 0),
      node("n4", "方案评审", "review", "arch-reviewer", 480, 0),
      node("n9", "任务拆分", "agent", "task-splitter", 560, 0),
      node("n5", "实现", "agent", "implementer", 640, 0),
      node("n6", "代码评审", "review", "code-reviewer", 800, 0),
      node("n7", "测试", "agent", "test-verifier", 960, 0),
      node("n10", "实现鉴定", "review", "accept-reviewer", 1040, 0),
      node("n8", "收尾", "end", "summarizer", 1120, 0),
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
      { id: "e3", from: "n3", to: "n4", kind: "seq" },
      { id: "e4", from: "n4", to: "n9", kind: "seq" },
      { id: "e10", from: "n9", to: "n5", kind: "seq" },
      { id: "e5", from: "n5", to: "n6", kind: "seq" },
      { id: "e6", from: "n6", to: "n7", kind: "seq" },
      { id: "e7", from: "n7", to: "n10", kind: "seq" },
      { id: "e11", from: "n10", to: "n8", kind: "seq" },
      { id: "e8", from: "n4", to: "n3", kind: "rollback" },
      { id: "e9", from: "n6", to: "n5", kind: "rollback" },
      { id: "e12", from: "n10", to: "n5", kind: "rollback" },
    ],
  };
}

/** 实现阶段流程：设计已冻结时使用，先过人工审核门，再开发与代码评审。 */
function implementFlowGraph(): WorkflowGraph {
  return {
    stages: [],
    nodes: [
      flowNode("n1", "启动", "start", "start-node", 0, 0),
      flowNode("n2", "审核（人工确认设计可开发）", "confirm", null, 160, 0),
      flowNode("n3", "开发", "agent", "implementer", 320, 0),
      flowNode("n4", "代码评审", "review", "code-reviewer", 480, 0),
      flowNode("n5", "收尾", "end", "summarizer", 640, 0),
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
      { id: "e3", from: "n3", to: "n4", kind: "seq" },
      { id: "e4", from: "n4", to: "n5", kind: "seq" },
      { id: "e5", from: "n4", to: "n3", kind: "rollback" },
    ],
  };
}

/** 工作区接入流程：扫描 → 确认范围 → 初始化/校准 → 确认配置 → 收尾提交。 */
function workspaceFlowGraph(): WorkflowGraph {
  return {
    stages: [],
    nodes: [
      flowNode("n1", "启动", "start", "workspace-start", 0, 0),
      flowNode("n2", "确认接入范围", "confirm", null, 160, 0),
      flowNode("n3", "接入与校准", "agent", "workspace-manager-js", 320, 0),
      flowNode("n4", "确认配置", "confirm", null, 480, 0),
      flowNode("n5", "收尾", "end", "workspace-end", 640, 0),
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
      { id: "e3", from: "n3", to: "n4", kind: "seq" },
      { id: "e4", from: "n4", to: "n5", kind: "seq" },
      { id: "e5", from: "n4", to: "n3", kind: "rollback" },
    ],
  };
}

const WORKFLOWS: WorkflowSeed[] = [
  {
    id: "dev-flow-01",
    name: "TRUN-DEV-01",
    type: "研发",
    description: "af-dev-flow 雏形：需求 → 方案 → 方案评审 → 任务拆分 → 实现 → 代码评审 → 测试 → 实现鉴定 → 收尾；方案评审回退到方案，代码评审与实现鉴定回退到实现",
    graph: devFlowGraph(),
  },
  {
    id: "dev-flow-02",
    name: "TRUN-DEV-02",
    type: "研发",
    description: "实现阶段：启动 → 人工审核（P1 门）→ 开发 → 代码评审 → 收尾；代码评审回退到开发",
    graph: implementFlowGraph(),
  },
  {
    id: "workspace-flow-01",
    name: "WORKSPACE-01",
    type: "工作区",
    description: "工作区接入：启动扫描 → 确认范围 → 初始化/校准（n3 按项目替换为对应 workspace-manager 专家）→ 确认配置 → 收尾提交；配置不通过时回到接入节点",
    graph: workspaceFlowGraph(),
  },
];

const SKILLS_DIR = join(import.meta.dir, "seed-skills");

function uuidFrom(scope: string, legacyId: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(`${scope}:${legacyId}`).digest("hex");
  const variant = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function minutesAgo(now: number, minutes: number): Date {
  return new Date(now - minutes * 60_000);
}

/** 读取 `scripts/seed-skills/<slug>/`：SKILL.md 提供元数据与正文，references/、scripts/ 作为附件。 */
async function buildPackageFor(
  slug: string,
): Promise<{ bytes: Uint8Array; version: string; description: string }> {
  const directory = join(SKILLS_DIR, slug);
  const parsed = parseSkillMarkdown(await Bun.file(join(directory, "SKILL.md")).text());
  const files: { path: string; data: Uint8Array }[] = [];
  for (const folder of ["references", "scripts"]) {
    for (const entry of await readdir(join(directory, folder), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      files.push({
        path: `${folder}/${entry.name}`,
        data: await Bun.file(join(directory, folder, entry.name)).bytes(),
      });
    }
  }
  const bytes = buildSkillPackage({
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    body: parsed.body,
    files,
  });
  return { bytes, version: parsed.version, description: parsed.description };
}

function packageKeyFor(slug: string, version: string): string {
  return `seed-${slug}-${version}.zip`;
}

export type SeedResult = {
  skills: number;
  experts: number;
  workflows: number;
  expertSkills: number;
};

/**
 * 写入演示数据：只含技能、专家与流程。
 * Harness 由 client 首次 poll 自注册；不预置工具，也不把任何未经验证的工具装配到专家。
 * 种子 ID 由 legacy ID 稳定派生，重复执行覆盖同一批种子行。
 */
export async function seedAll(db: Db, store: FileStore): Promise<SeedResult> {
  const now = Date.now();
  return db.transaction(async (tx) => {
    for (const skill of SKILLS) {
      const id = uuidFrom("skill", skill.slug);
      const updatedAt = minutesAgo(now, skill.updatedM);
      const built = await buildPackageFor(skill.slug);
      const packageKey = packageKeyFor(skill.slug, built.version);
      const packageDigest = sha256Hex(built.bytes);
      await store.put(`packages/${packageKey}`, built.bytes);
      await tx.query(
        `insert into skill
          (id, name, slug, category_code, description, package_key, package_digest, package_size,
           version, enabled, revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $11, 'seed', 'seed')
         on conflict (id) do update set
           name = excluded.name, slug = excluded.slug, category_code = excluded.category_code,
           description = excluded.description, package_key = excluded.package_key,
           package_digest = excluded.package_digest, package_size = excluded.package_size,
           version = excluded.version, enabled = excluded.enabled,
           updated_at = excluded.updated_at, updated_by = 'seed'`,
        [
          id,
          skill.name,
          skill.slug,
          skill.category,
          built.description,
          packageKey,
          packageDigest,
          built.bytes.byteLength,
          built.version,
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
      for (const slug of expert.skills) {
        await tx.query(
          "insert into expert_skill (expert_id, position, skill_id) values ($1, $2, $3)",
          [id, skillPosition, uuidFrom("skill", slug)],
        );
        skillPosition += 1;
        expertSkills += 1;
      }
    }

    // 流程只在库中不存在时创建：用户会在界面上改名、改图，种子不得覆盖已有流程，
    // 否则每次更新专家/技能后重跑种子都会把流程重置回种子里的样子。
    for (const workflow of WORKFLOWS) {
      const id = uuidFrom("workflow", workflow.id);
      const existing = await tx.one<{ id: string }>("select id from workflow where id = $1", [id]);
      if (existing !== null) {
        console.log(`跳过已存在的流程：${workflow.name}（保留界面上的改名与改图）`);
        continue;
      }
      await tx.query(
        `insert into workflow
          (id, name, type, description, revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, 1, $5, $5, 'seed', 'seed')`,
        [id, workflow.name, workflow.type, workflow.description, new Date(now)],
      );
      await tx.query(
        `insert into workflow_definition (workflow_id, graph, updated_at, updated_by)
         values ($1, $2::text::jsonb, $3, 'seed')`,
        [id, JSON.stringify(workflow.graph), new Date(now)],
      );
      for (const node of workflow.graph.nodes) {
        if (node.expertId === null) continue;
        await tx.query(
          "insert into workflow_expert_ref (workflow_id, node_id, expert_id) values ($1, $2, $3)",
          [id, node.id, node.expertId],
        );
      }
    }

    return {
      skills: SKILLS.length,
      experts: EXPERTS.length,
      workflows: WORKFLOWS.length,
      expertSkills,
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
      `种子完成：Skill ${result.skills}、专家 ${result.experts}、流程 ${result.workflows}；专家技能装配 ${result.expertSkills} 条（不预置 Harness/工具）`,
    );
  } finally {
    await db.close();
  }
}
