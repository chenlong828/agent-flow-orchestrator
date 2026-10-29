import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConfigError,
  loadConfig,
  type LoadConfigOptions,
} from "../../src/core/config/index.ts";

const directories: string[] = [];

async function tempConfigDir(
  files: Record<string, string> = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentflow-config-"));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content, "utf8");
  }
  return directory;
}

function options(
  configDir: string,
  env: LoadConfigOptions["env"] = {},
): LoadConfigOptions {
  return { configDir, env };
}

afterAll(async () => {
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CMP-config 默认值与文件覆盖", () => {
  test("无配置文件时使用代码默认值", async () => {
    const configDir = await tempConfigDir();
    expect(await loadConfig(options(configDir))).toEqual({
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: "postgres://postgres@127.0.0.1:54329/agentflow",
      actor: "local",
      logLevel: "info",
      skillStorageRoot: ".local/skills",
      skillDraftTtlHours: 24,
    });
  });

  test("default.toml 覆盖默认值，local.toml 只覆盖指定字段", async () => {
    const configDir = await tempConfigDir({
      "default.toml": [
        "[server]",
        'host = "0.0.0.0"',
        "port = 3000",
        "",
        "[app]",
        'actor = "team"',
        "",
        "[log]",
        'level = "warn"',
      ].join("\n"),
      "local.toml": "[server]\nport = 3100\n",
    });

    expect(await loadConfig(options(configDir))).toEqual({
      host: "0.0.0.0",
      port: 3100,
      databaseUrl: "postgres://postgres@127.0.0.1:54329/agentflow",
      actor: "team",
      logLevel: "warn",
      skillStorageRoot: ".local/skills",
      skillDraftTtlHours: 24,
    });
  });

  test("环境变量覆盖 TOML，空字符串视为未设置", async () => {
    const configDir = await tempConfigDir({
      "default.toml": "[server]\nport = 3000\n",
    });

    expect(
      await loadConfig(
        options(configDir, {
          HOST: "127.0.0.2",
          PORT: "3200",
          DATABASE_URL: "postgres://u@db:5432/x",
          DEV_ACTOR: "alice",
          LOG_LEVEL: "debug",
          SKILL_STORAGE_ROOT: "/srv/skills",
          SKILL_DRAFT_TTL_HOURS: "48",
        }),
      ),
    ).toEqual({
      host: "127.0.0.2",
      port: 3200,
      databaseUrl: "postgres://u@db:5432/x",
      actor: "alice",
      logLevel: "debug",
      skillStorageRoot: "/srv/skills",
      skillDraftTtlHours: 48,
    });

    expect(
      await loadConfig(
        options(configDir, {
          PORT: "",
          HOST: "",
          DEV_ACTOR: "",
          LOG_LEVEL: "",
          DATABASE_URL: "",
          SKILL_STORAGE_ROOT: "",
          SKILL_DRAFT_TTL_HOURS: "",
        }),
      ),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      actor: "local",
      logLevel: "info",
      skillStorageRoot: ".local/skills",
      skillDraftTtlHours: 24,
    });
  });

  test("CONFIG_FILE 只读显式文件，并仍接受环境变量覆盖", async () => {
    const configDir = await tempConfigDir({
      "default.toml": "[server]\nport = 3000\n",
      "local.toml": "[server]\nport = 3100\n",
      "custom.toml": "[server]\nport = 3300\n",
    });

    expect(
      await loadConfig(
        options(configDir, {
          CONFIG_FILE: join(configDir, "custom.toml"),
        }),
      ),
    ).toMatchObject({ port: 3300 });

    expect(
      await loadConfig(
        options(configDir, {
          CONFIG_FILE: join(configDir, "custom.toml"),
          PORT: "3400",
        }),
      ),
    ).toMatchObject({ port: 3400 });
  });
});

