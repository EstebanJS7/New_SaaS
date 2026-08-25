/**
 * Extracts a log-safe subset of an unknown thrown value.
 *
 * Only the error class, message and stack are surfaced. Arbitrary enumerable
 * properties are deliberately dropped: unknown error objects may carry
 * CONFIDENTIAL/RESTRICTED payload fragments, and pino would otherwise
 * serialize them.
 */
export function toLoggableError(
  input: unknown
): { type: string; message: string; stack?: string } | { type: string } {
  if (input instanceof Error) {
    return {
      type: input.name,
      message: input.message,
      stack: input.stack,
    };
  }
  // Never stringify the raw value — it may contain sensitive material.
  return { type: typeof input };
}
