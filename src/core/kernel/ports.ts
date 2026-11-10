export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  next(): string;
};

/** 可被引用的资产类型；删除前由领域服务通过 ReferenceGuard 检查。 */
export type ReferenceOwner = "harness" | "tool" | "skill" | "expert";

export type Reference = {
  type: "tool" | "expert" | "workflow";
  id: string;
  name: string;
};

/** 只读专家可用性查询；由专家组件实现，供工作流校验不跨组件读表。 */
export type ExpertStatusReader = {
  statuses(expertIds: string[]): Promise<Record<string, boolean>>;
};

/** 执行节点目录：client 节点是否可接任务。由 CMP-harness 实现，组合根注入 scheduler。 */
export type NodeDirectory = {
  /** 节点存在、已绑定 clientId 且 enabled；未知 clientId 返回 false。 */
  isDispatchable(clientId: string): Promise<boolean>;
  /** 已绑定且 enabled 的 clientId；启动交集校验与排障用。 */
  listClientIds(): Promise<string[]>;
};

/** 执行面 Bearer 凭据解析：token → clientId。由 CMP-harness 实现，执行端端点使用。 */
export type ExecutorAuthenticator = {
  /** 未知 token 或未绑定节点返回 null；不区分「凭据不存在」与「节点已解绑」。 */
  resolveClientId(token: string): Promise<string | null>;
};

/** 引用检查端口，由 catalog 实现，组合根注入领域删除服务。 */
export type ReferenceGuard = {
  check(owner: ReferenceOwner, id: string): Promise<Reference[]>;
};

/** 文件内容；写路径可传内存块或流。 */
export type FileData = Uint8Array | ReadableStream<Uint8Array>;

export type FileStat = {
  /** 相对存储根的 POSIX 键。 */
  key: string;
  /** 字节数。 */
  size: number;
  modifiedAt: Date;
};

/** 文件存储端口，由 platform 实现；业务组件不直接使用 Bun 文件 API。 */
export type FileStore = {
  put(key: string, data: FileData): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  head(key: string): Promise<FileStat | null>;
  list(prefix: string): Promise<FileStat[]>;
  delete(key: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
};
