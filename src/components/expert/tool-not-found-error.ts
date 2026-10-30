import { ValidationError } from "../../core/kernel/index.ts";

export class ToolNotFoundError extends ValidationError {
  constructor(toolId: string, field = "items") {
    super(field, `工具 ${toolId} 不存在`);
  }
}
