export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  next(): string;
};

/** 可被引用的资产类型；删除前由领域服务通过 ReferenceGuard 检查。 */
export type ReferenceOwner = "harness" | "tool" | "skill";

export type Reference = {
  type: "tool" | "expert";
  id: string;
  name: string;
};

/** 引用检查端口，由 catalog 实现，组合根注入领域删除服务。 */
export type ReferenceGuard = {
  check(owner: ReferenceOwner, id: string): Promise<Reference[]>;
};
