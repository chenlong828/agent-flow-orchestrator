import type { Page, PageQuery } from "../../core/kernel/index.ts";

export type HarnessKind = "container" | "server" | "desktop" | "laptop";
export type HarnessAccessMode = "agent" | "ssh" | "container_registry";
export type HarnessHealth = "unknown" | "online" | "offline" | "overloaded";
export type QueuePolicy = "fifo" | "priority";

export type CreateHarness = {
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  description?: string;
  concurrencyMax: number;
  queuePolicy: QueuePolicy;
  tags?: string[];
  enabled?: boolean;
};

export type UpdateHarness = Omit<CreateHarness, "enabled">;

export type HarnessSummary = {
  id: string;
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  enabled: boolean;
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
  setEnabled(
    id: string,
    revision: number,
    enabled: boolean,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

export type HarnessRead = {
  list(query: HarnessQuery): Promise<Page<HarnessSummary>>;
  get(id: string): Promise<HarnessDetail>;
};
