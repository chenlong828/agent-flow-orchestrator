/** 运行/节点错误摘要的稳定形状；与 HTTP 响应里的 error 字段一致。 */
export type ErrorView = { code: string; message: string } | null;
