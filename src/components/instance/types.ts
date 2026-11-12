export type InstanceState = "active" | "blocked" | "retired";
export type BlockReason = "workspace_failure" | "operator";

/** 执行实例：一个工作区路径 + 一个归属 client。 */
export type Instance = {
  instanceId: string;
  clientId: string;
  workspacePath: string;
  state: InstanceState;
  blockReason: BlockReason | null;
  enrolledAt: string;
  updatedAt: string;
};

export type EnrollInstance = {
  instanceId: string;
  clientId: string;
  workspacePath: string;
};

export type InstanceService = {
  /** 上游接缝：任务启动时登记实例；同 ID 重复登记同绑定幂等。 */
  enroll(input: EnrollInstance): Promise<Instance>;
  get(instanceId: string): Promise<Instance | null>;
  listByClient(clientId: string): Promise<Instance[]>;
  /** 读：按绑定反查；不存在返回 null。供运行编排复用同一工作区的实例。 */
  getByBinding(clientId: string, workspacePath: string): Promise<Instance | null>;
  listDispatchable(clientId: string): Promise<Instance[]>;
  isDispatchable(instanceId: string, clientId: string): Promise<boolean>;
  block(instanceId: string, reason: BlockReason): Promise<void>;
  unblock(instanceId: string): Promise<void>;
  retire(instanceId: string): Promise<void>;
};
