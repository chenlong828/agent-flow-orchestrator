import { join } from "node:path";

const ASSETS = {
  "swagger-ui.css": "text/css; charset=utf-8",
  "swagger-ui-bundle.js": "application/javascript; charset=utf-8",
  "swagger-ui-standalone-preset.js": "application/javascript; charset=utf-8",
  "favicon-32x32.png": "image/png",
} as const;

type AssetName = keyof typeof ASSETS;

export type ApiDocs = {
  handle(request: Request, url: URL): Promise<Response | null>;
};

function docsHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  };
}

function docsHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>AgentFlow B1 API 文档</title>
  <link rel="icon" type="image/png" href="/docs/favicon-32x32.png">
  <link rel="stylesheet" href="/docs/swagger-ui.css">
</head>
<body>
  <div style="margin:0;padding:12px 20px;background:#f6f7f8;border-bottom:1px solid #d8dde3;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#3b4151">
    开发者 API 文档（非产品 UI）。Try it out 会真实调用本地 API，更新、删除与装配操作会修改数据。
  </div>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script src="/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/openapi.yaml",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: "StandaloneLayout",
      tryItOutEnabled: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: false
    });
  </script>
</body>
</html>`;
}

function assetName(pathname: string): AssetName | undefined {
  if (!pathname.startsWith("/docs/")) return undefined;
  const candidate = pathname.slice("/docs/".length);
  return Object.hasOwn(ASSETS, candidate) ? (candidate as AssetName) : undefined;
}

export async function createApiDocs(options: {
  specFile: string;
  assetsDirectory: string;
}): Promise<ApiDocs> {
  const spec = await Bun.file(options.specFile).text();

  const assets = new Map<AssetName, ArrayBuffer>();
  for (const name of Object.keys(ASSETS) as AssetName[]) {
    const file = Bun.file(join(options.assetsDirectory, name));
    if (!(await file.exists())) {
      throw new Error(`缺少 API 文档静态资源：${name}`);
    }
    assets.set(name, await file.arrayBuffer());
  }

  return {
    async handle(request, url): Promise<Response | null> {
      if (request.method !== "GET") return null;

      if (url.pathname === "/docs" || url.pathname === "/docs/") {
        return new Response(docsHtml(), { headers: docsHeaders("text/html; charset=utf-8") });
      }

      if (url.pathname === "/openapi.yaml") {
        return new Response(spec, {
          headers: docsHeaders("application/yaml; charset=utf-8"),
        });
      }

      const name = assetName(url.pathname);
      if (name === undefined) return null;

      const body = assets.get(name);
      if (body === undefined) return null;
      return new Response(body, { headers: docsHeaders(ASSETS[name]) });
    },
  };
}
