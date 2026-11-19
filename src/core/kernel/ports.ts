export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  next(): string;
};

/** 可被引用的资产类型；删除前由领域服务通过 ReferenceGuard 检查。 */
export type ReferenceOwner = "harness" | "tool" | "skill" | "expert" | "workflow";

export type Reference = {
  type: "tool" | "expert" | "workflow" | "run";
  id: string;
  name: string;
};

/** 历史 run 的活跃引用；由 CMP-run 实现，组合根与 catalog 的引用合并。 */
export type RunReferenceOwner = "workflow" | "harness" | "expert";

export type RunReferenceReader = {
  /** 仍处于 created/running/waiting_confirm/waiting_resume 的 run；终态不返回。 */
  active(owner: RunReferenceOwner, id: string): Promise<Reference[]>;
};

/** 只读专家可用性查询；由专家组件实现，供工作流校验不跨组件读表。 */
export type ExpertStatusReader = {
  statuses(expertIds: string[]): Promise<Record<string, boolean>>;
};

/** 只读技能系统标识查询；由技能组件实现，供专家装配校验 DSH 技能名不重复。 */
export type SkillSlugReader = {
  /** 返回已存在技能的 `id → slug`；未知 id 不出现在结果中。 */
  slugsFor(skillIds: string[]): Promise<Record<string, string>>;
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

/** 不可变技能包引用；`packageId` 与内容一一对应，由 CMP-skill 发放。 */
export type SkillPackageRef = {
  packageId: string;
  skillId: string;
  name: string;
  version: string;
  /** 包字节的 sha256 十六进制（不带前缀）。 */
  digest: string;
  sizeBytes: number;
  /** HTTP ETag 值，含引号。 */
  etag: string;
};

/** 执行面制品端口：由 CMP-skill 实现，组合根注入 scheduler 与 http-gateway。 */
export type SkillPackageSource = {
  /** 入队冻结：取 Skill 当前包的不可变引用。 */
  currentForSkill(skillId: string): Promise<SkillPackageRef>;
  /** P-03 解析：未知或已下架返回 null。 */
  describe(packageId: string): Promise<SkillPackageRef | null>;
  /** P-03 取流：包缺失/损坏抛 PackageUnavailableError。 */
  open(packageId: string): Promise<{ ref: SkillPackageRef; data: Uint8Array }>;
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

/** client 观测面根：task-space 或 workspace。 */
export type ClientRunFileRoot = "task-space" | "workspace";

export type ClientRunFileEntry = {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  sizeBytes: number | null;
  modifiedAt: string;
};

export type ClientRunFileListing = {
  entries: ClientRunFileEntry[];
  truncated: boolean;
};

export type ClientRunFileContent = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  content: string | null;
  encoding: "utf-8" | null;
  binary: boolean;
  truncated: boolean;
};

export type ClientSessionArchive = {
  status: string;
  sizeBytes: number | null;
  sha256: string | null;
};

export type ClientSessionView = {
  sessionId: string;
  attemptId?: string;
  instanceId: string;
  nodeId: string;
  runId?: string;
  cwd: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  eventCount: number;
  archive: ClientSessionArchive;
};

export type ClientSessionEvent = {
  seq: number;
  ts: string;
  sessionId?: string;
  attemptId?: string;
  kind: string;
  event: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type ClientSessionEventPage = {
  items: ClientSessionEvent[];
  nextCursor?: string;
  truncatedBefore?: number;
};

export type ClientStream = {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: number;
  sha256: string;
  etag?: string;
};

/** client 运行文件只读端口；由 CMP-observability-client 实现并注入 run。 */
export type ClientRunFiles = {
  listFiles(input: {
    clientId: string;
    runId: string;
    root: ClientRunFileRoot;
    path: string;
  }): Promise<ClientRunFileListing>;
  readFile(input: {
    clientId: string;
    runId: string;
    root: ClientRunFileRoot;
    path: string;
  }): Promise<ClientRunFileContent>;
};

/** client session 只读端口；O-06/O-07/O-08/O-11。 */
export type ClientSessionObservability = {
  /** 运行中节点尚无 run_node.session_id 时，用 client O-02 按 run/node/task 反查 session；不暴露 attempt。 */
  findSession(input: { clientId: string; runId: string; nodeId: string; taskId: string }): Promise<string | null>;
  getSession(input: { clientId: string; sessionId: string }): Promise<ClientSessionView>;
  listEvents(input: {
    clientId: string;
    sessionId: string;
    cursor?: string;
    limit?: number;
  }): Promise<ClientSessionEventPage>;
  openEvents(input: {
    clientId: string;
    sessionId: string;
    lastEventId?: string;
  }): Promise<ReadableStream<Uint8Array>>;
  openRaw(input: { clientId: string; sessionId: string }): Promise<ClientStream>;
};

/** client 观测面地址目录；由 platform 实现，网关写、适配器读。 */
export type ObservabilityTarget = { url: string };

export type ObservabilityDirectory = {
  register(clientId: string, url: string): void;
  resolve(clientId: string): ObservabilityTarget | null;
};

/** client → orchestrator 的观测面 Bearer 凭据读取；由 harness 实现。 */
export type ClientCredentialReader = {
  clientToken(clientId: string): Promise<string | null>;
};
