import { NotFoundError, UnsupportedMediaTypeError, ValidationError } from "../../../core/kernel/index.ts";
import type { RunService } from "../../run/index.ts";
import { json, noContent } from "../respond.ts";
import { assertUuid } from "../validation.ts";
import type { RouteContext } from "./types.ts";

function requireRunInputs(ctx: RouteContext): RunService {
  if (ctx.deps.runService === undefined) throw new ValidationError("path", "运行编排未装配");
  return ctx.deps.runService;
}

/** 产品面暂存初始资料：`POST /run-inputs`、`DELETE /run-inputs/{inputId}`。 */
export async function handleRunInputs(ctx: RouteContext): Promise<Response> {
  const service = requireRunInputs(ctx);
  if (ctx.segments.length === 1) {
    if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
    return upload(ctx, service);
  }
  if (ctx.segments.length === 2) {
    if (ctx.request.method !== "DELETE") throw new NotFoundError("路径", ctx.path);
    const inputId = assertUuid(ctx.segments[1], "inputId");
    await service.deleteStagedInput(inputId);
    return noContent();
  }
  throw new NotFoundError("路径", ctx.path);
}

async function upload(ctx: RouteContext, service: RunService): Promise<Response> {
  const contentType = ctx.request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new UnsupportedMediaTypeError();
  }
  const form = await ctx.request.formData();
  for (const key of form.keys()) {
    if (key !== "file") throw new ValidationError("body", `未知字段 ${key}`);
  }
  const files = form.getAll("file");
  if (files.length !== 1) throw new ValidationError("file", "必须且只能上传一个文件");
  const file = files[0];
  if (!(file instanceof File)) throw new ValidationError("file", "缺少 file 字段");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return json(
    await service.stageInput({
      name: file.name,
      ...(file.type === "" ? {} : { mediaType: file.type }),
      bytes,
    }),
    201,
  );
}
