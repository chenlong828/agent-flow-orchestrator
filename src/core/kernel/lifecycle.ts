export type RevisionedLifecycle = {
  setEnabled(
    id: string,
    revision: number,
    enabled: boolean,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};
