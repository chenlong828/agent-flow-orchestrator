import { AppError } from "./errors.ts";

/** 运行不存在或不属于该 client；只用于 run 端点与 P-05。 */
export class RunNotFoundError extends AppError {
  constructor(runId: string) {
    super("run_not_found", "运行不存在", { details: { runId } });
  }
}

/** 同一工作区已有活跃 run（running / waiting_confirm）。 */
export class RunConflictError extends AppError {
  constructor(instanceId: string) {
    super("run_conflict", "该工作区已有活跃运行", { details: { instanceId } });
  }
}

/** 结果到达时该 taskId+attempt 没有会话日志；任务不结算、不重派。 */
export class SessionLogMissingError extends AppError {
  constructor(taskId: string, attempt: number) {
    super("session_log_missing", "会话日志尚未上传", {
      details: { taskId, attempt },
    });
  }
}

/** 当前状态不允许该操作（run 未终态、节点不在 waiting_confirm 等）。 */
export class InvalidStateError extends AppError {
  constructor(reason: string) {
    super("invalid_state", `当前状态不允许该操作：${reason}`, {
      details: { reason },
    });
  }
}

/** 归档包损坏、含绝对路径/.. /越界链接，或超条目/解压总量。 */
export class InvalidArchiveError extends AppError {
  constructor(reason: string) {
    super("invalid_archive", `归档包不合法：${reason}`, {
      details: { reason },
    });
  }
}

/** 启动 run 时图含本期不支持的节点类型（split / fanout）。 */
export class UnsupportedNodeTypeError extends AppError {
  constructor(nodeId: string, nodeType: string) {
    super("unsupported_node_type", `节点 ${nodeId} 的类型 ${nodeType} 本期不支持`, {
      details: { nodeId, nodeType },
    });
  }
}
