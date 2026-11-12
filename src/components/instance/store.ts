import { toIso } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { Instance, InstanceState } from "./types.ts";

export type InstanceRow = {
  id: string;
  client_id: string;
  workspace_path: string;
  state: InstanceState;
  enrolled_at: Date | string;
  updated_at: Date | string;
};

export type EnrollInstanceRow = {
  id: string;
  clientId: string;
  workspacePath: string;
  now: Date;
};

const COLUMNS = "id, client_id, workspace_path, state, enrolled_at, updated_at";

export function toInstance(row: InstanceRow): Instance {
  return {
    instanceId: row.id,
    clientId: row.client_id,
    workspacePath: row.workspace_path,
    state: row.state,
    enrolledAt: toIso(row.enrolled_at),
    updatedAt: toIso(row.updated_at),
  };
}

export type InstanceStore = {
  findById(id: string): Promise<InstanceRow | null>;
  findByClientAndPath(clientId: string, workspacePath: string): Promise<InstanceRow | null>;
  listByClient(clientId: string): Promise<InstanceRow[]>;
  listDispatchable(clientId: string): Promise<InstanceRow[]>;
  insert(input: EnrollInstanceRow): Promise<InstanceRow | null>;
  setState(id: string, state: InstanceState, now: Date): Promise<InstanceRow | null>;
};

export function createInstanceStore(db: Db): InstanceStore {
  const store: InstanceStore = {
    findById: (id) =>
      db.one<InstanceRow>(`select ${COLUMNS} from instance where id = $1`, [id]),
    findByClientAndPath: (clientId, workspacePath) =>
      db.one<InstanceRow>(
        `select ${COLUMNS} from instance where client_id = $1 and workspace_path = $2`,
        [clientId, workspacePath],
      ),
    listByClient: (clientId) =>
      db.query<InstanceRow>(
        `select ${COLUMNS} from instance where client_id = $1
          order by enrolled_at asc, id asc`,
        [clientId],
      ),
    listDispatchable: (clientId) =>
      db.query<InstanceRow>(
        `select ${COLUMNS} from instance
          where client_id = $1 and state = 'active'
          order by enrolled_at asc, id asc`,
        [clientId],
      ),
    insert: (input) =>
      db.one<InstanceRow>(
        `insert into instance (id, client_id, workspace_path, state, enrolled_at, updated_at)
         values ($1, $2, $3, 'active', $4, $4)
         on conflict do nothing
         returning ${COLUMNS}`,
        [input.id, input.clientId, input.workspacePath, input.now],
      ),
    setState: (id, state, now) =>
      db.one<InstanceRow>(
        `update instance set state = $2, updated_at = $3
          where id = $1 returning ${COLUMNS}`,
        [id, state, now],
      ),
  };
  return store;
}
