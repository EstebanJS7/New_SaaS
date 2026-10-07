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
 * document or of the issuer takes part in the draw. The one that *is* decidable —
 * never equal to `dNumDoc` — is enforced, with a bounded retry so a broken source
 * cannot spin forever.
 */

import { DteValidationError } from "./dte.rules.js";

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
 * Draws `dCodSeg`. The result is nine digits, zero-padded, and never equal to
 * `documentNumber`.
 */
export function generateSecurityCode(args: GenerateSecurityCodeArgs): GeneratedSecurityCode {
  for (let attempt = 1; attempt <= SECURITY_CODE_MAX_ATTEMPTS; attempt += 1) {
    const digits: string[] = [];
    for (let position = 0; position < SECURITY_CODE_DIGITS; position += 1) {
      digits.push(String(assertDigit(args.randomDigit())));
    }
    // Left-padding is a consequence of drawing exactly nine digits; it is stated
    // rather than assumed because the Manual names it as a rule.
    const candidate = digits.join("").padStart(SECURITY_CODE_DIGITS, "0");
    if (candidate !== args.documentNumber) {
      return { dCodSeg: candidate, attempts: attempt };
    }
  }
  throw new DteValidationError(
    "INVALID_SECURITY_CODE",
    `dCodSeg collided with dNumDoc on ${SECURITY_CODE_MAX_ATTEMPTS} consecutive draws, which a ` +
      "working random source does not do; the source is not random."
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
