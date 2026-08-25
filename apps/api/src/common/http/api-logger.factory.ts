import pino, { type DestinationStream, type Logger } from "pino";

export type ApiLogger = Logger;

/** Placeholder written in place of every redacted value. */
export const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Log paths that must never reach structured output.
 *
 * Covers the session/credential carriers called out by the data
 * classification rules: request cookie/authorization headers plus
 * credential-shaped object keys at the top level and one segment deep.
 * Wildcards match exactly one key segment, so deeper nesting must be listed
 * explicitly if it ever appears. Bodies are never serialized by default —
 * these guards protect explicit app-level `log.info({ user })` style calls.
 */
export const LOG_REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "hash",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.tokenHash",
  "*.hash",
] as const;

export interface CreateApiLoggerOptions {
  /** Override for tests; defaults to "info". */
  level?: string;
  /** Capture stream override for tests; defaults to stderr (fd 2). */
  stream?: DestinationStream;
}

/**
 * Creates the API's root pino logger (design D7).
 *
 * Reads raw NODE_ENV on purpose: the logger must exist before env schema
 * validation so it can report validation failures — on STDERR, keeping
 * stdout free for application data and making startup failures visible to
 * process supervisors. There is intentionally no pretty/dev transport: JSON
 * lines everywhere means nothing to accidentally enable in production.
 */
export function createApiLogger(options: CreateApiLoggerOptions = {}): ApiLogger {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return pino(
    {
      level: options.level ?? "info",
      base: { service: "api", env: nodeEnv },
      redact: {
        paths: [...LOG_REDACT_PATHS],
        censor: REDACTED_PLACEHOLDER,
      },
    },
    options.stream ?? pino.destination({ fd: 2 })
  );
}
