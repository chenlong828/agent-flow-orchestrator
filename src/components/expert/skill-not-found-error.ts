import { ValidationError } from "../../core/kernel/index.ts";

export class SkillNotFoundError extends ValidationError {
  constructor(skillId: string, field = "items") {
    super(field, `Skill ${skillId} 不存在`);
  }
}
