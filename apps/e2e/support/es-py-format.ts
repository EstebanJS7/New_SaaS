/**
 * How the staff surface PRINTS an API decimal, so a spec can assert a card against the API's own
 * answer after the surface localized it for es-PY.
 *
 * The staff UI formats exact decimal strings for reading only (`apps/web/src/lib/es-py-format.ts`):
 * es-PY grouping, a comma decimal shown only when the fraction is not all zeros, and PYG as a
 * currency with no minor unit. The rule is restated here rather than imported because this lane
 * drives the built product from the outside and must not compile against its source; if the surface
 * changes how it prints an amount, the spec that uses this fails and says so.
 */
const LOCALE = "es-PY";

const decimalSeparator =
  new Intl.NumberFormat(LOCALE).formatToParts(1.1).find((part) => part.type === "decimal")?.value ??
  ",";
const integerFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const pygFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "PYG",
  maximumFractionDigits: 0,
});

function splitDecimal(amount: string): {
  readonly negative: boolean;
  readonly whole: bigint;
  readonly fraction: string;
} {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) {
    throw new Error(`"${amount}" is not an API decimal string.`);
  }
  const [, sign, wholeDigits = "0", fractionDigits = ""] = match;
  return {
    negative: sign === "-",
    whole: BigInt(wholeDigits),
    fraction: /[1-9]/.test(fractionDigits) ? `${decimalSeparator}${fractionDigits}` : "",
  };
}

/** An exact API decimal as the staff surface shows it, e.g. `"-1234.50"` → `"-1.234,50"`. */
export function esPyDecimal(amount: string): string {
  const { negative, whole, fraction } = splitDecimal(amount);
  return `${negative ? "-" : ""}${integerFormatter.format(whole)}${fraction}`;
}

/** An amount in its currency as the staff surface shows it, e.g. `("0.00", "PYG")` → `"Gs. 0"`. */
export function esPyMoney(amount: string, currency: string): string {
  if (currency !== "PYG") {
    return `${esPyDecimal(amount)} ${currency}`;
  }
  const { negative, whole, fraction } = splitDecimal(amount);
  return `${negative ? "-" : ""}${pygFormatter.format(whole)}${fraction}`;
}
