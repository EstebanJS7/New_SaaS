/**
 * FISC-011 WU-D — allocating the next document number.
 *
 * The Manual's §10.5 numbering is consumed one number at a time, and the two
 * rules that make it a ledger rather than a counter are both here:
 *
 * 1. **A consumed number is never reused.** §6.5 lets a rejected DE reuse its
 *    own CDC, and the number is part of the CDC, so a number is burnt the moment
 *    it is handed out. The claim is a compare-and-swap, never a read-then-write:
 *    two callers that observe the same counter cannot both take it.
 * 2. **The series advances in the Manual's order, and only in that order.** When
 *    a range runs out the numbering continues in the next series — `null -> AA ->
 *    AB -> … -> ZZ` — and `ZZ` exhausted is terminal, because wrapping would hand
 *    out numbers the emitter is not authorised for.
 *
 * **Why this module owns no transaction and no Prisma client.** It is written
 * against a {@link TimbradoRangeStore}: four named operations the caller
 * implements over its own transaction client, the same shape
 * `FiscalSigningMaterialDelegate` uses in the API so a test can pass a fake. The
 * caller owns the transaction, so the claim and the rollover commit together or
 * not at all, and this module stays pure enough to test the racing without a
 * database.
 *
 * **Why the store is named operations and not the raw Prisma delegate.** It was
 * the raw delegate first, and it does not fit: Prisma's `updateMany` is generic
 * over a `SelectSubset` of an `XOR<>` data type, and a signature declared outside
 * the package is not assignable to it. `findFirst` fits and `updateMany` does
 * not — so a port that promised the raw delegate would be a promise this package
 * cannot keep. The named operations keep the port Prisma-free and strongly typed;
 * the cost is that the compare-and-swap's `where` clause lives in the adapter,
 * which is why `claimNumber` takes the observed value it must compare against
 * rather than letting the adapter choose one.
 *
 * **Which range is "current".** A review of the schema found that the timbrado
 * number is part of a range's identity, which means **two authorisations may each
 * be `ACTIVE` at once** — next year's timbrado has to be registrable while this
 * year's is still in use. So the allocation does not take "the ACTIVE range": it
 * takes the ACTIVE range with the **greatest `validityStart`**, which is the
 * current authorisation.
 */

import { SERIES_COUNT, type TimbradoError, nextSeries } from "./series.js";

/** `tdNumDoc`: exactly seven digits, zero-padded, never all zero. */
export const DOCUMENT_NUMBER_WIDTH = 7;

/** The largest `tdNumDoc`; `9999999` is the end of an unrestricted range. */
export const MAX_DOCUMENT_NUMBER = 9_999_999;

/**
 * How many times the allocation re-reads **without making progress**.
 *
 * This is a spin guard, not a contention limit: each retry is one cheap
 * compare-and-swap, and the worst case under N concurrent callers is N attempts.
 * A bound of 8 would therefore start failing at eight simultaneous documents for
 * the same key, which is a busy day rather than an impossible one. 32 leaves room
 * for that while still failing loudly instead of looping forever.
 *
 * A successful rollover is progress and does not spend the budget; the loop is
 * still bounded because each rollover moves to a strictly greater series and `ZZ`
 * raises `SERIES_EXHAUSTED`.
 */
export const ALLOCATION_MAX_ATTEMPTS = 32;

export type TimbradoAllocationFailure =
  "RANGE_NOT_FOUND" | "SERIES_EXHAUSTED" | "ALLOCATION_CONTENDED" | "INVALID_RANGE";

export class TimbradoAllocationError extends Error {
  readonly failure: TimbradoAllocationFailure;

  constructor(failure: TimbradoAllocationFailure, message: string) {
    super(message);
    this.name = "TimbradoAllocationError";
    this.failure = failure;
  }
}

/** The range as the allocation needs to see it. */
export interface TimbradoRangeRecord {
  readonly id: string;
  readonly timbradoNumber: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  /** NULL is the seriesless initial range, which is a state and not a gap. */
  readonly series: string | null;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: Date;
  readonly nextNumber: number;
}

/** What identifies the authorisation a number is drawn from. */
export interface TimbradoRangeKey {
  /** Supplied by the caller from its own authority, never invented here. */
  readonly tenantId: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
}

