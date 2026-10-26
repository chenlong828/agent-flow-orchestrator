import {
  NameConflictError,
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
  type Clock,
  type IdGenerator,
  type Page,
  type ReferenceGuard,
} from "../../core/kernel/index.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type Db,
} from "../../core/platform/index.ts";
import {
  createSkillStore,
  type SkillChildren,
  type SkillRootRow,
  type SkillRootWrite,
  type SkillSectionRow,
} from "./store.ts";
import type {
  CreateSkill,
  SkillCategory,
  SkillDetail,
  SkillDocument,
  SkillQuery,
  SkillRead,
  SkillRefInput,
  SkillSectionKind,
  SkillSections,
  SkillService,
  SkillSummary,
  UpdateSkill,
} from "./types.ts";

export class CategoryNotFoundError extends ValidationError {
  constructor(categoryCode: string) {
    super("categoryCode", `分类 ${categoryCode} 不存在`);
  }
}

export const SECTION_KINDS = [
  "overview",
  "steps",
  "examples",
  "scripts",
  "verification",
] as const;

export type SkillDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  guard: ReferenceGuard;
  actor: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: SkillRootRow, tags: string[]): SkillSummary {
  return {
    id: row.id,
    name: row.name,
    categoryCode: row.category_code,
    description: row.description,
    version: row.version,
    enabled: row.enabled,
    tags,
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
  };
}

function toSections(rows: SkillSectionRow[]): SkillSections {
  const byKind = new Map(rows.map((row) => [row.kind, row.content_md]));
  const missing = SECTION_KINDS.filter((kind) => !byKind.has(kind));
  if (missing.length > 0) {
    throw new Error(`Skill 章节不完整：缺少 ${missing.join(", ")}`);
  }
  return {
    overview: byKind.get("overview") ?? "",
    steps: byKind.get("steps") ?? "",
    examples: byKind.get("examples") ?? "",
    scripts: byKind.get("scripts") ?? "",
    verification: byKind.get("verification") ?? "",
  };
}

/** 编排面文档的章节标题；属于 API 契约，不随展示端文案变化。 */
const SECTION_LABELS: Record<SkillSectionKind, string> = {
  overview: "流程总述",
  steps: "执行步骤",
  examples: "示例",
  scripts: "脚本",
  verification: "完成验证",
};

