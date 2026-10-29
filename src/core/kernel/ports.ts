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

/** 文件内容；写路径可传内存块或流。 */
export type FileData = Uint8Array | ReadableStream<Uint8Array>;

export type FileStat = {
  /** 相对存储根的 POSIX 键。 */
  key: string;
  /** 字节数。 */
  size: number;
  modifiedAt: Date;
};

/** 文件存储端口，由 platform 实现；业务组件不直接使用 Bun 文件 API。 */
export type FileStore = {
  put(key: string, data: FileData): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  head(key: string): Promise<FileStat | null>;
  list(prefix: string): Promise<FileStat[]>;
  delete(key: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
};
