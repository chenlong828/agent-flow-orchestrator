import type { Db } from "./db.ts";

export type Health = {
  check(): Promise<{ status: "ok" | "degraded"; database: "up" | "down" }>;
};

export function createHealth(db: Db): Health {
  return {
    async check() {
      try {
        await db.one("select 1 as ping");
        return { status: "ok" as const, database: "up" as const };
      } catch {
        return { status: "degraded" as const, database: "down" as const };
      }
    },
  };
}
