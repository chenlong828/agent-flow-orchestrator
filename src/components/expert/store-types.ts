export type ExpertRootRow = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  duty: string;
  skill_order: string;
  verify_order: string;
  notes: string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  skill_count: number;
  tool_count: number;
};

export type ExpertRootWrite = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  now: Date;
  actor: string | null;
};

export type ExpertRefRow = {
  expert_id: string;
  position: number;
  label: string;
  ref_type: string;
  path: string | null;
};