/**
 * The four operations the allocation needs, over the caller's own transaction.
 *
 * An adapter over a Prisma transaction client implements this; so does an
 * in-memory fake. Every read and every write is tenant-scoped by the adapter,
 * from authority the caller owns.
 */
export interface TimbradoRangeStore {
  /**
   * The current authorisation for a key: the ACTIVE range with the greatest
   * `validityStart`, which is the authorisation in force.
   */
  findCurrentRange(key: TimbradoRangeKey): Promise<TimbradoRangeRecord | null>;

  /**
   * Consumes one number **if and only if** the counter still holds
   * `expectedNextNumber`. `false` means the caller lost the race and must
   * re-read; it must never fall back to an unconditional write.
   *
   * The key travels with the write rather than being held by the store, so every
   * statement the adapter issues is tenant-scoped by the authority the caller
   * already holds — the same rule the repositories follow, applied at the one
   * place where a missing scope would cross tenants silently.
   */
  claimNumber(args: {
    readonly key: TimbradoRangeKey;
    readonly rangeId: string;
    readonly expectedNextNumber: number;
  }): Promise<boolean>;

  /** Closes a spent range if and only if it is still ACTIVE. */
  closeRange(args: { readonly key: TimbradoRangeKey; readonly rangeId: string }): Promise<boolean>;

  /**
   * Opens the successor series, inheriting the authorisation's span, validity
   * start and timbrado number: the Manual's model is that the SAME authorisation
   * continues under the next series, which is why the timbrado is not reissued.
   *
   * `nextNumber` is passed rather than left to the adapter: where a series starts
   * counting is a numbering rule, and an adapter that inferred it could start the
   * successor at the wrong place without anything catching it.
   */
  openSeries(args: {
    readonly key: TimbradoRangeKey;
    readonly series: string;
    readonly timbradoNumber: string;
    readonly rangeFrom: number;
    readonly rangeTo: number;
    readonly validityStart: Date;
    readonly nextNumber: number;
  }): Promise<void>;
}

export interface AllocatedDocumentNumber {
  readonly rangeId: string;
  readonly timbradoNumber: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  /** `null` for the seriesless initial range; the DE omits `dSerieNum` then. */
  readonly series: string | null;
  /** The emitted `dNumDoc`: seven digits, zero-padded. */
  readonly documentNumber: string;
  /** The same value as an integer, for a caller that needs to compare it. */
  readonly sequenceNumber: number;
}

/**
 * Takes the next document number for a key, rolling the series over when the
 * current range is spent.
 *
 * Must be called inside a transaction whose client is the delegate: the claim and
 * any rollover have to commit together, or a crash between them would either
 * lose a number or hand out two.
 */
export async function allocateDocumentNumber(args: {
  readonly store: TimbradoRangeStore;
  readonly key: TimbradoRangeKey;
}): Promise<AllocatedDocumentNumber> {
  const { store, key } = args;

  let attempts = 0;
  let rollovers = 0;

  // Two budgets, because the two kinds of iteration mean different things. A
  // rollover that closes a range is PROGRESS, so counting it against the
  // contention budget would let a chain of spent ranges report contention when
  // nobody is competing. It is still bounded, by the only bound that cannot be
  // exceeded legitimately: the series space. A store that never closes what it is
  // asked to close would otherwise loop forever, and `SERIES_COUNT` iterations of
  // a range that keeps being "spent" is not a sequence anyone is issuing.
  while (true) {
    const range = await store.findCurrentRange(key);

    if (range === null) {
      throw new TimbradoAllocationError(
        "RANGE_NOT_FOUND",
        `No active timbrado range for establishment ${key.establishmentId}, point ` +
          `${key.expeditionPoint} and document type ${String(key.documentType)}.`
      );
    }
    assertRangeIsSane(range);

    if (range.nextNumber > range.rangeTo) {
      // The range is spent. Close it and open the next series, then come back and
      // allocate from that one — this attempt consumed nothing.
      const progressed = await rollOverSeries({ store, key, range });
      if (progressed) {
        rollovers += 1;
        if (rollovers > SERIES_COUNT) {
          break;
        }
      } else {
        attempts += 1;
        if (attempts >= ALLOCATION_MAX_ATTEMPTS) {
          break;
        }
      }
      continue;
    }

    const claimed = await store.claimNumber({
      key,
      rangeId: range.id,
      expectedNextNumber: range.nextNumber,
    });
    if (!claimed) {
      // Another caller took this number between the read and the claim.
      attempts += 1;
      if (attempts >= ALLOCATION_MAX_ATTEMPTS) {
        break;
      }
      continue;
    }

    return {
      rangeId: range.id,
      timbradoNumber: range.timbradoNumber,
      establishmentId: range.establishmentId,
      expeditionPoint: range.expeditionPoint,
      documentType: range.documentType,
      series: range.series,
      documentNumber: formatDocumentNumber(range.nextNumber),
      sequenceNumber: range.nextNumber,
    };
  }

  throw new TimbradoAllocationError(
    "ALLOCATION_CONTENDED",
    `The timbrado range for establishment ${key.establishmentId}, point ` +
      `${key.expeditionPoint} and document type ${String(key.documentType)} made no progress ` +
      `in ${String(ALLOCATION_MAX_ATTEMPTS)} attempts.`
  );
}

