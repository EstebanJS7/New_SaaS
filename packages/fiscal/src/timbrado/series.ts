/**
 * FISC-011 — the series order of Manual §10.5.
 *
 * The Manual states the order and then makes it a validation:
 *
 * > "Inicialmente no se utilizará serie hasta consumir toda la numeración que va
 * > desde 0000001 al 9999999 para cada tipo de documento, luego se tendrá que
 * > hacer uso de la serie según el siguiente orden.
 * > • Orden de Serie: AA, AB, AC, … , AZ …BA, BB, …., BZ, … ZA, ZB, … , ZZ
 * > El sistema validará la secuencialidad del uso de la serie."
 *
 * **The order is exactly lexicographic over two letters `A`–`Z`, so `Ñ` needs no
 * special case.** The Manual excludes it because it is not in `A`–`Z`, and
 * `tdSerieNum` is `[A-Z]{2}` (baseline §21.3) — the same exclusion, stated twice
 * in the sources and once here. A hand-written "skip Ñ" rule would be the kind of
 * invention that drifts from the schema.
 *
 * **`null` is a real state, not a missing value.** It is the initial range, which
 * carries no series until the whole `0000001`–`9999999` range is consumed for
 * that document type. Its successor is `AA`, which is why {@link nextSeries}
 * takes `string | null` rather than defaulting to a series.
 *
 * **Skipping is refused, not merely avoided.** SIFEN approves only the previous,
 * the same, or the next series relative to the greatest it has received
 * (baseline §13), so an out-of-order series is a rejected document rather than a
 * cosmetic difference. {@link assertSeriesSuccession} is the check that makes
 * that failure local and loud.
 */

import { SERIES_PATTERN } from "../dte/dte.rules.js";

/** The first series. It starts only once the seriesless range is exhausted. */
export const FIRST_SERIES = "AA";

/** The last series. Exhausting it is terminal — a timbrado does not wrap. */
export const LAST_SERIES = "ZZ";

/** How many series exist: `26 * 26`. `AA` is ordinal 0 and `ZZ` is 675. */
export const SERIES_COUNT = 26 * 26;

export type TimbradoFailure =
  "INVALID_SERIES" | "INVALID_ORDINAL" | "SERIES_EXHAUSTED" | "SERIES_OUT_OF_ORDER";

export class TimbradoError extends Error {
  readonly failure: TimbradoFailure;

  constructor(failure: TimbradoFailure, message: string) {
    super(message);
    this.name = "TimbradoError";
    this.failure = failure;
  }
}

/** Throws unless the value is a well-formed `tdSerieNum`. */
export function assertValidSeries(series: string): void {
  if (!SERIES_PATTERN.test(series)) {
    throw new TimbradoError(
      "INVALID_SERIES",
      `A series must match tdSerieNum, [A-Z]{2}, received "${series}".`
    );
  }
}

/**
 * The series' position in the Manual's order, 0-based: `AA` is 0, `AZ` is 25,
 * `BA` is 26, `ZZ` is 675.
 */
export function seriesOrdinal(series: string): number {
  assertValidSeries(series);
  const [first, second] = series;
  return (
    (first.charCodeAt(0) - "A".charCodeAt(0)) * 26 + (second.charCodeAt(0) - "A".charCodeAt(0))
  );
}

/**
 * The next series in the Manual's order.
 *
 * `null` — the seriesless initial range — advances to `AA`. `ZZ` returns `null`,
 * which the caller must treat as terminal: a timbrado does not wrap around, and
 * continuing to issue would reuse numbers the emitter is not authorised for.
 */
export function nextSeries(current: string | null): string | null {
  if (current === null) {
    return FIRST_SERIES;
  }
  const ordinal = seriesOrdinal(current);
  if (ordinal + 1 >= SERIES_COUNT) {
    return null;
  }
  return seriesFromOrdinal(ordinal + 1);
}

/** The inverse of {@link seriesOrdinal}. */
export function seriesFromOrdinal(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= SERIES_COUNT) {
    // `INVALID_ORDINAL`, not `SERIES_EXHAUSTED`: an out-of-range ordinal is a
    // programming error, and reserving the exhausted failure for the timbrado
    // actually running out keeps the two distinguishable at the call site.
    throw new TimbradoError(
      "INVALID_ORDINAL",
      `A series ordinal is 0..${String(SERIES_COUNT - 1)}, received ${String(ordinal)}.`
    );
  }
  const first = Math.floor(ordinal / 26);
  const second = ordinal % 26;
  return String.fromCharCode("A".charCodeAt(0) + first, "A".charCodeAt(0) + second);
}

/**
 * Refuses a series that is not the successor of the current one.
 *
 * The allocation calls this rather than trusting its own arithmetic: the Manual
 * makes sequentiality a rule SIFEN validates, so a defect that skipped a series
 * would surface as a rejected DE in production instead of as a failure here.
 */
export function assertSeriesSuccession(current: string | null, candidate: string): void {
  // The candidate is validated first, so a malformed one reports `INVALID_SERIES`
  // rather than the misleading order failure that comparing it would produce.
  assertValidSeries(candidate);
  const expected = nextSeries(current);
  if (expected === null) {
    throw new TimbradoError(
      "SERIES_EXHAUSTED",
      `Series ${current ?? "(none)"} is the last one; the timbrado has no successor.`
    );
  }
  if (candidate !== expected) {
    throw new TimbradoError(
      "SERIES_OUT_OF_ORDER",
      `After ${current ?? "(no series)"} the next series is ${expected}, not ${candidate}.`
    );
  }
}
