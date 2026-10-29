import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileStore } from "../../../src/core/kernel/index.ts";
import {
  createFileStore,
  fileStoreFactory,
  StorageError,
} from "../../../src/core/platform/index.ts";

const directories: string[] = [];
let root: string;
let store: FileStore;

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentflow-store-"));
  directories.push(directory);
  return join(directory, "store");
}

beforeEach(async () => {
  root = await tempRoot();
  store = createFileStore(root);
});

afterAll(async () => {
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("platform 文件存储", () => {
  test("创建根目录，字节写入后可读，head 返回大小与时间", async () => {
    await store.put("packages/a.zip", new Uint8Array([1, 2, 3]));

    expect((await stat(root)).isDirectory()).toBe(true);
    expect(await readFile(join(root, "packages", "a.zip"))).toEqual(
      Buffer.from([1, 2, 3]),
    );

    const head = await store.head("packages/a.zip");
    expect(head).toMatchObject({ key: "packages/a.zip", size: 3 });
    expect(head?.modifiedAt).toBeInstanceOf(Date);
    expect(await new Response(await store.get("packages/a.zip")).text()).toBe(
      "\u0001\u0002\u0003",
    );
  });

  test("支持流式写入、覆盖并清理临时文件", async () => {
    await store.put("packages/a.zip", new Uint8Array([1]));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.enqueue(new TextEncoder().encode(" world"));
        controller.close();
      },
    });

    await store.put("packages/a.zip", stream);

    expect(await new Response(await store.get("packages/a.zip")).text()).toBe(
      "hello world",
    );
    expect(await readdir(join(root, "packages"))).toEqual(["a.zip"]);
  });

  test("递归列出文件，按 key 排序，支持目录前缀", async () => {
    await store.put("b.txt", new Uint8Array([1]));
    await store.put("a.txt", new Uint8Array([1, 2]));
    await store.put("nested/c.txt", new Uint8Array([1, 2, 3]));
    await store.put("packages/x.zip", new Uint8Array([1]));

    expect((await store.list("")).map((file) => file.key)).toEqual([
      "a.txt",
      "b.txt",
      "nested/c.txt",
      "packages/x.zip",
    ]);
    expect((await store.list("nested/")).map((file) => file.key)).toEqual([
      "nested/c.txt",
    ]);
    expect(await store.list("missing")).toEqual([]);
  });

  test("删除文件与空目录幂等，非空目录报错", async () => {
    await store.put("d/a.txt", new Uint8Array([1]));
    await store.put("d/b.txt", new Uint8Array([2]));

    const error = await store.delete("d").catch((caught) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect(error.operation).toBe("delete");

    await store.delete("d/a.txt");
    await store.delete("d/b.txt");
    await store.delete("d");
    await store.delete("missing");

    expect(await store.head("d/a.txt")).toBeNull();
  });

  test("同一根内移动文件，源消失、目标可读", async () => {
    await store.put("packages/a.zip", new Uint8Array([7, 8]));
    await store.move("packages/a.zip", "packages/b.zip");

    expect(await store.head("packages/a.zip")).toBeNull();
    expect(await new Response(await store.get("packages/b.zip")).bytes()).toEqual(
      new Uint8Array([7, 8]),
    );
  });

  test("缺失文件：head 返回 null，get 抛 StorageError", async () => {
    expect(await store.head("missing.txt")).toBeNull();

    const error = await store.get("missing.txt").catch((caught) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect(error.operation).toBe("get");
    expect(error.key).toBe("missing.txt");
  });

  test("拒绝绝对路径、回溯、反斜杠、控制字符与非法路径段", async () => {
    for (const key of [
      "",
      "/absolute.txt",
      "../escape.txt",
      "a/../b.txt",
      "a//b.txt",
      "a\\b.txt",
      "a/\u0000b.txt",
      ".",
      "a/./b.txt",
    ]) {
      const error = await store.put(key, new Uint8Array([1])).catch(
        (caught) => caught,
      );
      expect(error).toBeInstanceOf(StorageError);
    }

    const prefixError = await store.list("/absolute").catch((caught) => caught);
    expect(prefixError).toBeInstanceOf(StorageError);
  });

  test("流式写入失败时清理临时文件", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("流失败"));
      },
    });

    const error = await store.put("tmp/fail.bin", failing).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(StorageError);
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  test("FileStoreFactory.create 返回绑定同一根的适配器", async () => {
    const other = await tempRoot();
    const otherStore = fileStoreFactory.create(other);
    await otherStore.put("x.txt", new TextEncoder().encode("x"));

    expect(await new Response(await otherStore.get("x.txt")).text()).toBe("x");
  });
});
