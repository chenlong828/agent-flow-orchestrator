import type { Page, PageQuery, RevisionedLifecycle } from "../../core/kernel/index.ts";

export type HarnessKind = "container" | "server" | "desktop" | "laptop";
export type HarnessAccessMode = "agent" | "ssh" | "container_registry";
export type HarnessHealth = "unknown" | "online" | "offline" | "overloaded";
export type QueuePolicy = "fifo" | "priority";

type HarnessCreatePatch = {
  description?: string;
  tags?: string[];
  enabled?: boolean;
};

export type CreateHarness = {
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  concurrencyMax: number;
  queuePolicy: QueuePolicy;
} & HarnessCreatePatch;

export type UpdateHarness = Omit<CreateHarness, "enabled">;

/** 节点登记：一个 clientId 一个 token，解绑时一起清空。 */
export type HarnessClientBinding = {
  clientId: string;
  token: string;
};

export type HarnessSummary = {
  id: string;
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  enabled: boolean;
  clientId: string | null;
  health: HarnessHealth;
  lastHeartbeatAt: string | null;
  concurrencyMax: number;
  queuePolicy: QueuePolicy;
  tags: string[];
  revision: number;
  updatedAt: string;
};

export type HarnessDetail = HarnessSummary & {
  description: string;
  /** 明文 Bearer 凭据：只在本机调试时读回，列表不返回。 */
  clientToken: string | null;
  createdAt: string;
};

export type HarnessQuery = {
  q?: string;
  kind?: HarnessKind;
  enabled?: boolean;
  health?: HarnessHealth;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

export type HarnessService = {
  create(input: CreateHarness, actor?: string): Promise<{ id: string; revision: number }>;
  update(
    id: string,
    revision: number,
    input: UpdateHarness,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  /** 登记执行节点：绑定 clientId 并写入该节点的 Bearer 凭据；换绑/轮换用同一入口。 */
  bindClient(
    id: string,
    revision: number,
    binding: HarnessClientBinding,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  /** 解绑执行节点：清空 clientId 与凭据；本就未绑定视为成功。 */
  unbindClient(id: string, revision: number, actor?: string): Promise<{ id: string; revision: number }>;
  /**
   * 开发期自注册：确保该 `clientId` 有可派发的节点行。
   * 不存在则按默认值新建（`name=clientId`，名称冲突追加后缀）；已存在原样返回，不修改任何字段。
   */
  ensureNode(
    clientId: string,
    input?: { address?: string; actor?: string },
  ): Promise<{ id: string; created: boolean }>;
} & RevisionedLifecycle;

export type HarnessRead = {
  list(query: HarnessQuery): Promise<Page<HarnessSummary>>;
  get(id: string): Promise<HarnessDetail>;
  /** 按执行节点反查；未绑定返回 null。供 NodeDirectory 实现使用。 */
  getByClientId(clientId: string): Promise<HarnessSummary | null>;
  /** 已绑定且启用的 clientId；节点目录用。 */
  listClientIds(): Promise<string[]>;
  /** 该执行节点的 Bearer 凭据；未绑定/清空返回 null。仅供观测面适配器内部使用。 */
  clientToken(clientId: string): Promise<string | null>;
};
