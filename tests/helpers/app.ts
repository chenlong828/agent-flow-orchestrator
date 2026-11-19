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
  createHarnessAuthenticator,
  createHarnessNodeDirectory,
  createHarnessRead,
  createHarnessService,
} from "../../src/components/harness/index.ts";
import { createToolRead, createToolService } from "../../src/components/tool/index.ts";
import { createSkillRead } from "../../src/components/skill/read.ts";
import { createSkillDraftService } from "../../src/components/skill/draft-service.ts";
import { createSkillPackageSource } from "../../src/components/skill/package-source.ts";
import { createSkillSlugReader } from "../../src/components/skill/slug-reader.ts";
import { createInstanceService } from "../../src/components/instance/index.ts";
import { createScheduler } from "../../src/components/scheduler/index.ts";
import { createRunReferenceReader, createRunService } from "../../src/components/run/index.ts";
import { createExecutorBackend } from "../../src/executor-backend.ts";
import { createExpertRead, createExpertService } from "../../src/components/expert/index.ts";
import {
  createWorkflowRead,
  createWorkflowService,
} from "../../src/components/workflow/index.ts";
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
  skillRead: ReturnType<typeof createSkillRead>;
  expertRead: ReturnType<typeof createExpertRead>;
  harnessService: ReturnType<typeof createHarnessService>;
  toolService: ReturnType<typeof createToolService>;
  skillService: { create(input: { name: string; categoryCode: string; description: string; tags?: string[]; sections?: Record<string, string> }): Promise<{ id: string }> };
  expertService: ReturnType<typeof createExpertService>;
  workflowRead: ReturnType<typeof createWorkflowRead>;
  workflowService: ReturnType<typeof createWorkflowService>;
  instanceService: ReturnType<typeof createInstanceService>;
  packages: ReturnType<typeof createSkillPackageSource>;
  scheduler: ReturnType<typeof createScheduler>;
  runService: ReturnType<typeof createRunService>;
  archiveRoot: string;
  authenticator: ReturnType<typeof createHarnessAuthenticator>;
  backend: ReturnType<typeof createExecutorBackend>;
};

export type TestContextOptions = {
  /** 缺省 `on`：既有用例保持严格 Bearer 语义。 */
  executorAuth?: "on" | "off";
};

export async function createTestContext(
  options: TestContextOptions = {},
): Promise<TestContext> {
  const db = await getTestDb();
  const harnessRead = createHarnessRead({ db });
  const toolRead = createToolRead({ db });
  const storageRoot = await mkdtemp(join(tmpdir(), "agentflow-app-"));
  const skillStore = createFileStore(join(storageRoot, "skills"));
  const archiveRoot = join(storageRoot, "archive");
  const catalogSkillRead = createSkillRead(db, skillStore);
  const skillSlugReader = createSkillSlugReader({ db });
  const expertRead = createExpertRead({ db });
  const workflowRead = createWorkflowRead({ db });
  const instanceService = createInstanceService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
  });
  const packages = createSkillPackageSource({ db, store: skillStore });
  const scheduler = createScheduler({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    instance: instanceService,
    packages,
    node: createHarnessNodeDirectory(harnessRead),
    maxAttempts: 3,
    retryDelayMs: 0,
  });
  const authenticator = createHarnessAuthenticator({ db });
  const runService = createRunService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    fileStore: createFileStore(archiveRoot),
    workflowRead,
    expertRead,
    harnessRead,
    instance: instanceService,
    scheduler,
    defaultTimeoutMs: 60000,
    maxNodeVisits: 5,
  });
  const catalog = createCatalog({
    harnessRead,
    presence: scheduler,
    toolRead,
    skillRead: catalogSkillRead,
    expertRead,
    workflowRead,
  });
  const runReferences = createRunReferenceReader({ db });
  const guard = {
    async check(owner: Parameters<typeof catalog.check>[0], id: string) {
      const definitionReferences = await catalog.check(owner, id);
      if (owner === "workflow" || owner === "harness" || owner === "expert") {
        return [...definitionReferences, ...(await runReferences.active(owner, id))];
      }
      return definitionReferences;
    },
  };

  const harnessService = createHarnessService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard,
    actor: "tester",
  });
  const toolService = createToolService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard,
    actor: "tester",
  });
  const skillDraftService = createSkillDraftService({
    db,
    store: skillStore,
    clock: systemClock,
    ids: uuidv7Ids,
    guard,
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
    guard,
    skillSlugs: skillSlugReader,
  });
  const workflowService = createWorkflowService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    actor: "tester",
    expertStatus: expertRead,
    guard,
  });

  const backend = createExecutorBackend({ scheduler, packages, authenticator, run: runService });
  const app = createHttpApp({
    catalog,
    backend,
    executorPollHoldMs: 20,
    executorAuth: options.executorAuth ?? "on",
    executorEnroll: async (clientId, address) => {
      await harnessService.ensureNode(clientId, { address });
    },
    harnessService,
    toolService,
    skillDraftService,
    expertService,
    workflowService,
    runService,
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
    skillRead: catalogSkillRead,
    expertService,
    workflowRead,
    workflowService,
    instanceService,
    packages,
    scheduler,
    runService,
    archiveRoot,
    authenticator,
    backend,
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
  const response = await send(app, method, path, options);
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? null : JSON.parse(text),
    headers: response.headers,
  };
}

/** 取原始响应，供非 JSON 载荷（zip、markdown）使用。 */
export async function callRaw(
  app: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  return send(app, method, path, options);
}

async function send(
  app: (request: Request) => Promise<Response>,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  let body: string | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return app(new Request(`http://127.0.0.1:3000${path}`, { method, headers, body }));
}

export function withRevision(revision: number): Record<string, string> {
  return { "if-match": `"${revision}"` };
}
