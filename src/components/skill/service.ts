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
  SkillQuery,
  SkillRead,
  SkillRefInput,
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

function toSummary(row: SkillRootRow, tags: string[], triggers: string[]): SkillSummary {
  return {
    id: row.id,
    name: row.name,
    categoryCode: row.category_code,
    summary: row.summary,
    version: row.version,
    enabled: row.enabled,
    tags,
    triggers,
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

function ensureText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(field, "不能为空");
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  }
  return trimmed;
}

function ensureOptionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  if (value.length > maxLength) throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  return value;
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
  summary: string;
  tags: string[];
  triggers: string[];
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
  const summary = ensureOptionalText(input.summary, "summary", 200);
  if (summary.trim().length === 0) throw new ValidationError("summary", "不能为空");
  const tags = ensureStringList(input.tags, "tags", { unique: true });
  const triggers = ensureStringList(input.triggers, "triggers", { unique: true });
  const sections = ensureSections(input.sections);
  const pitfalls = ensureStringList(input.pitfalls, "pitfalls", { unique: false });
  const refs = ensureRefs(input.refs, "refs");
  return { name, categoryCode, summary, tags, triggers, sections, pitfalls, refs };
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
    triggers: normalized.triggers,
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
            summary: normalized.summary,
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
            summary: normalized.summary,
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

  return {
    async list(query: SkillQuery): Promise<Page<SkillSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      const items: SkillSummary[] = [];
      for (const row of rows) {
        const [tags, triggers] = await Promise.all([
          store.tagsFor(db, row.id),
          store.triggersFor(db, row.id),
        ]);
        items.push(toSummary(row, tags, triggers));
      }
      return { items, total, limit: query.page.limit, offset: query.page.offset };
    },

    async get(id): Promise<SkillDetail> {
      const row = await store.findRoot(db, id);
      if (row === null) throw new NotFoundError("Skill", id);
      const [tags, triggers, sections, pitfalls, refs] = await Promise.all([
        store.tagsFor(db, id),
        store.triggersFor(db, id),
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
        ...toSummary(row, tags, triggers),
        sections: toSections(sections),
        pitfalls,
        refs: refsInput,
        createdAt: toIso(row.created_at),
      };
    },

    async getSummary(id): Promise<SkillSummary> {
      const row = await store.findRoot(db, id);
      if (row === null) throw new NotFoundError("Skill", id);
      const [tags, triggers] = await Promise.all([
        store.tagsFor(db, id),
        store.triggersFor(db, id),
      ]);
      return toSummary(row, tags, triggers);
    },

    async listCategories(): Promise<SkillCategory[]> {
      return store.listCategories(db);
    },
  };
}
