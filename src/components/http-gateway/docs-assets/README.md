# Swagger UI 静态资源

本目录是 `swagger-ui-dist@5.34.0` 的运行资源，由 `src/components/http-gateway/docs.ts` 读取并提供给 `/docs`。

- 不手改 `swagger-ui.css`、`swagger-ui-bundle.js`、`swagger-ui-standalone-preset.js`、`favicon-32x32.png`。
- 升级时从 `https://unpkg.com/swagger-ui-dist@<version>/` 取同名文件，更新 `VERSION` 中的版本与 SHA-256，并跑文档测试。
- `LICENSE` 与 `NOTICE` 是上游 Apache-2.0 许可材料，随资源保留。
- 只保留运行所需文件；不引入 source map、示例页或其他未使用的资源。
