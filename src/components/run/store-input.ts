import type { Db } from "../../core/platform/index.ts";
import type { RunInputMediaType, RunInputState } from "./types.ts";

export type RunInputRow = {
  id: string;
  run_id: string | null;
  position: number | null;
  name: string;
  media_type: RunInputMediaType;
  size_bytes: number | string;
  sha256: string;
  store_key: string;
  state: RunInputState;
  created_at: Date | string;
  bound_at: Date | string | null;
};

export type NewRunInputRow = {
  id: string;
  runId: string | null;
  position: number | null;
  name: string;
  mediaType: RunInputMediaType;
  sizeBytes: number;
  sha256: string;
  storeKey: string;
  state: RunInputState;
  now: Date;
};

const INPUT_COLUMNS = `
  id, run_id, position, name, media_type, size_bytes, sha256, store_key, state, created_at, bound_at`;

async function insertInput(tx: Db, row: NewRunInputRow): Promise<void> {
  await tx.query(
    `insert into run_input
       (id, run_id, position, name, media_type, size_bytes, sha256, store_key, state, created_at, bound_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null)`,
    [
      row.id,
      row.runId,
      row.position,
      row.name,
      row.mediaType,
      row.sizeBytes,
      row.sha256,
      row.storeKey,
      row.state,
      row.now,
    ],
  );
}

async function findInput(tx: Db, inputId: string): Promise<RunInputRow | null> {
  return await tx.one<RunInputRow>(
    `select ${INPUT_COLUMNS} from run_input where id = $1`,
    [inputId],
  );
}

async function lockInputs(tx: Db, inputIds: string[]): Promise<RunInputRow[]> {
  if (inputIds.length === 0) return [];
  return await tx.query<RunInputRow>(
    `select ${INPUT_COLUMNS}
       from run_input
      where id = any($1::uuid[])
      order by created_at, id
      for update`,
    [inputIds],
  );
}

async function bindInput(
  tx: Db,
  inputId: string,
  row: { runId: string; position: number; name: string; now: Date },
): Promise<void> {
  await tx.query(
    `update run_input
        set state = 'bound', run_id = $2, position = $3, name = $4, bound_at = $5
      where id = $1 and state = 'staged'`,
    [inputId, row.runId, row.position, row.name, row.now],
  );
}

async function listBoundInputs(tx: Db, runId: string): Promise<RunInputRow[]> {
  return await tx.query<RunInputRow>(
    `select ${INPUT_COLUMNS}
       from run_input
      where run_id = $1 and state = 'bound'
      order by position, id`,
    [runId],
  );
}

async function findBoundInput(tx: Db, runId: string, inputId: string): Promise<RunInputRow | null> {
  return await tx.one<RunInputRow>(
    `select ${INPUT_COLUMNS}
       from run_input
      where run_id = $1 and id = $2 and state = 'bound'`,
    [runId, inputId],
  );
}

async function deleteStagedInput(tx: Db, inputId: string): Promise<RunInputRow | null> {
  return await tx.one<RunInputRow>(
    `delete from run_input where id = $1 and state = 'staged' returning ${INPUT_COLUMNS}`,
    [inputId],
  );
}

/** `run_input` 的写入口：暂存、绑定、读列表与单条。 */
export function createInputStore() {
  return {
    insertInput,
    findInput,
    lockInputs,
    bindInput,
    listBoundInputs,
    findBoundInput,
    deleteStagedInput,
  };
}
