import { ValidationError } from "../../core/kernel/index.ts";

export class SkillNotFoundError extends ValidationError {
  constructor(skillId: string, field = "items") {
    super(field, `Skill ${skillId} 不存在`);
  }
}

export class ToolNotFoundError extends ValidationError {
  constructor(toolId: string, field = "items") {
    super(field, `工具 ${toolId} 不存在`);
  }
}
