import type { Clock } from "../../core/kernel/index.ts";
import { toIso } from "./mappers.ts";
import type { ClientPresenceView } from "./types.ts";
import type { Waiters } from "./waiters.ts";

export type Presence = {
  lastPollAt: Date | null;
  free: number | null;
  running: number;
  stopRequested: boolean;
  capabilities: string[];
};

export type PresenceTracker = ReturnType<typeof createPresenceTracker>;

const IDLE: Presence = { lastPollAt: null, free: null, running: 0, stopRequested: false, capabilities: [] };

export function createPresenceTracker(waiters: Waiters, clock: Clock) {
  const map = new Map<string, Presence>();

  return {
    touch(clientId: string, free: number, running: number, capabilities: string[] = []): Presence {
      const previous = map.get(clientId) ?? IDLE;
      const next: Presence = {
        lastPollAt: clock.now(),
        free,
        running,
        stopRequested: previous.stopRequested,
        capabilities,
      };
      map.set(clientId, next);
      return next;
    },

    markPolled(clientId: string): void {
      const current = map.get(clientId);
      if (current !== undefined) current.lastPollAt = clock.now();
    },

    get(clientId: string): Presence | undefined {
      return map.get(clientId);
    },

    requestStop(clientId: string): void {
      const previous = map.get(clientId) ?? IDLE;
      map.set(clientId, { ...previous, stopRequested: true });
      waiters.notify(clientId);
    },

    views(clientIds: string[]): ClientPresenceView[] {
      return clientIds.map((clientId) => {
        const seen = map.get(clientId);
        return {
          clientId,
          lastPollAt: seen?.lastPollAt == null ? null : toIso(seen.lastPollAt),
          free: seen?.free ?? null,
          running: seen?.running ?? 0,
          capabilities: seen?.capabilities ?? [],
        };
      });
    },
  };
}
