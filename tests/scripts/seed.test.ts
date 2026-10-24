import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, getTestDb, resetBusinessData } from "../helpers/test-db.ts";
import { seedAll } from "../../scripts/seed.ts";

let db: Awaited<ReturnType<typeof getTestDb>>;

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("演示种子", () => {
  test("首轮写入 5/10/12/8 与 23/23 条装配边", async () => {
    const result = await seedAll(db);
    expect(result).toEqual({
      harnesses: 5,
      tools: 10,
      skills: 12,
      experts: 8,
      expertSkills: 23,
      expertTools: 23,
    });
    const counts = await db.one<{
      harnesses: number;
      tools: number;
      skills: number;
      experts: number;
    }>(
      `select
        (select count(*)::int from harness) as harnesses,
        (select count(*)::int from tool) as tools,
        (select count(*)::int from skill) as skills,
        (select count(*)::int from expert) as experts`,
    );
    expect(counts).toEqual({ harnesses: 5, tools: 10, skills: 12, experts: 8 });
  });

  test("重复执行幂等，不产生重复行与重复装配边，版本保持 UI 值", async () => {
    await seedAll(db);
    await seedAll(db);
    const counts = await db.one<{ harnesses: number; skills: number; skillEdges: number }>(
      `select
        (select count(*)::int from harness) as harnesses,
        (select count(*)::int from skill) as skills,
        (select count(*)::int from expert_skill) as "skillEdges"`,
    );
    expect(counts).toEqual({ harnesses: 5, skills: 12, skillEdges: 23 });

    const cres = await db.one<{ version: string; tags: number }>(
      `select s.version,
        (select count(*)::int from skill_tag t where t.skill_id = s.id) as tags
       from skill s where s.name = 'CRES 技能'`,
    );
    expect(cres).toEqual({ version: "v1.4", tags: 2 });
  });

  test("种子数据满足引用完整性与分类覆盖", async () => {
    await seedAll(db);
    const categories = await db.query<{ category_code: string; count: number }>(
      "select category_code, count(*)::int from skill group by category_code order by category_code",
    );
    expect(categories).toEqual([
      { category_code: "coding", count: 2 },
      { category_code: "retrieval", count: 4 },
      { category_code: "review", count: 3 },
      { category_code: "testing", count: 3 },
    ]);

    const dangling = await db.query(
      `select 1 from expert_skill es
       left join skill s on s.id = es.skill_id
       where s.id is null`,
    );
    expect(dangling.length).toBe(0);
  });
});
