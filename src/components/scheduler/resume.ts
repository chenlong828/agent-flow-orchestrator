import {
  InvalidStateError,
  TaskNotFoundError,
  ValidationError,
} from "../../core/kernel/index.ts";
import type { SchedulerDeps } from "./deps.ts";
import { snapshot } from "./mappers.ts";
import type { SchedulerStore } from "./store.ts";
import type { TaskSnapshot } from "./types.ts";
import { ensureClientId, ensureUuid } from "./validate.ts";

function ensureSessionId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new ValidationError("resumeSessionId", "长度必须是 1–200");
  }
  return value;
}

/** 人工续跑：把 done(timeout) 的同一 task 重开为下一 attempt。 */
export function createResumeHandler(
  deps: SchedulerDeps,
  store: SchedulerStore,
  notify: (clientId: string) => void,
) {
  return async function resumeTask(
    clientId: string,
    taskId: string,
    resumeSessionId: string,
  ): Promise<TaskSnapshot> {
    const client = ensureClientId(clientId);
    const id = ensureUuid(taskId, "taskId");
    const sessionId = ensureSessionId(resumeSessionId);

    const row = await store.findById(id);
    if (row === null || row.client_id !== client) throw new TaskNotFoundError(id);
    if (row.state === "queued" || row.state === "dispatched") {
      if (row.resume_session_id === sessionId) return snapshot(row);
      throw new InvalidStateError("task_not_resumable");
    }

    const now = deps.clock.now();
    const attempt = await deps.db.transaction((tx) => store.reopen(tx, id, sessionId, now));
    if (attempt === null) {
      const fresh = await store.findById(id);
      if (
        fresh !== null
        && (fresh.state === "queued" || fresh.state === "dispatched")
        && fresh.resume_session_id === sessionId
      ) {
        return snapshot(fresh);
      }
      throw new InvalidStateError("task_not_resumable");
    }

    notify(client);
    const fresh = await store.findById(id);
    if (fresh === null) throw new TaskNotFoundError(id);
    return snapshot(fresh);
  };
}
