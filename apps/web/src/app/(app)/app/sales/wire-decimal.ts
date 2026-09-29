/**
 * Exact decimal arithmetic over wire money strings (EPIC-12 POS-004).
 *
 * The POS never parses a money literal into a JavaScript number and never calls
 * `Number()`/`parseFloat` on one: the API's amounts arrive as exact fixed-scale
 * decimal strings, and the only arithmetic this module performs is the exact
 * addition and comparison the payment-sum guard needs.
 *
 * The implementation is schoolbook digit-string arithmetic: a literal is split
 * into its integer and fraction digit strings, the pair is aligned to a common
 * scale and added digit by digit with an explicit carry. The only numbers that
 * appear are single-digit values (0..19) and the carry — never the money value
 * itself — so no binary floating-point representation, no rounding and no
 * precision loss can enter the result.
 */

/** Exact wire literal: digits with at most one decimal point and no sign. */
const WIRE_DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

interface ScaledDigits {
  /** Integer and fraction digits concatenated, most significant first. */
  readonly digits: string;
  /** Number of fraction digits held in {@link digits}. */
  readonly scale: number;
}

function parseScaled(value: string): ScaledDigits | null {
  const match = WIRE_DECIMAL_PATTERN.exec(value.trim());
  if (match === null) {
    return null;
  }
  const integer = match[1] ?? "";
  const fraction = match[2] ?? "";
  return { digits: `${integer}${fraction}`, scale: fraction.length };
}

/** Right-pads a scaled literal with zeroes up to a common scale. */
function paddedToScale(scaled: ScaledDigits, scale: number): string {
  const padding = scale - scaled.scale;
  return padding > 0 ? scaled.digits.padEnd(scaled.digits.length + padding, "0") : scaled.digits;
}

/** Schoolbook addition of two equal-length digit strings. */
function addDigits(left: string, right: string): string {
  const width = Math.max(left.length, right.length);
  const paddedLeft = left.padStart(width, "0");
  const paddedRight = right.padStart(width, "0");
  let carry = 0;
  let result = "";
  for (let index = width - 1; index >= 0; index -= 1) {
    const sum = paddedLeft.charCodeAt(index) - 48 + (paddedRight.charCodeAt(index) - 48) + carry;
    result = `${sum % 10}${result}`;
    carry = sum >= 10 ? 1 : 0;
  }
  return carry === 1 ? `1${result}` : result;
}

/** Drops leading zeroes so two equal-scale literals compare by value. */
function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, "");
}

function formatScaled(scaled: ScaledDigits): string {
  if (scaled.scale === 0) {
    return scaled.digits;
  }
  const padded = scaled.digits.padStart(scaled.scale + 1, "0");
  const cut = padded.length - scaled.scale;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

/** True when the literal is an exact non-negative decimal string. */
export function isWireDecimal(value: string): boolean {
  return WIRE_DECIMAL_PATTERN.test(value.trim());
}

/**
 * Adds exact decimal literals and returns the exact sum, or `null` when any
 * input is not an exact decimal literal. The returned literal keeps the widest
 * input scale, so `"0.10" + "0.2"` is `"0.30"` — never `0.30000000000000004`.
 */
export function addWireDecimals(values: readonly string[]): string | null {
  let total: ScaledDigits = { digits: "0", scale: 0 };
  for (const value of values) {
    const parsed = parseScaled(value);
    if (parsed === null) {
      return null;
    }
    const scale = Math.max(total.scale, parsed.scale);
    total = {
      digits: addDigits(paddedToScale(total, scale), paddedToScale(parsed, scale)),
      scale,
    };
  }
  return formatScaled(total);
}

/**
 * Compares two exact decimal literals by value, ignoring trailing-zero
 * spelling: `"10.5"` equals `"10.50"`. Returns `false` when either input is not
 * an exact decimal literal.
 */
export function wireDecimalsEqual(left: string, right: string): boolean {
  const parsedLeft = parseScaled(left);
  const parsedRight = parseScaled(right);
  if (parsedLeft === null || parsedRight === null) {
    return false;
  }
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  return (
    stripLeadingZeros(paddedToScale(parsedLeft, scale)) ===
    stripLeadingZeros(paddedToScale(parsedRight, scale))
  );
}

/**
 * The exact-sum rule of DEC-029: true only when a NON-EMPTY payment set adds up
 * to the sale total by exact value. There is no partial or zero-payment tender,
 * so an empty set can never satisfy the rule, and a set containing a literal the
 * contract does not accept can never satisfy it either.
 */
export function paymentsSumExactly(amounts: readonly string[], total: string): boolean {
  if (amounts.length === 0) {
    return false;
  }
  const sum = addWireDecimals(amounts);
  return sum !== null && wireDecimalsEqual(sum, total);
}