describe("CMP-config 校验与失败语义", () => {
  test("非法 TOML 返回 config_parse_error，并带文件路径", async () => {
    const configDir = await tempConfigDir({
      "default.toml": "[server\nport = 3100\n",
    });

    const error = await loadConfig(options(configDir)).catch((caught) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.code).toBe("config_parse_error");
    expect(error.source).toBe(join(configDir, "default.toml"));
  });

  test("未知配置项被拒绝，并带字段路径", async () => {
    const configDir = await tempConfigDir({
      "default.toml": "[server]\nprot = 3100\n",
    });

    const error = await loadConfig(options(configDir)).catch((caught) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.code).toBe("config_validation_error");
    expect(error.field).toBe("server.prot");
  });

  test("非法端口与日志级别被拒绝", async () => {
    const badPortDir = await tempConfigDir({
      "default.toml": "[server]\nport = 0\n",
    });
    const badPort = await loadConfig(options(badPortDir)).catch((caught) => caught);
    expect(badPort).toBeInstanceOf(ConfigError);
    expect(badPort.field).toBe("server.port");

    const badEnvPortDir = await tempConfigDir();
    const badEnvPort = await loadConfig(
      options(badEnvPortDir, { PORT: "70000" }),
    ).catch((caught) => caught);
    expect(badEnvPort).toBeInstanceOf(ConfigError);
    expect(badEnvPort.field).toBe("PORT");

    const badLevelDir = await tempConfigDir({
      "default.toml": "[log]\nlevel = \"verbose\"\n",
    });
    const badLevel = await loadConfig(options(badLevelDir)).catch(
      (caught) => caught,
    );
    expect(badLevel).toBeInstanceOf(ConfigError);
    expect(badLevel.field).toBe("log.level");
    expect(badLevel.source).toBe(join(badLevelDir, "default.toml"));
  });

  test("空 HOST 与缺失的 CONFIG_FILE 被拒绝", async () => {
    const configDir = await tempConfigDir();
    const emptyHost = await loadConfig(
      options(configDir, { HOST: "   " }),
    ).catch((caught) => caught);
    expect(emptyHost).toBeInstanceOf(ConfigError);
    expect(emptyHost.code).toBe("config_validation_error");
    expect(emptyHost.field).toBe("HOST");

    const missingPath = join(configDir, "missing.toml");
    const missing = await loadConfig(
      options(configDir, { CONFIG_FILE: missingPath }),
    ).catch((caught) => caught);
    expect(missing).toBeInstanceOf(ConfigError);
    expect(missing.code).toBe("config_read_error");
    expect(missing.source).toBe(missingPath);
  });

  test("空 SKILL_STORAGE_ROOT 回退默认值，空白值被拒绝", async () => {
    const configDir = await tempConfigDir();

    expect(
      await loadConfig(options(configDir, { SKILL_STORAGE_ROOT: "" })),
    ).toMatchObject({ skillStorageRoot: ".local/skills" });

    expect(
      await loadConfig(
        options(configDir, { SKILL_STORAGE_ROOT: "/srv/af skills" }),
      ),
    ).toMatchObject({ skillStorageRoot: "/srv/af skills" });

    const blank = await loadConfig(
      options(configDir, { SKILL_STORAGE_ROOT: "   " }),
    ).catch((caught) => caught);
    expect(blank).toBeInstanceOf(ConfigError);
    expect(blank.code).toBe("config_validation_error");
    expect(blank.source).toBe("env");
    expect(blank.field).toBe("SKILL_STORAGE_ROOT");
  });

  test("非法 SKILL_DRAFT_TTL_HOURS 被拒绝，并带环境字段", async () => {
    const configDir = await tempConfigDir();

    for (const value of ["0", "-1", "1.5", "abc"]) {
      const error = await loadConfig(
        options(configDir, { SKILL_DRAFT_TTL_HOURS: value }),
      ).catch((caught) => caught);
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.code).toBe("config_validation_error");
      expect(error.source).toBe("env");
      expect(error.field).toBe("SKILL_DRAFT_TTL_HOURS");
    }
  });
});
