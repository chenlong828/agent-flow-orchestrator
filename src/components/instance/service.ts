import { BindingConflictError, NotFoundError, ValidationError, type Clock, type IdGenerator } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import { createInstanceStore, toInstance, type InstanceRow, type InstanceStore } from "./store.ts";
import { ensureClientId, ensureInstanceId, ensureWorkspacePath } from "./validate.ts";
import type { EnrollInstance, Instance, InstanceService } from "./types.ts";

export type InstanceDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
};

async function requireRow(store: InstanceStore, id: string): Promise<InstanceRow> {
  const row = await store.findById(id);
  if (row === null) throw new NotFoundError("执行实例", id);
  return row;
}

async function enroll(store: InstanceStore, deps: InstanceDeps, input: EnrollInstance): Promise<Instance> {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const instanceId = ensureInstanceId(input.instanceId);
  const clientId = ensureClientId(input.clientId);
  const workspacePath = ensureWorkspacePath(input.workspacePath);

  const existing = await store.findById(instanceId);
  if (existing !== null) {
    if (existing.client_id !== clientId || existing.workspace_path !== workspacePath) {
      throw new BindingConflictError("clientId", clientId);
    }
    return toInstance(existing);
  }
  if ((await store.findByClientAndPath(clientId, workspacePath)) !== null) {
    throw new BindingConflictError("clientId", clientId);
  }

  const inserted = await store.insert({ id: instanceId, clientId, workspacePath, now: deps.clock.now() });
  if (inserted !== null) return toInstance(inserted);
  const raced = await store.findById(instanceId);
  if (raced !== null) return toInstance(raced);
  throw new BindingConflictError("clientId", clientId);
}

export function createInstanceService(deps: InstanceDeps): InstanceService {
  const store = createInstanceStore(deps.db);

  return {
    enroll: (input) => enroll(store, deps, input),
    get: async (instanceId) => {
      const row = await store.findById(ensureInstanceId(instanceId));
      return row === null ? null : toInstance(row);
    },
    listByClient: async (clientId) => {
      const rows = await store.listByClient(ensureClientId(clientId));
      return rows.map(toInstance);
    },
    getByBinding: async (clientId, workspacePath) => {
      const row = await store.findByClientAndPath(
        ensureClientId(clientId),
        ensureWorkspacePath(workspacePath),
      );
      return row === null ? null : toInstance(row);
    },
    listDispatchable: async (clientId) => {
      const rows = await store.listDispatchable(ensureClientId(clientId));
      return rows.map(toInstance);
    },
    isDispatchable: async (instanceId, clientId) => {
      if (typeof clientId !== "string") throw new ValidationError("clientId", "必须是字符串");
      const row = await store.findById(ensureInstanceId(instanceId));
      return row !== null && row.state === "active" && row.client_id === clientId;
    },
    retire: async (instanceId) => {
      const row = await requireRow(store, ensureInstanceId(instanceId));
      if (row.state === "retired") return;
      await store.setState(row.id, "retired", deps.clock.now());
    },
  };
}
