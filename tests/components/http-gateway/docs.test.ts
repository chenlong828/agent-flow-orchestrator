import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createHealth } from "../../../src/core/platform/index.ts";
import {
  createApiDocs,
  createHttpApp,
  type ApiDocs,
} from "../../../src/components/http-gateway/index.ts";
import { closeTestDb } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

const ROOT = join(import.meta.dir, "../../..");
const ASSETS_DIRECTORY = join(
  ROOT,
  "src",
  "components",
  "http-gateway",
  "docs-assets",
);

let docs: ApiDocs;
let ctx: TestContext;

function request(path: string, method = "GET"): Request {
  return new Request(`http://127.0.0.1:3100${path}`, { method });
}

async function handle(path: string, method = "GET"): Promise<Response | null> {
  const req = request(path, method);
  return docs.handle(req, new URL(req.url));
}

beforeAll(async () => {
  docs = await createApiDocs({
    assetsDirectory: ASSETS_DIRECTORY,
  });
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestDb();
});

describe("Swagger 文档端点", () => {
  test("OpenAPI 只由组件持有，不再保留设计目录副本", async () => {
    expect(
      await Bun.file(
        join(ROOT, "docs", "design", "components", "http-gateway", "openapi.yaml"),
      ).exists(),
    ).toBe(false);
    expect(
      await Bun.file(
        join(ROOT, "src", "components", "http-gateway", "openapi.yaml"),
      ).exists(),
    ).toBe(true);
  });

  test("/docs 与 /docs/ 返回 Swagger UI HTML，并只引用本地资源", async () => {
    for (const path of ["/docs", "/docs/"]) {
      const response = await handle(path);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response!.headers.get("cache-control")).toBe("no-cache");
      const html = await response!.text();
      expect(html).toContain('id="swagger-ui"');
      expect(html).toContain("开发者 API 文档（非产品 UI）");
      expect(html).toContain('url: "/openapi.yaml"');
      expect(html).toContain("/docs/swagger-ui.css");
      expect(html).toContain("/docs/swagger-ui-bundle.js");
      expect(html).toContain("/docs/swagger-ui-standalone-preset.js");
      expect(html).not.toContain("cdn.jsdelivr.net");
      expect(html).not.toContain("unpkg.com");
    }
  });

  test("/openapi.yaml 返回可解析的 OpenAPI，servers 使用当前服务", async () => {
    const response = await handle("/openapi.yaml");
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("application/yaml; charset=utf-8");
    const spec = Bun.YAML.parse(await response!.text()) as any;
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info["x-runtime-asset"]).toBe(true);
    expect(spec.info["x-source-spec"]).toBe(
      "docs/design/components/http-gateway/spec.md",
    );
    expect(spec.servers).toEqual([
      {
        url: "/",
        description: "当前文档所在服务；业务路径已包含 /api/v1，/healthz 不在版本内。",
      },
    ]);
  });

  test("本地 CSS/JS 资源可读取，未知路径与错误方法不被文档接管", async () => {
    const assets = [
      ["/docs/swagger-ui.css", "text/css; charset=utf-8", ".swagger-ui"],
      [
        "/docs/swagger-ui-bundle.js",
        "application/javascript; charset=utf-8",
        "SwaggerUIBundle",
      ],
      [
        "/docs/swagger-ui-standalone-preset.js",
        "application/javascript; charset=utf-8",
        "SwaggerUIStandalonePreset",
      ],
    ] as const;

    for (const [path, contentType, marker] of assets) {
      const response = await handle(path);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get("content-type")).toBe(contentType);
      const text = await response!.text();
      expect(text.length).toBeGreaterThan(1000);
      expect(text).toContain(marker);
    }

    const icon = await handle("/docs/favicon-32x32.png");
    expect(icon).not.toBeNull();
    expect(icon!.status).toBe(200);
    expect(icon!.headers.get("content-type")).toBe("image/png");
    expect((await icon!.arrayBuffer()).byteLength).toBe(628);

    expect(await handle("/docs/unknown")).toBeNull();
    expect(await handle("/docs/..%2Fopenapi.yaml")).toBeNull();
    expect(await handle("/docs", "POST")).toBeNull();
  });

  test("网关委托文档路由；未注入 docs 时保持原有 404", async () => {
    const docsApp = createHttpApp({
      catalog: ctx.catalog,
      harnessService: ctx.harnessService,
      toolService: ctx.toolService,
      skillDraftService: ctx.skillDraftService,
      expertService: ctx.expertService,
      workflowService: ctx.workflowService,
      health: createHealth(ctx.db),
      actor: "tester",
      docs,
    });

    const page = await docsApp(request("/docs"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");

    const spec = await docsApp(request("/openapi.yaml"));
    expect(spec.status).toBe(200);

    const unknown = await docsApp(request("/docs/nope"));
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("not_found");

    const wrongMethod = await docsApp(request("/docs", "POST"));
    expect(wrongMethod.status).toBe(404);

    const withoutDocs = await ctx.app(request("/docs"));
    expect(withoutDocs.status).toBe(404);
    expect((await withoutDocs.json()).error.code).toBe("not_found");
  });

  test("缺少静态资源时启动失败，不带病提供服务", async () => {
    await expect(
      createApiDocs({
        assetsDirectory: join(ROOT, "src", "components", "http-gateway", "no-such-assets"),
      }),
    ).rejects.toThrow("缺少 API 文档静态资源");
  });
});
