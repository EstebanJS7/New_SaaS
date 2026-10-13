/**
 * The one rule the Fiscal boundary applies to text a provider sent.
 *
 * Provider text reaches a `last_error_message`, a `provider_reason` or a
 * refusal's message, and the rule is the same everywhere: control characters are
 * flattened so a stored value cannot forge a log line or a UI row, and the value
 * is capped well below any column's tolerance. The cap is deliberately applied to
 * the FIELD rather than to the column: a provider is free to answer with a long
 * message and the tenant's record is free to keep the part an operator can read.
 *
 * It is shared rather than copied because two commands now persist provider text —
 * the cancellation (FISC-016 WU-C) and the range void (WU-D) — and a second copy
 * is a second policy.
 */

/** The cap every persisted provider message is written through. */
export const PROVIDER_TEXT_MAX_LENGTH = 500;

export function scrubProviderText(value: string | null): string | null {
  return value === null
    ? null
    : value.replace(/[\r\n\t]+/g, " ").slice(0, PROVIDER_TEXT_MAX_LENGTH);
}
