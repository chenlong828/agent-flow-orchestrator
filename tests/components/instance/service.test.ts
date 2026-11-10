import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BindingConflictError,
  NotFoundError,
  ValidationError,
} from "../../../src/core/kernel/index.ts";
import { createInstanceService } from "../../../src/components/instance/index.ts";
import { closeTestDb, getTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { fixedClock, sequentialIds } from "../../helpers/fakes.ts";

const CLOCK = fixedClock("2026-11-11T00:00:00.000Z");
const IDS = sequentialIds("0191f2f0-1111-7000-8000-000000000000");

async function service() {
  const db = await getTestDb();
  return createInstanceService({ db, clock: CLOCK, ids: IDS });
}

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("执行实例登记", () => {
  test("首次登记成功；同绑定重复登记幂等；同 ID 改绑定冲突", async () => {
    const svc = await service();
    const created = await svc.enroll({
      instanceId: "0191f2f0-2222-7000-8000-000000000001",
      clientId: "node-a",
      workspacePath: "/work/instance-a",
    });
    expect(created).toMatchObject({
      instanceId: "0191f2f0-2222-7000-8000-000000000001",
      clientId: "node-a",
      workspacePath: "/work/instance-a",
      state: "active",
      blockReason: null,
      enrolledAt: "2026-11-11T00:00:00.000Z",
    });

    const again = await svc.enroll({
      instanceId: created.instanceId,
      clientId: "node-a",
      workspacePath: "/work/instance-a",
    });
    expect(again.instanceId).toBe(created.instanceId);
    expect(again.state).toBe("active");

    await expect(
      svc.enroll({
        instanceId: created.instanceId,
        clientId: "node-b",
        workspacePath: "/work/instance-a",
      }),
    ).rejects.toBeInstanceOf(BindingConflictError);
  });

  test("路径与 clientId 校验：非绝对路径、空白 clientId、控制字符被拒绝", async () => {
    const svc = await service();
    await expect(
      svc.enroll({
        instanceId: "0191f2f0-2222-7000-8000-000000000010",
        clientId: "node-a",
        workspacePath: "relative/path",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.enroll({
        instanceId: "0191f2f0-2222-7000-8000-000000000011",
        clientId: "node a",
        workspacePath: "/work/a",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.enroll({
        instanceId: "0191f2f0-2222-7000-8000-000000000012",
        clientId: "node-a",
        workspacePath: "/work/\u0001bad",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("同一 client 下同路径重复登记冲突；不同 client 同路径允许", async () => {
    const svc = await service();
    await svc.enroll({
      instanceId: "0191f2f0-2222-7000-8000-000000000020",
      clientId: "node-a",
      workspacePath: "/work/shared",
    });
    await expect(
      svc.enroll({
        instanceId: "0191f2f0-2222-7000-8000-000000000021",
        clientId: "node-a",
        workspacePath: "/work/shared",
      }),
    ).rejects.toBeInstanceOf(BindingConflictError);

    const other = await svc.enroll({
      instanceId: "0191f2f0-2222-7000-8000-000000000022",
      clientId: "node-b",
      workspacePath: "/work/shared",
    });
    expect(other.clientId).toBe("node-b");
  });
});

describe("执行实例状态机", () => {
  test("可派发判定只认 active 且绑定 client", async () => {
    const svc = await service();
    const instance = await svc.enroll({
      instanceId: "0191f2f0-2222-7000-8000-000000000030",
      clientId: "node-a",
      workspacePath: "/work/state",
    });
    expect(await svc.isDispatchable(instance.instanceId, "node-a")).toBe(true);
    expect(await svc.isDispatchable(instance.instanceId, "node-b")).toBe(false);
    expect(await svc.isDispatchable("0191f2f0-2222-7000-8000-0000000000ff", "node-a")).toBe(false);

    expect(await svc.listDispatchable("node-a")).toHaveLength(1);
    expect(await svc.get(instance.instanceId)).toMatchObject({ state: "active" });
    expect(await svc.get("0191f2f0-2222-7000-8000-0000000000ff")).toBeNull();
  });

  test("block 幂等并记录原因；unblock 恢复；retire 终态拒绝恢复", async () => {
    const svc = await service();
    const instance = await svc.enroll({
      instanceId: "0191f2f0-2222-7000-8000-000000000040",
      clientId: "node-a",
      workspacePath: "/work/lifecycle",
    });
    await svc.block(instance.instanceId, "workspace_failure");
    await svc.block(instance.instanceId, "operator");
    expect(await svc.get(instance.instanceId)).toMatchObject({
      state: "blocked",
      blockReason: "workspace_failure",
    });
    expect(await svc.isDispatchable(instance.instanceId, "node-a")).toBe(false);
    expect(await svc.listDispatchable("node-a")).toHaveLength(0);

    await svc.unblock(instance.instanceId);
    await svc.unblock(instance.instanceId);
    expect(await svc.get(instance.instanceId)).toMatchObject({ state: "active", blockReason: null });

    await svc.retire(instance.instanceId);
    await svc.retire(instance.instanceId);
    expect(await svc.get(instance.instanceId)).toMatchObject({ state: "retired" });
    await expect(svc.unblock(instance.instanceId)).rejects.toBeInstanceOf(ValidationError);
  });

  test("未知实例的操作报 NotFound", async () => {
    const svc = await service();
    const missing = "0191f2f0-2222-7000-8000-00000000dead";
    await expect(svc.block(missing, "operator")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.unblock(missing)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.retire(missing)).rejects.toBeInstanceOf(NotFoundError);
  });
});
