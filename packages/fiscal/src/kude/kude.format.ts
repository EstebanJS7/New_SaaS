/**
 * FISC-013 WU-C — the KuDE's printed forms.
 *
 * Three transformations separate the signed DE's own encoding from what the
 * reference models print (§26.4.6), and **none of them changes a value**:
 *
 * - **Amounts.** The DE carries `tMontoBase` values with a fixed scale
 *   (`110000.0000`); the models print `110.000`. So the fractional part's
 *   trailing zeros are dropped and the integer part is grouped in threes with
 *   `.` — the Paraguayan convention the samples use throughout. The operation is
 *   string surgery on purpose: `Number` would put money through a float, and a
 *   rounding rule is exactly what §26.6.7 leaves open, so this module never
 *   rounds.
 * - **Dates.** `dFeIniT` is `AAAA-MM-DD` and the models print `01/07/2017`;
 *   `dFeEmiDE` is `fecHhmmss` and they print `28-09-2017 16:22:48`. Both are
 *   sliced, never parsed into a `Date`, because a `Date` would re-enter the
 *   instant through the host's timezone — and the DE's own instants are
 *   timezone-less by §21.
 * - **The CDC.** §26.4.6 prints it in groups of four.
 *
 * The Manual's worked example reconciles under this reading and is the check
 * that keeps it honest: three items of `110000`, `80000` and `10000` print as
 * `110.000`, `80.000` and `10.000` under the `10%` column, the subtotal prints
 * `200.000`, and the IVA settlement prints `18.181` — which is eighteen
 * thousand one hundred eighty-one guaraníes, not a three-decimal fraction.
 */

/** Group an integer digit string in threes with `.`, left to right. */
function groupThousands(integerDigits: string): string {
  const negative = integerDigits.startsWith("-");
  const digits = negative ? integerDigits.slice(1) : integerDigits;
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ".";
    grouped += digits[index];
  }
  return negative ? `-${grouped}` : grouped;
}

/**
 * The printed form of a DE amount: the same value, grouped, with no rounding.
 *
 * A value that is not a plain decimal string is returned unchanged rather than
 * silently coerced — an amount this module cannot read is a value the DE did not
 * carry, and the builder reports that as an absence instead.
 */
export function formatKudeAmount(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [integerPart, fractionalPart = ""] = trimmed.split(".");
  const significantFraction = fractionalPart.replace(/0+$/, "");
  const grouped = groupThousands(integerPart);
  return significantFraction === "" ? grouped : `${grouped}.${significantFraction}`;
}

/**
 * `AAAA-MM-DD` to the models' `DD/MM/AAAA` (§26.4.6 prints `01/07/2017` for the
 * timbrado's start of validity).
 */
export function formatKudeDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match === null ? value.trim() : `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * `fecHhmmss` to the models' `DD-MM-AAAA hh:mm:ss` (§26.4.6 prints
 * `28-09-2017 16:22:48`). The date and the time keep their own separators,
 * because that is what the sample prints.
 */
export function formatKudeDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  return match === null ? value.trim() : `${match[3]}-${match[2]}-${match[1]} ${match[4]}`;
}

/**
 * The CDC in groups of four (§26.4.6 prints
 * `0144 4444 0170 0100 1001 4528 2250 1201 7158 7322 6094`).
 *
 * A CDC that is not the eleven-digit-block form the samples show is returned
 * unchanged: grouping is a printed convention, and inventing breaks in a
 * forty-four character string would print a number the reader cannot check.
 */
export function groupKudeCdc(cdc: string): string {
  const trimmed = cdc.trim();
  if (!/^\d{44}$/.test(trimmed)) return trimmed;
  return (trimmed.match(/.{1,4}/g) ?? []).join(" ");
}
