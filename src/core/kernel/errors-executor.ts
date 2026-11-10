import { AppError } from "./errors.ts";

/** 执行面任务不存在或不属于该 client 的实例；只用于 P-02。 */
export class TaskNotFoundError extends AppError {
  constructor(taskId: string) {
    super("task_not_found", "任务不存在", { details: { taskId } });
  }
}

/** 执行面技能包不存在或已下架；只用于 P-03。 */
export class PackageNotFoundError extends AppError {
  constructor(packageId: string) {
    super("package_not_found", "技能包不存在", { details: { packageId } });
  }
}

/** X-Executor-Protocol 与当前整数版本不一致。 */
export class UnsupportedProtocolError extends AppError {
  constructor(expected: number, actual: string | null) {
    super("unsupported_protocol", `执行面协议版本必须是 ${expected}`, {
      details: { expected, actual },
    });
  }
}

/** 执行面 Bearer 凭据缺失或无法解析为 clientId。 */
export class UnauthorizedError extends AppError {
  constructor() {
    super("unauthorized", "执行面凭据无效");
  }
}
