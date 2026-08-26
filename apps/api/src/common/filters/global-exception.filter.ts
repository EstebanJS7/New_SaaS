import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { DomainError, ERROR_CODES, getStatusForCode, type ErrorCode } from "@newsaas/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { toLoggableError } from "../errors/loggable-error.js";
import { REQUEST_ID_HEADER, resolveRequestId } from "../errors/request-id.js";

export interface MappedError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
}

/** Fixed client-facing copy per code; unknown failures never leak details. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Request validation failed.",
  UNAUTHENTICATED: "Authentication required.",
  FORBIDDEN: "Access denied.",
  FEATURE_NOT_ENTITLED: "The requested feature is not enabled for this tenant.",
  NOT_FOUND: "Resource was not found.",
  CONFLICT: "Request conflicts with current state.",
  RATE_LIMITED: "Too many requests.",
  INTERNAL: "Internal server error.",
};

/** Reverse lookup status → code from the frozen registry (first wins). */
const STATUS_TO_CODE = new Map<number, ErrorCode>(
  (Object.entries(ERROR_CODES) as [ErrorCode, { status: number }][]).map(([code, entry]) => [
    entry.status,
    code,
  ])
);

interface ZodIssueShape {
  readonly path?: readonly (string | number | symbol)[];
  readonly message?: unknown;
}

const MAX_VALIDATION_ISSUES = 20;
const MAX_VALIDATION_MESSAGE_LENGTH = 512;

function isZodIssueShape(issue: unknown): issue is ZodIssueShape {
  if (typeof issue !== "object" || issue === null) return false;
  const candidate = issue as ZodIssueShape;
  return (
    typeof candidate.message === "string" ||
    (Array.isArray(candidate.path) && candidate.path.length > 0)
  );
}

/**
 * Duck-typed ZodError detection for DIRECTLY THROWN errors: matches any
 * object carrying the `name === "ZodError"` + `issues[]` contract, keeping
 * the API free of a zod-exception dependency.
 */
function readZodIssues(value: unknown): ZodIssueShape[] | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { name?: unknown; issues?: unknown };
  if (candidate.name !== "ZodError" || !Array.isArray(candidate.issues)) {
    return null;
  }
  const issues = candidate.issues.filter(isZodIssueShape);
  return issues.length > 0 ? issues : null;
}

/**
 * Shape-only issue detection for HttpException PAYLOADS: pipes commonly wrap
 * zod results as `{ statusCode, issues }` where the ZodError name is lost.
 */
function readWrappedIssues(value: unknown): ZodIssueShape[] | null {
  if (typeof value !== "object" || value === null) return null;
  const issues = (value as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const shaped = issues.filter(isZodIssueShape);
  return shaped.length > 0 ? shaped : null;
}

/**
 * Flattens validation issues into one sanitized human-readable message:
 * field path + validator text only — input values are never echoed.
 */
function flattenIssues(issues: ZodIssueShape[]): string {
  const parts = issues.slice(0, MAX_VALIDATION_ISSUES).map((issue) => {
    const path = (issue.path ?? [])
      .filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number"
      )
      .join(".");
    const text =
      typeof issue.message === "string" && issue.message.length > 0
        ? issue.message
        : DEFAULT_MESSAGES.VALIDATION_FAILED;
    return path.length > 0 ? `${path}: ${text}` : text;
  });
  const joined = parts.join("; ");
  return joined.length > MAX_VALIDATION_MESSAGE_LENGTH
    ? `${joined.slice(0, MAX_VALIDATION_MESSAGE_LENGTH)}…`
    : joined;
}

/** Pulls a developer-authored message off an HttpException response body. */
function extractHttpExceptionMessage(response: unknown): string | null {
  if (typeof response === "string") {
    const trimmed = response.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof response !== "object" || response === null) return null;
  const message = (response as { message?: unknown }).message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim();
  }
  if (Array.isArray(message)) {
    const parts = message.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
    if (parts.length > 0) return parts.join("; ");
  }
  return null;
}

/**
 * Deterministic exception → envelope input mapping (design D6).
 *
 * Order matters: DomainError first (registry contract), then zod-shaped
 * failures (direct or wrapped in an HttpException), then Nest HttpExceptions
 * via the frozen status→code table, then a generic INTERNAL for anything
 * else. Unknown errors never expose their message or stack to clients.
 */
export function mapExceptionToError(exception: unknown): MappedError {
  if (exception instanceof DomainError) {
    return {
      status: getStatusForCode(exception.code),
      code: exception.code,
      message: exception.message,
    };
  }

  const directIssues = readZodIssues(exception);
  if (directIssues) {
    return {
      status: getStatusForCode("VALIDATION_FAILED"),
      code: "VALIDATION_FAILED",
      message: flattenIssues(directIssues),
    };
  }

  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const wrappedIssues = readZodIssues(response) ?? readWrappedIssues(response);
    if (wrappedIssues) {
      return {
        status: getStatusForCode("VALIDATION_FAILED"),
        code: "VALIDATION_FAILED",
        message: flattenIssues(wrappedIssues),
      };
    }

    const code = STATUS_TO_CODE.get(exception.getStatus());
    // Statuses outside the registry collapse to a pure INTERNAL: every
    // envelope keeps an exact code↔status pair from the frozen map, and no
    // unmapped status or developer message can leak through.
    if (code === undefined) {
      return {
        status: getStatusForCode("INTERNAL"),
        code: "INTERNAL",
        message: DEFAULT_MESSAGES.INTERNAL,
      };
    }

    return {
      status: exception.getStatus(),
      code,
      message: extractHttpExceptionMessage(response) ?? DEFAULT_MESSAGES[code],
    };
  }

  return {
    status: getStatusForCode("INTERNAL"),
    code: "INTERNAL",
    message: DEFAULT_MESSAGES.INTERNAL,
  };
}

interface ErrorEnvelopeBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<FastifyReply>();
    const request = httpContext.getRequest<FastifyRequest>();

    const mapped = mapExceptionToError(exception);
    // Defensive re-validation: request.id originates in genReqId but the
    // filter must stay correct even when reached through other adapters.
    const requestId = resolveRequestId(request.id);

    this.logServerError(request, exception, mapped.status);

    const body: ErrorEnvelopeBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId,
      },
    };
    response.status(mapped.status).send(body);
  }

  /**
   * Server-side diagnostics only (never part of the response): 5xx failures
   * are logged through Fastify's per-request child logger so every line
   * carries the bound request id automatically (design D7). The curated
   * payload rides under a neutral key — pino's built-in `err` serializer
   * would re-derive its own shape from the constructor and could pull in
   * arbitrary enumerable properties.
   */
  private logServerError(request: FastifyRequest, exception: unknown, status: number): void {
    if (status < 500) return;
    request.log.error({ failure: toLoggableError(exception) }, "Unhandled request failure");
  }
}

export { REQUEST_ID_HEADER };
