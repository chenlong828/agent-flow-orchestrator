import type { SkillSet, TaskEnvelope, TaskError, TaskSignalBundle, TaskSnapshot } from "./types.ts";
import type { TaskRow } from "./store.ts";

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function skillSetOf(row: TaskRow): SkillSet {
  return typeof row.skill_set === "string" ? (JSON.parse(row.skill_set) as SkillSet) : row.skill_set;
}

function errorOf(row: TaskRow): TaskError | null {
  if (row.error === null) return null;
  return typeof row.error === "string" ? (JSON.parse(row.error) as TaskError) : row.error;
}

function signalBundleOf(row: TaskRow): TaskSignalBundle {
  if (row.result_signal === null) return {};
  const value = typeof row.result_signal === "string"
    ? (JSON.parse(row.result_signal) as TaskSignalBundle)
    : (row.result_signal as TaskSignalBundle);
  return {
    ...(value.resultSignal === undefined ? {} : { resultSignal: value.resultSignal }),
    ...(value.confirmation === undefined ? {} : { confirmation: value.confirmation }),
  };
}

export function envelope(row: TaskRow): TaskEnvelope {
  const signals = signalBundleOf(row);
  return {
    taskId: row.id,
    instanceId: row.instance_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    prompt: row.prompt,
    workspacePath: row.workspace_path,
    taskSpacePath: row.task_space_path,
    timeoutMs: row.timeout_ms,
    skillSet: skillSetOf(row),
    ...(signals.resultSignal === undefined ? {} : { resultSignal: signals.resultSignal }),
    ...(signals.confirmation === undefined ? {} : { confirmation: signals.confirmation }),
    ...(row.resume_session_id === null ? {} : { resumeSessionId: row.resume_session_id }),
  };
}

export function snapshot(row: TaskRow): TaskSnapshot {
  return {
    taskId: row.id,
    instanceId: row.instance_id,
    clientId: row.client_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    state: row.state,
    outcome: row.outcome ?? undefined,
    error: errorOf(row) ?? undefined,
    skillSetDigest: row.skill_set_digest,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    finishedAt: row.finished_at === null ? undefined : toIso(row.finished_at),
  };
}
