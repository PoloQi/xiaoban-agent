import { z } from "zod";

type ConfigSource = Readonly<Record<string, string | undefined>>;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  XIAOBAN_API_HOST: z.string().trim().min(1).max(253).default("127.0.0.1"),
  XIAOBAN_API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_HOST: z.string().trim().min(1).max(253).default("127.0.0.1"),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65_535).default(3307),
  DATABASE_NAME: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/u).default("xiaoban_dev"),
  DATABASE_USER: z.string().regex(/^[a-z][a-z0-9_]{2,31}$/u).default("xiaoban_app"),
  DATABASE_PASSWORD: z.string().min(16).max(256),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(250).max(30_000).default(3_000),
});

const databaseRoleSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65_535),
  database: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/u),
  user: z.string().regex(/^[a-z][a-z0-9_]{2,31}$/u),
  password: z.string().min(16).max(256),
  connectionLimit: z.coerce.number().int().min(1).max(20),
  connectTimeoutMs: z.coerce.number().int().min(250).max(30_000),
});

export interface DatabaseConfig {
  connectTimeoutMs: number;
  connectionLimit: number;
  database: string;
  host: string;
  password: string;
  port: number;
  user: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  host: string;
  nodeEnv: "development" | "test" | "production";
  port: number;
}

export class ConfigError extends Error {
  readonly code = "CONFIG_INVALID";
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid configuration fields: ${fields.join(", ")}`);
    this.name = "ConfigError";
    this.fields = fields;
  }
}

export function loadConfig(source: ConfigSource = process.env): AppConfig {
  const result = configSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    XIAOBAN_API_HOST: source.XIAOBAN_API_HOST,
    XIAOBAN_API_PORT: source.XIAOBAN_API_PORT,
    DATABASE_HOST: source.DATABASE_HOST,
    DATABASE_PORT: source.DATABASE_PORT,
    DATABASE_NAME: source.DATABASE_NAME,
    DATABASE_USER: source.DATABASE_USER,
    DATABASE_PASSWORD: source.DATABASE_PASSWORD,
    DATABASE_CONNECTION_LIMIT: source.DATABASE_CONNECTION_LIMIT,
    DATABASE_CONNECT_TIMEOUT_MS: source.DATABASE_CONNECT_TIMEOUT_MS,
  });

  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter((field): field is string => typeof field === "string"),
      ),
    ].sort();

    throw new ConfigError(fields.length > 0 ? fields : ["configuration"]);
  }

  return {
    database: {
      connectionLimit: result.data.DATABASE_CONNECTION_LIMIT,
      connectTimeoutMs: result.data.DATABASE_CONNECT_TIMEOUT_MS,
      database: result.data.DATABASE_NAME,
      host: result.data.DATABASE_HOST,
      password: result.data.DATABASE_PASSWORD,
      port: result.data.DATABASE_PORT,
      user: result.data.DATABASE_USER,
    },
    host: result.data.XIAOBAN_API_HOST,
    nodeEnv: result.data.NODE_ENV,
    port: result.data.XIAOBAN_API_PORT,
  };
}

export function loadDatabaseConfig(
  source: ConfigSource,
  role: "migration" | "test",
): DatabaseConfig {
  const fieldNames =
    role === "migration"
      ? {
          database: "DATABASE_NAME",
          user: "DATABASE_MIGRATION_USER",
          password: "DATABASE_MIGRATION_PASSWORD",
        }
      : {
          database: "DATABASE_TEST_NAME",
          user: "DATABASE_TEST_USER",
          password: "DATABASE_TEST_PASSWORD",
        };
  const result = databaseRoleSchema.safeParse({
    host: source.DATABASE_HOST ?? "127.0.0.1",
    port: source.DATABASE_PORT ?? "3307",
    database: source[fieldNames.database],
    user: source[fieldNames.user],
    password: source[fieldNames.password],
    connectionLimit: source.DATABASE_CONNECTION_LIMIT ?? "5",
    connectTimeoutMs: source.DATABASE_CONNECT_TIMEOUT_MS ?? "3000",
  });

  if (!result.success) {
    const fieldMap: Record<string, string> = {
      host: "DATABASE_HOST",
      port: "DATABASE_PORT",
      database: fieldNames.database,
      user: fieldNames.user,
      password: fieldNames.password,
      connectionLimit: "DATABASE_CONNECTION_LIMIT",
      connectTimeoutMs: "DATABASE_CONNECT_TIMEOUT_MS",
    };
    const fields = [
      ...new Set(
        result.error.issues.map((issue) =>
          typeof issue.path[0] === "string"
            ? (fieldMap[issue.path[0]] ?? "configuration")
            : "configuration",
        ),
      ),
    ].sort();
    throw new ConfigError(fields);
  }

  return result.data;
}
