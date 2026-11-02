import {
  NotFoundError,
  PackageUnavailableError,
  escapeLike,
  toIso,
  type FileStore,
  type Page,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import {
  parseSkillMarkdown,
  readSkillPackage,
  type SkillPackageEntry,
} from "./package.ts";
import type {
  SkillCategory,
  SkillDetail,
  SkillDocument,
  SkillFile,
  SkillPackage,
  SkillQuery,
  SkillRead,
  SkillSummary,
} from "./contract.ts";

type SkillRow = {
  id: string;
  name: string;
  category_code: string;
  description: string;
  package_key: string;
  version: string;
  enabled: boolean;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PackageContents = {
  row: SkillRow;
  data: Uint8Array;
  entries: SkillPackageEntry[];
};

type SkillReadContext = {
  db: Db;
  store: FileStore;
};

function buildFilters(query: SkillQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.q !== undefined && query.q !== "") {
    params.push(`%${escapeLike(query.q)}%`);
    clauses.push(
      `(s.name ilike $${params.length} escape '\\' or s.description ilike $${params.length} escape '\\')`,
    );
  }
  if (query.categoryCode !== undefined) {
    params.push(query.categoryCode);
    clauses.push(`s.category_code = $${params.length}`);
  }
  if (query.enabled !== undefined) {
    params.push(query.enabled);
    clauses.push(`s.enabled = $${params.length}`);
  }
  if (query.tag !== undefined) {
    params.push(query.tag);
    clauses.push(
      `exists (select 1 from skill_tag st where st.skill_id = s.id and st.tag = $${params.length})`,
    );
  }
  return {
    where: clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`,
    params,
  };
}

function orderBy(sort: SkillQuery["sort"]): string {
  const versionAsc =
    "order by split_part(substr(s.version, 2), '.', 1)::int asc, split_part(substr(s.version, 2), '.', 2)::int asc, s.id asc";
  const versionDesc =
    "order by split_part(substr(s.version, 2), '.', 1)::int desc, split_part(substr(s.version, 2), '.', 2)::int desc, s.id asc";
  switch (sort) {
    case "name":
      return "order by lower(s.name) asc, s.id asc";
    case "-name":
      return "order by lower(s.name) desc, s.id asc";
    case "updatedAt":
      return "order by s.updated_at asc, s.id asc";
    case "version":
      return versionAsc;
    case "-version":
      return versionDesc;
    case "-updatedAt":
    case undefined:
      return "order by s.updated_at desc, s.id asc";
  }
}

function sanitizeFileName(name: string, version: string): string {
  const safeName = name.replace(/["\\/\r\n]/g, "_").trim() || "skill";
  return `${safeName}-${version}.zip`;
}

function toFiles(entries: SkillPackageEntry[]): SkillFile[] {
  return entries.map((entry) => ({
    path: entry.path,
    size: entry.data.byteLength,
    readOnly: true,
  }));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function createSkillRead(db: Db, store: FileStore): SkillRead {
  const ctx: SkillReadContext = { db, store };
  return {
    list: (query) => listSkills(ctx, query),
    get: (id) => getSkill(ctx, id),
    getSummary: (id) => getSkillSummary(ctx, id),
    getDocument: (id) => getSkillDocument(ctx, id),
    getPackage: (id) => getSkillPackage(ctx, id),
    listCategories: () => listCategories(ctx),
  };
}

async function findRow(ctx: SkillReadContext, id: string): Promise<SkillRow | null> {
  return ctx.db.one<SkillRow>(
    `select id, name, category_code, description, package_key, version,
            enabled, revision, created_at, updated_at
     from skill where id = $1`,
    [id],
  );
}

async function tagsFor(ctx: SkillReadContext, id: string): Promise<string[]> {
  const rows = await ctx.db.query<{ tag: string }>(
    "select tag from skill_tag where skill_id = $1 order by position asc",
    [id],
  );
  return rows.map((row) => row.tag);
}

async function toSummary(ctx: SkillReadContext, row: SkillRow): Promise<SkillSummary> {
  return {
    id: row.id,
    name: row.name,
    categoryCode: row.category_code,
    description: row.description,
    version: row.version,
    enabled: row.enabled,
    tags: await tagsFor(ctx, row.id),
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
  };
}

async function readPackage(
  ctx: SkillReadContext,
  row: SkillRow,
): Promise<PackageContents> {
  try {
    const data = await readAll(await ctx.store.get(`packages/${row.package_key}`));
    const entries = readSkillPackage(data);
    return { row, data, entries };
  } catch (error) {
    throw new PackageUnavailableError(row.id, error);
  }
}

async function requireRow(ctx: SkillReadContext, id: string): Promise<SkillRow> {
  const row = await findRow(ctx, id);
  if (row === null) throw new NotFoundError("Skill", id);
  return row;
}

async function listSkills(
  ctx: SkillReadContext,
  query: SkillQuery,
): Promise<Page<SkillSummary>> {
  const { where, params } = buildFilters(query);
  const countRow = await ctx.db.one<{ total: number }>(
    `select count(*)::int as total from skill s ${where}`,
    params,
  );
  const rows = await ctx.db.query<SkillRow>(
    `select s.id, s.name, s.category_code, s.description, s.package_key,
            s.version, s.enabled, s.revision, s.created_at, s.updated_at
     from skill s ${where} ${orderBy(query.sort)}
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, query.page.limit, query.page.offset],
  );
  return {
    items: await Promise.all(rows.map((row) => toSummary(ctx, row))),
    total: countRow?.total ?? 0,
    limit: query.page.limit,
    offset: query.page.offset,
  };
}

function decodeMarkdown(contents: PackageContents): string {
  const entry = contents.entries[0];
  if (entry === undefined) {
    throw new PackageUnavailableError(contents.row.id, new Error("包内缺少 SKILL.md"));
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(entry.data);
}

async function getSkill(ctx: SkillReadContext, id: string): Promise<SkillDetail> {
  const row = await requireRow(ctx, id);
  const summary = await toSummary(ctx, row);
  const contents = await readPackage(ctx, row);
  let body: string;
  try {
    body = parseSkillMarkdown(decodeMarkdown(contents)).body;
  } catch (error) {
    throw new PackageUnavailableError(row.id, error);
  }
  return {
    ...summary,
    body,
    files: toFiles(contents.entries),
    createdAt: toIso(row.created_at),
  };
}

async function getSkillSummary(
  ctx: SkillReadContext,
  id: string,
): Promise<SkillSummary> {
  return toSummary(ctx, await requireRow(ctx, id));
}

async function getSkillDocument(
  ctx: SkillReadContext,
  id: string,
): Promise<SkillDocument> {
  const row = await requireRow(ctx, id);
  const contents = await readPackage(ctx, row);
  let markdown: string;
  try {
    markdown = decodeMarkdown(contents);
  } catch (error) {
    throw new PackageUnavailableError(row.id, error);
  }
  return { markdown, revision: row.revision };
}

async function getSkillPackage(
  ctx: SkillReadContext,
  id: string,
): Promise<SkillPackage> {
  const row = await requireRow(ctx, id);
  const contents = await readPackage(ctx, row);
  return {
    fileName: sanitizeFileName(row.name, row.version),
    data: contents.data,
  };
}

async function listCategories(ctx: SkillReadContext): Promise<SkillCategory[]> {
  return ctx.db.query<SkillCategory>(
    "select code, label, position from skill_category order by position asc",
  );
}
