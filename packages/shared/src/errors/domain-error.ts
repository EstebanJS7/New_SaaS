import type { ErrorCode } from "./registry.js";

/**
 * Framework-free domain error.
 *
 * Application and domain layers throw this instead of HTTP/Nest types; the
 * API's global exception filter translates it into the uniform error envelope
 * using the frozen registry. It must stay importable from web and worker
 * contexts without pulling framework dependencies.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  /**
   * Optional correlation slot. The API normally injects the request ID from
   * server context when rendering the envelope, but background jobs can set
   * it explicitly at construction time.
   */
  requestId: string | undefined;

  constructor(code: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    this.requestId = options.requestId;
  }
}

export interface DomainErrorOptions {
  /** Stable, non-sensitive structural context (e.g. field names). */
  details?: unknown;
  /** Original error being wrapped, preserved for server-side diagnostics. */
  cause?: unknown;
  /** Correlation id known before the error reaches the HTTP layer. */
  requestId?: string;
}
