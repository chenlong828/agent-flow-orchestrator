export type Waiters = ReturnType<typeof createWaiters>;

/** 长轮询的唤醒与同 client 串行：只保留等待者集合与串行链。 */
export function createWaiters() {
  const waiters = new Map<string, Set<() => void>>();
  const chains = new Map<string, Promise<unknown>>();

  const notify = (clientId: string): void => {
    const set = waiters.get(clientId);
    if (set === undefined) return;
    waiters.delete(clientId);
    for (const resolve of set) resolve();
  };

  return {
    notify,
    notifyAll(): void {
      for (const clientId of [...waiters.keys()]) notify(clientId);
    },
    awaitWake(clientId: string, holdMs: number): Promise<void> {
      const set = waiters.get(clientId) ?? new Set<() => void>();
      waiters.set(clientId, set);
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        set.add(finish);
        setTimeout(finish, Math.max(0, holdMs));
      });
    },
    singleFlight<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
      const previous = chains.get(clientId) ?? Promise.resolve();
      const next = previous.then(fn, fn);
      chains.set(
        clientId,
        next.then(
          () => undefined,
          () => undefined,
        ),
      );
      return next;
    },
  };
}
