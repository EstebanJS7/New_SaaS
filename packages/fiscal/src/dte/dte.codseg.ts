/**
 * FISC-008 — generating `dCodSeg`.
 *
 * §10.3 of the Manual pins the security code completely (baseline §22.9):
 *
 * > "Debe ser un número positivo de 9 dígitos. • Aleatorio. • Debe ser distinto
 * > para cada DE y generado por un algoritmo de complejidad suficiente para
 * > evitar la reproducción del valor. • Rango NO SECUENCIAL entre 000000001 y
 * > 999999999. • No tener relación con ninguna información específica o directa
 * > del DE o del emisor de manera a garantizar su seguridad. • **No debe ser
 * > igual al número de documento campo `dNumDoc`**. • En caso de ser un número
 * > de menos de 9 dígitos completar con 0 a la izquierda."
 *
 * **Why the randomness is injected rather than imported.** `buildDteXml` is a
 * pure function and determinism is an acceptance criterion of this Story, so the
 * builder validates `dCodSeg` and never produces it. That left the *property* the
 * Manual states — "aleatorio", "no secuencial", "sin relación con el documento" —
 * with nothing that satisfies it. This module is that missing half, and it stays
 * pure by taking the source of randomness as an argument: the caller owns
 * `crypto` or any other source, and a test can pin the result exactly.
 *
 * The three properties that are not decidable by inspection are satisfied **by
 * construction**: nine independent draws are not a sequence, and no field of the
 * document or of the issuer takes part in the draw.
 *
 * **Two rules the Manual states ARE decidable, and both are handled with one
 * bounded redraw:**
 *
 * 1. **The range is `000000001` to `999999999`**, so an all-zero draw is not a
 *    value — the code must be at least 1. This one is reachable, and it is the
 *    reason the retry loop exists: a source yielding nine zeros would otherwise
 *    produce a code that `buildDteXml` refuses.
 * 2. **Never equal to `dNumDoc`.** With a well-formed `dNumDoc` — exactly seven
 *    digits, which this function requires — the two can never be equal, so the
 *    guard cannot fire. It is kept because the Manual states it, and it is what
 *    makes an out-of-contract caller fail instead of slipping through.
 */

import { DteValidationError } from "./dte.rules.js";

/** `tdNumDoc` is exactly seven digits, and its pattern forbids an all-zero value. */
const DOCUMENT_NUMBER_LENGTH = 7;
const DOCUMENT_NUMBER_PATTERN = /^(?:0+[1-9][0-9]*|[1-9]+[0-9]+)$/;

/** `tdCodSeg` is nine digits; the Manual says to zero-pad to that width. */
export const SECURITY_CODE_DIGITS = 9;

/**
 * How many times the draw is retried when it collides with `dNumDoc`. Nine digits
 * against a seven-digit document number make a collision rare, so a handful of
 * attempts is generous; the bound exists so a deterministic or broken source
 * fails loudly instead of hanging.
 */
export const SECURITY_CODE_MAX_ATTEMPTS = 8;

export interface GenerateSecurityCodeArgs {
  /** One digit, 0..9. `() => crypto.randomInt(0, 10)` is the intended caller. */
  readonly randomDigit: () => number;
  /** `dNumDoc`, which the result must never equal. */
  readonly documentNumber: string;
}

export interface GeneratedSecurityCode {
  readonly dCodSeg: string;
  /** How many draws it took. More than one means `dNumDoc` was hit and redrawn. */
  readonly attempts: number;
}

/**
 * Draws `dCodSeg`. The result is nine digits, zero-padded, at least 1, and never
 * equal to `documentNumber`.
 */
export function generateSecurityCode(args: GenerateSecurityCodeArgs): GeneratedSecurityCode {
  // `tdNumDoc` is exactly seven digits, so requiring it here is what makes the
  // `dNumDoc` comparison below meaningful rather than a comparison across widths.
  // `tdNumDoc` is BOTH `length=7` and that pattern, so the length is checked
  // separately: the pattern alone accepts "00000002".
  if (
    args.documentNumber.length !== DOCUMENT_NUMBER_LENGTH ||
    !DOCUMENT_NUMBER_PATTERN.test(args.documentNumber)
  ) {
    throw new DteValidationError(
      "INVALID_DOCUMENT_NUMBER",
      `documentNumber must be a well-formed dNumDoc: exactly seven digits, received "${args.documentNumber}".`
    );
  }

  for (let attempt = 1; attempt <= SECURITY_CODE_MAX_ATTEMPTS; attempt += 1) {
    const digits: string[] = [];
    for (let position = 0; position < SECURITY_CODE_DIGITS; position += 1) {
      digits.push(String(assertDigit(args.randomDigit())));
    }
    // Left-padding is a consequence of drawing exactly nine digits; it is stated
    // rather than assumed because the Manual names it as a rule.
    const candidate = digits.join("").padStart(SECURITY_CODE_DIGITS, "0");
    // The Manual's range starts at 000000001, so an all-zero draw is not a value.
    // This is the reachable reason for the retry: without it the generator could
    // return a code that `buildDteXml` refuses.
    if (candidate === "0".repeat(SECURITY_CODE_DIGITS)) {
      continue;
    }
    // Cannot fire for a well-formed dNumDoc — seven digits against nine — and is
    // kept because the Manual states the rule.
    if (candidate !== args.documentNumber) {
      return { dCodSeg: candidate, attempts: attempt };
    }
  }
  throw new DteValidationError(
    "INVALID_SECURITY_CODE",
    `dCodSeg was unusable on ${SECURITY_CODE_MAX_ATTEMPTS} consecutive draws — an all-zero ` +
      "value or a collision with dNumDoc — which a working random source does not do."
  );
}

/** A source that returns anything but a single digit is a programming error. */
function assertDigit(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    throw new DteValidationError(
      "INVALID_SECURITY_CODE",
      `The random source returned ${String(value)}; it must return one integer digit, 0 to 9.`
    );
  }
  return value;
}