/**
 * Closes a spent range and opens its successor.
 *
 * The successor inherits the authorised span, the validity start and the timbrado
 * number: the Manual's model is that the SAME authorisation continues under the
 * next series, which is why the timbrado is not reissued.
 */
async function rollOverSeries(args: {
  store: TimbradoRangeStore;
  key: TimbradoRangeKey;
  range: TimbradoRangeRecord;
}): Promise<boolean> {
  const { store, key, range } = args;
  const successor = nextSeries(range.series);
  if (successor === null) {
    throw new TimbradoAllocationError(
      "SERIES_EXHAUSTED",
      `Timbrado ${range.timbradoNumber} has exhausted its last series (ZZ) for ` +
        `establishment ${key.establishmentId}, point ${key.expeditionPoint} and document ` +
        `type ${String(key.documentType)}; a new authorisation is required.`
    );
  }

  const closed = await store.closeRange({ key, rangeId: range.id });
  if (!closed) {
    // Another caller closed it first and is opening the successor itself.
    return false;
  }

  await store.openSeries({
    key,
    series: successor,
    timbradoNumber: range.timbradoNumber,
    rangeFrom: range.rangeFrom,
    rangeTo: range.rangeTo,
    validityStart: range.validityStart,
    nextNumber: range.rangeFrom,
  });
  return true;
}

/**
 * `dNumDoc` is seven digits, zero-padded; the schema forbids an all-zero value
 * and the width forbids anything above {@link MAX_DOCUMENT_NUMBER}. Both ends are
 * checked: a floor-only guard would happily return eight digits for a caller that
 * passed a value the schema cannot carry.
 */
export function formatDocumentNumber(sequenceNumber: number): string {
  if (
    !Number.isInteger(sequenceNumber) ||
    sequenceNumber < 1 ||
    sequenceNumber > MAX_DOCUMENT_NUMBER
  ) {
    throw new TimbradoAllocationError(
      "INVALID_RANGE",
      `A document number is an integer from 1 to ${String(MAX_DOCUMENT_NUMBER)}, received ` +
        `${String(sequenceNumber)}.`
    );
  }
  return String(sequenceNumber).padStart(DOCUMENT_NUMBER_WIDTH, "0");
}

/** A range whose own numbers cannot describe a sequence is a data defect. */
function assertRangeIsSane(range: TimbradoRangeRecord): void {
  if (
    !Number.isInteger(range.rangeFrom) ||
    !Number.isInteger(range.rangeTo) ||
    !Number.isInteger(range.nextNumber) ||
    range.rangeFrom < 1 ||
    range.rangeTo > MAX_DOCUMENT_NUMBER ||
    range.rangeFrom > range.rangeTo ||
    range.nextNumber < range.rangeFrom
  ) {
    throw new TimbradoAllocationError(
      "INVALID_RANGE",
      `Timbrado range ${range.id} is not a usable sequence: from ${String(range.rangeFrom)} ` +
        `to ${String(range.rangeTo)}, next ${String(range.nextNumber)}.`
    );
  }
}

/** Re-exported so a caller catching this module's failures sees one error family. */
export type { TimbradoError };
