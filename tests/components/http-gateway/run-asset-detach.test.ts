import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";
import {
  createRunFixture,
  driveRun,
  getRun,
  startRun,
  type RunFixture,
} from "../../helpers/run.ts";
import type { WorkflowGraph } from "../../../src/components/workflow/index.ts";

let ctx: TestContext;

function graphLinear(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "agent", name: "实现", stageId: "s1", expertId },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

async function assetRevisions(fixture: RunFixture) {
  const [workflow, expert, harness] = await Promise.all([
    call(ctx.app, "GET", `/api/v1/workflows/${fixture.workflowId}`),
    call(ctx.app, "GET", `/api/v1/experts/${fixture.expertId}`),
    call(ctx.app, "GET", `/api/v1/harnesses/${fixture.harnessId}`),
  ]);
  expect(workflow.status).toBe(200);
  expect(expert.status).toBe(200);
  expect(harness.status).toBe(200);
  return {
    workflowName: workflow.body.name as string,
    workflowRevision: workflow.body.revision as number,
    expertName: expert.body.name as string,
    expertRevision: expert.body.revision as number,
    harnessName: harness.body.name as string,
    harnessRevision: harness.body.revision as number,
  };
}

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("终态 run 不阻止删除资产", () => {
  test("终态 run 删除工作流、专家、Harness 后，运行详情仍返回快照名与冻结图", async () => {
    const graph = graphLinear;
    const fixture = await createRunFixture(ctx, graph);
    const asset = await assetRevisions(fixture);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/asset-detach" });
    expect(started.status).toBe(201);
    const runId = started.body.runId as string;
    await driveRun(ctx, fixture, runId);
    expect((await getRun(ctx, runId)).body.state).toBe("done");

    const row = await ctx.db.one<{
      workflow_id: string | null;
      harness_id: string | null;
      workflow_ref_id: string;
      harness_ref_id: string;
      workflow_name: string;
      harness_name: string;
    }>(
      `select workflow_id, harness_id, workflow_ref_id, harness_ref_id, workflow_name, harness_name
         from workflow_run where id = $1`,
      [runId],
    );
    expect(row).toEqual({
      workflow_id: null,
      harness_id: null,
      workflow_ref_id: fixture.workflowId,
      harness_ref_id: fixture.harnessId,
      workflow_name: asset.workflowName,
      harness_name: asset.harnessName,
    });
    const nodeRows = await ctx.db.query<{ expert_id: string | null; expert_name: string | null }>(
      "select expert_id, expert_name from run_node where run_id = $1 order by node_id",
      [runId],
    );
    expect(nodeRows.every((node) => node.expert_id === null && node.expert_name === asset.expertName)).toBe(true);

    const constraint = await ctx.db
      .query("update workflow_run set workflow_id = $1 where id = $2", [
        fixture.workflowId,
        runId,
      ])
      .catch((error) => error);
    expect(String(constraint)).toContain("workflow_run_history_detached");

    const detail = await getRun(ctx, runId);
    expect(detail.status).toBe(200);
    expect(detail.body.workflowId).toBe(fixture.workflowId);
    expect(detail.body.workflowName).toBe(asset.workflowName);
    expect(detail.body.harnessId).toBe(fixture.harnessId);
    expect(detail.body.harnessName).toBe(asset.harnessName);
    expect(detail.body.graph).toEqual(graph(fixture.expertId));
    expect(detail.body.nodes.length).toBe(3);
    for (const node of detail.body.nodes) {
      expect(node.expertName).toBe(asset.expertName);
    }

    const deletedWorkflow = await call(
      ctx.app,
      "DELETE",
      `/api/v1/workflows/${fixture.workflowId}`,
      { headers: withRevision(asset.workflowRevision) },
    );
    expect(deletedWorkflow.status).toBe(204);

    const deletedExpert = await call(
      ctx.app,
      "DELETE",
      `/api/v1/experts/${fixture.expertId}`,
      { headers: withRevision(asset.expertRevision) },
    );
    expect(deletedExpert.status).toBe(204);

    const deletedHarness = await call(
      ctx.app,
      "DELETE",
      `/api/v1/harnesses/${fixture.harnessId}`,
      { headers: withRevision(asset.harnessRevision) },
    );
    expect(deletedHarness.status).toBe(204);

    const after = await getRun(ctx, runId);
    expect(after.status).toBe(200);
    expect(after.body.workflowName).toBe(asset.workflowName);
    expect(after.body.harnessName).toBe(asset.harnessName);
    expect(after.body.graph).toEqual(graph(fixture.expertId));
    expect(after.body.nodes.map((node: { expertName: string | null }) => node.expertName)).toEqual([
      asset.expertName,
      asset.expertName,
      asset.expertName,
    ]);
  });

  test("活跃 run 阻止删除，409 references 列出 run 且不再返回 500", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    const asset = await assetRevisions(fixture);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/active-detach" });
    expect(started.status).toBe(201);
    const runId = started.body.runId as string;
    expect((await getRun(ctx, runId)).body.state).toBe("running");

    const workflowDelete = await call(
      ctx.app,
      "DELETE",
      `/api/v1/workflows/${fixture.workflowId}`,
      { headers: withRevision(asset.workflowRevision) },
    );
    expect(workflowDelete.status).toBe(409);
    expect(workflowDelete.body.error.code).toBe("referenced");
    expect(workflowDelete.body.error.details.references).toContainEqual(
      expect.objectContaining({ type: "run", id: runId }),
    );

    const harnessDelete = await call(
      ctx.app,
      "DELETE",
      `/api/v1/harnesses/${fixture.harnessId}`,
      { headers: withRevision(asset.harnessRevision) },
    );
    expect(harnessDelete.status).toBe(409);
    expect(harnessDelete.body.error.code).toBe("referenced");
    expect(harnessDelete.body.error.details.references).toContainEqual(
      expect.objectContaining({ type: "run", id: runId }),
    );

    const expertDelete = await call(
      ctx.app,
      "DELETE",
      `/api/v1/experts/${fixture.expertId}`,
      { headers: withRevision(asset.expertRevision) },
    );
    expect(expertDelete.status).toBe(409);
    expect(expertDelete.body.error.code).toBe("referenced");
  });
});
