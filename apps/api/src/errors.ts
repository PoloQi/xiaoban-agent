import type { ErrorCode } from "@xiaoban/contracts";

export class PublicAppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 503;

  constructor(
    code: ErrorCode,
    statusCode: PublicAppError["statusCode"],
  ) {
    super(code);
    this.name = "PublicAppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