function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/** 合成编排面文档：frontmatter + 五章 + 可选踩坑/参考资料；不落库。 */
function composeDocument(detail: SkillDetail): string {
  const lines: string[] = [
    "---",
    `name: ${yamlScalar(detail.name)}`,
    `description: ${yamlScalar(detail.description)}`,
    `version: ${yamlScalar(detail.version)}`,
    "---",
    "",
  ];
  for (const kind of SECTION_KINDS) {
    lines.push(`## ${SECTION_LABELS[kind]}`, "");
    const content = detail.sections[kind].trim();
    if (content !== "") lines.push(content, "");
  }
  if (detail.pitfalls.length > 0) {
    lines.push("## 常见踩坑", "");
    for (const pitfall of detail.pitfalls) lines.push(`- ${pitfall.trim()}`);
    lines.push("");
  }
  if (detail.refs.length > 0) {
    lines.push("## 参考资料", "");
    for (const ref of detail.refs) {
      const suffix = ref.path === undefined || ref.path === "" ? "" : ` — ${ref.path}`;
      lines.push(`- ${ref.label}（${ref.refType}）${suffix}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function ensureText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(field, "不能为空");
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  }
  return trimmed;
}

function ensureEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(field, `必须是 ${allowed.join(" / ")} 之一`);
  }
  return value as T;
}

function ensureStringList(
  value: unknown,
  field: string,
  options: { unique: boolean },
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, "必须是字符串数组");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new ValidationError(field, "必须是字符串数组");
    const trimmed = item.trim();
    if (trimmed.length === 0) throw new ValidationError(field, "元素不能为空");
    if (options.unique) {
      if (seen.has(trimmed)) throw new ValidationError(field, `元素 ${trimmed} 重复`);
      seen.add(trimmed);
    }
    result.push(trimmed);
  }
  return result;
}

function ensureSections(value: unknown): SkillSections {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("sections", "必须是包含五章的对象");
  }
  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter(
    (key) => !(SECTION_KINDS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ValidationError("sections", `未知章节 ${unknownKeys.join(", ")}`);
  }
  const sections = {} as SkillSections;
  for (const kind of SECTION_KINDS) {
    const content = input[kind];
    if (typeof content !== "string") {
      throw new ValidationError(`sections.${kind}`, "必须是字符串且五章齐全");
    }
    sections[kind] = content;
  }
  return sections;
}

function ensureRefs(value: unknown, field: string): { label: string; refType: string; path: string | null }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, "必须是数组");
  return value.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new ValidationError(field, "每个引用必须是对象");
    }
    const input = item as Record<string, unknown>;
    const label = ensureText(input.label, `${field}.${index}.label`, 200);
    const refType = ensureText(input.refType, `${field}.${index}.refType`, 100);
    let path: string | null = null;
    if (input.path !== undefined && input.path !== null) {
      if (typeof input.path !== "string") {
        throw new ValidationError(`${field}.${index}.path`, "必须是字符串或 null");
      }
      path = input.path;
    }
    return { label, refType, path };
  });
}

type NormalizedWrite = {
  name: string;
  categoryCode: string;
  description: string;
  tags: string[];
  sections: SkillSections;
  pitfalls: string[];
  refs: { label: string; refType: string; path: string | null }[];
  enabled?: boolean;
};

function normalizeWrite(input: CreateSkill): NormalizedWrite {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const name = ensureText(input.name, "name", 80);
  const categoryCode = ensureText(input.categoryCode, "categoryCode", 50);
  const description = ensureText(input.description, "description", 400);
  const tags = ensureStringList(input.tags, "tags", { unique: true });
  const sections = ensureSections(input.sections);
  const pitfalls = ensureStringList(input.pitfalls, "pitfalls", { unique: false });
  const refs = ensureRefs(input.refs, "refs");
  return { name, categoryCode, description, tags, sections, pitfalls, refs };
}

function enabledFrom(input: CreateSkill): boolean {
  if (input.enabled === undefined) return true;
  if (typeof input.enabled !== "boolean") {
    throw new ValidationError("enabled", "必须是布尔值");
  }
  return input.enabled;
}

function nextVersion(version: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (match === null) throw new Error(`Skill 版本格式不合法：${version}`);
  let major = Number(match[1]);
  let minor = Number(match[2]) + 1;
  if (minor > 9) {
    major += 1;
    minor = 0;
  }
  return `v${major}.${minor}`;
}

function toChildren(normalized: NormalizedWrite): SkillChildren {
  return {
    tags: normalized.tags,
    sections: SECTION_KINDS.map((kind) => ({
      kind,
      content: normalized.sections[kind],
    })),
    pitfalls: normalized.pitfalls,
    refs: normalized.refs,
  };
}

export function createSkillService(deps: SkillDeps): SkillService {
  const { db, clock, ids, guard, actor } = deps;
  const store = createSkillStore(db);

  return {
    async create(input, requestActor) {
      const normalized = normalizeWrite(input);
      const enabled = enabledFrom(input);
      const id = ids.next();
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        await db.transaction(async (tx) => {
          if (!(await store.categoryExists(tx, normalized.categoryCode))) {
            throw new CategoryNotFoundError(normalized.categoryCode);
          }
          const write: SkillRootWrite = {
            id,
            name: normalized.name,
            categoryCode: normalized.categoryCode,
            description: normalized.description,
            version: "v1.0",
            enabled,
            now,
            actor: actorValue,
          };
          await store.insertRoot(tx, write);
          await store.replaceChildren(tx, id, toChildren(normalized));
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        if (isForeignKeyViolation(error)) {
          throw new CategoryNotFoundError(normalized.categoryCode);
        }
        throw error;
      }
      return { id, revision: 1, version: "v1.0" };
    },

    async update(id, revision, input, requestActor) {
      const normalized = normalizeWrite(input);
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        return await db.transaction(async (tx) => {
          const current = await store.findRoot(tx, id, true);
          if (current === null) throw new NotFoundError("Skill", id);
          if (current.revision !== revision) {
            throw new RevisionConflictError(current.revision);
          }
          if (!(await store.categoryExists(tx, normalized.categoryCode))) {
            throw new CategoryNotFoundError(normalized.categoryCode);
          }
          const version = nextVersion(current.version);
          const changed = await store.updateRoot(tx, {
            id,
            name: normalized.name,
            categoryCode: normalized.categoryCode,
            description: normalized.description,
            version,
            revision,
            now,
            actor: actorValue,
          });
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            throw new RevisionConflictError(latest?.revision ?? revision);
          }
          await store.replaceChildren(tx, id, toChildren(normalized));
          return { id, revision: revision + 1, version };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        if (isForeignKeyViolation(error)) {
          throw new CategoryNotFoundError(normalized.categoryCode);
        }
        throw error;
      }
    },

    async setEnabled(id, revision, enabled, requestActor) {
      if (typeof enabled !== "boolean") {
        throw new ValidationError("enabled", "必须是布尔值");
      }
      const now = clock.now();
      return db.transaction(async (tx) => {
        const changed = await store.setEnabled(
          tx,
          id,
          revision,
          enabled,
          now,
          requestActor ?? actor,
        );
        if (changed === 0) {
          const latest = await store.findRoot(tx, id);
          if (latest === null) throw new NotFoundError("Skill", id);
          throw new RevisionConflictError(latest.revision);
        }
        return { id, revision: revision + 1 };
      });
    },

    async delete(id, revision) {
      const current = await store.findRoot(db, id);
      if (current === null) throw new NotFoundError("Skill", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);

      const references = await guard.check("skill", id);
      if (references.length > 0) {
        throw new ReferencedError({ type: "skill", id, name: current.name }, references);
      }
      try {
        await db.transaction(async (tx) => {
          const changed = await store.deleteRoot(tx, id, revision);
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            if (latest === null) throw new NotFoundError("Skill", id);
            throw new RevisionConflictError(latest.revision);
          }
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          const latestReferences = await guard.check("skill", id);
          throw new ReferencedError(
            { type: "skill", id, name: current.name },
            latestReferences,
          );
        }
        throw error;
      }
    },
  };
}

export function createSkillRead(deps: { db: Db }): SkillRead {
  const { db } = deps;
  const store = createSkillStore(db);

  async function readDetail(id: string): Promise<SkillDetail> {
    const row = await store.findRoot(db, id);
    if (row === null) throw new NotFoundError("Skill", id);
    const [tags, sections, pitfalls, refs] = await Promise.all([
      store.tagsFor(db, id),
      store.sectionsFor(db, id),
      store.pitfallsFor(db, id),
      store.refsFor(db, id),
    ]);
    const refsInput: SkillRefInput[] = refs.map((ref) => ({
      label: ref.label,
      refType: ref.ref_type,
      path: ref.path ?? undefined,
    }));
    return {
      ...toSummary(row, tags),
      sections: toSections(sections),
      pitfalls,
      refs: refsInput,
      createdAt: toIso(row.created_at),
    };
  }

  return {
    async list(query: SkillQuery): Promise<Page<SkillSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      const items: SkillSummary[] = [];
      for (const row of rows) {
        items.push(toSummary(row, await store.tagsFor(db, row.id)));
      }
      return { items, total, limit: query.page.limit, offset: query.page.offset };
    },

    get(id): Promise<SkillDetail> {
      return readDetail(id);
    },

    async getSummary(id): Promise<SkillSummary> {
      const row = await store.findRoot(db, id);
      if (row === null) throw new NotFoundError("Skill", id);
      return toSummary(row, await store.tagsFor(db, id));
    },

    async getDocument(id): Promise<SkillDocument> {
      const detail = await readDetail(id);
      return { markdown: composeDocument(detail), revision: detail.revision };
    },

    async listCategories(): Promise<SkillCategory[]> {
      return store.listCategories(db);
    },
  };
}
