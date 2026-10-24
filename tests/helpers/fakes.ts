import type {
  Clock,
  IdGenerator,
  Reference,
  ReferenceGuard,
} from "../../src/core/kernel/index.ts";

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export function sequentialIds(prefix = "0191f2f0-7a5e-7c3b-9d1a-3f2b4c5d"): IdGenerator {
  let counter = 0;
  return {
    next() {
      counter += 1;
      return `${prefix}${String(counter).padStart(4, "0")}`;
    },
  };
}

export function fakeGuard(references: Reference[] = []): ReferenceGuard & {
  calls: { owner: string; id: string }[];
} {
  const calls: { owner: string; id: string }[] = [];
  return {
    calls,
    async check(owner, id) {
      calls.push({ owner, id });
      return references;
    },
  };
}
