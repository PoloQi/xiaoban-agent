import { errorResponseSchema, type ErrorCode } from "@xiaoban/contracts";
import type { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly nextAction: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requestJson<T>(
  path: string,
  init: RequestInit,
  schema: ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", "暂时连不上服务。", "检查网络后重试。");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(body);
    if (error.success) {
      throw new ApiError(
        error.data.error.code,
        error.data.error.message,
        error.data.error.nextAction,
      );
    }
    throw new ApiError("INTERNAL_ERROR", "服务暂时无法完成请求。", "请稍后重试。");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError("INTERNAL_ERROR", "服务返回了无法识别的结果。", "请稍后重试。");
  }
  return result.data;
}

export function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
