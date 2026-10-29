import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDb,
  createFileStore,
  createHealth,
  systemClock,
  uuidv7Ids,
} from "../../src/core/platform/index.ts";
import {
  createHarnessRead,
  createHarnessService,
} from "../../src/components/harness/index.ts";
import { createToolRead, createToolService } from "../../src/components/tool/index.ts";
import { createSkillRead } from "../../src/components/skill/read.ts";
import { createSkillDraftService } from "../../src/components/skill/draft.ts";
import { createExpertRead, createExpertService } from "../../src/components/expert/index.ts";
import { createCatalog } from "../../src/components/catalog/index.ts";
import { createHttpApp } from "../../src/components/http-gateway/index.ts";
import { getTestDb } from "./test-db.ts";

export type TestContext = {
  app: (request: Request) => Promise<Response>;
  db: Awaited<ReturnType<typeof getTestDb>>;
  catalog: ReturnType<typeof createCatalog>;
  harnessRead: ReturnType<typeof createHarnessRead>;
  toolRead: ReturnType<typeof createToolRead>;
  skillDraftService: ReturnType<typeof createSkillDraftService>;
  expertRead: ReturnType<typeof createExpertRead>;
  harnessService: ReturnType<typeof createHarnessService>;
  toolService: ReturnType<typeof createToolService>;
  skillService: { create(input: { name: string; categoryCode: string; description: string; tags?: string[]; sections?: Record<string, string> }): Promise<{ id: string }> };
  expertService: ReturnType<typeof createExpertService>;
};

export async function createTestContext(): Promise<TestContext> {
  const db = await getTestDb();
  const harnessRead = createHarnessRead({ db });
  const toolRead = createToolRead({ db });
  const skillStore = createFileStore(
    join(await mkdtemp(join(tmpdir(), "agentflow-app-")), "skills"),
  );
  const catalogSkillRead = createSkillRead(db, skillStore);
  const expertRead = createExpertRead({ db });
  const catalog = createCatalog({
    harnessRead,
    toolRead,
    skillRead: catalogSkillRead,
    expertRead,
  });

  const harnessService = createHarnessService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard: catalog,
    actor: "tester",
  });
  const toolService = createToolService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard: catalog,
    actor: "tester",
  });
  const skillDraftService = createSkillDraftService({
    db,
    store: skillStore,
    clock: systemClock,
    ids: uuidv7Ids,
    guard: catalog,
    draftTtlHours: 24,
    actor: "tester",
  });
  const legacySkillCreate = async (input: {
    name: string;
    categoryCode: string;
    description: string;
    tags?: string[];
    sections?: Record<string, string>;
  }) => {
    const draft = await skillDraftService.createDraft(null);
    const sections = input.sections ?? {};
    const body = ["overview", "steps", "examples", "scripts", "verification"]
      .filter((key) => sections[key] !== undefined)
      .map((key) => `## ${key}\n\n${sections[key]}`)
      .join("\n\n");
    return skillDraftService.saveDraft(draft.id, null, {
      name: input.name,
      categoryCode: input.categoryCode,
      description: input.description,
      tags: input.tags,
      body,
    });
  };
  const skillService = { create: legacySkillCreate };
  const expertService = createExpertService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    actor: "tester",
  });

  const app = createHttpApp({
    catalog,
    harnessService,
    toolService,
    skillDraftService,
    expertService,
    health: createHealth(db),
    actor: "tester",
  });

  return {
    app,
    db,
    catalog,
    harnessRead,
    toolRead,
    expertRead,
    harnessService,
    toolService,
    skillService,
    skillDraftService,
    expertService,
  };
}

export type CallOptions = {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

export async function call(
  app: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(options.headers ?? {});
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const response = await app(
    new Request(`http://127.0.0.1:3000${path}`, { method, headers, body }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? null : JSON.parse(text),
    headers: response.headers,
  };
}

export function withRevision(revision: number): Record<string, string> {
  return { "if-match": `"${revision}"` };
}
