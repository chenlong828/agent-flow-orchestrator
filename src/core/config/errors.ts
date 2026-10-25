export type ConfigErrorCode =
  | "config_read_error"
  | "config_parse_error"
  | "config_validation_error";

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly source: string;
  readonly field?: string;

  constructor(
    code: ConfigErrorCode,
    source: string,
    message: string,
    field?: string,
  ) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.source = source;
    this.field = field;
  }
}
