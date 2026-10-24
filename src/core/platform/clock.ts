import type { Clock, IdGenerator } from "../kernel/index.ts";

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

export const uuidv7Ids: IdGenerator = {
  next(): string {
    return Bun.randomUUIDv7();
  },
};
