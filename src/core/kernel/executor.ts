/** `executor-http-v2` §3 的常量；不通过配置协商，调度器与网关共用同一来源。 */
export const EXECUTOR_PROTOCOL_VERSION = 2;
export const POLL_HOLD_MS = 30000;
export const MAX_TASKS_PER_POLL = 10;
export const CLIENT_SILENT_MS = 120000;
export const RESULT_GRACE_MS = 60000;
export const MAX_RESULT_BYTES = 262144;
export const MAX_PROMPT_BYTES = 1048576;
