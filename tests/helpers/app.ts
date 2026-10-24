import {
  createDb,
  createHealth,
  systemClock,
  uuidv7Ids,
} from "../../src/core/platform/index.ts";
import {
  createHarnessRead,
  createHarnessService,
} from "../../src/components/harness/index.ts";
import { createToolRead, createToolService } from "../../src/components/tool/index.ts";
import { createSkillRead, createSkillService } from "../../src/components/skill/index.ts";
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
  skillRead: ReturnType<typeof createSkillRead>;
  expertRead: ReturnType<typeof createExpertRead>;
  harnessService: ReturnType<typeof createHarnessService>;
  toolService: ReturnType<typeof createToolService>;
  skillService: ReturnType<typeof createSkillService>;
  expertService: ReturnType<typeof createExpertService>;
};

export async function createTestContext(): Promise<TestContext> {
  const db = await getTestDb();
  const harnessRead = createHarnessRead({ db });
  const toolRead = createToolRead({ db });
  const skillRead = createSkillRead({ db });
  const expertRead = createExpertRead({ db });
  const catalog = createCatalog({ harnessRead, toolRead, skillRead, expertRead });

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
  const skillService = createSkillService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard: catalog,
    actor: "tester",
  });
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
    skillService,
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
    skillRead,
    expertRead,
    harnessService,
    toolService,
    skillService,
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
