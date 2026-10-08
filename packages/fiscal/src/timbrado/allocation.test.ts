/**
 * FISC-011 WU-D — the allocation, against an in-memory delegate.
 *
 * The delegate is a fake rather than a database because what this suite has to
 * prove is the ARITHMETIC and the RACING, not the SQL: the claim is a
 * compare-and-swap, so the fake applies the same rule (a claim whose observed
 * counter has moved returns zero rows) and two concurrent allocations interleave
 * at its `await` points exactly as they would against PostgreSQL.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOCATION_MAX_ATTEMPTS,
  type AllocatedDocumentNumber,
  TimbradoAllocationError,
  type TimbradoRangeRecord,
  type TimbradoRangeStore,
  allocateDocumentNumber,
  assertSeriesStartUsable,
  formatDocumentNumber,
} from "./allocation.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ESTABLISHMENT = "22222222-2222-4222-8222-222222222222";

/** The key every case in this suite draws numbers from. */
const KEY = {
  tenantId: TENANT,
  establishmentId: ESTABLISHMENT,
  expeditionPoint: "001",
  documentType: 1,
} as const;

/** The record, minus its `readonly` modifiers: the fake mutates its own rows. */
type StoredRange = {
  -readonly [K in keyof TimbradoRangeRecord]: TimbradoRangeRecord[K];
} & {
  status: "ACTIVE" | "EXHAUSTED" | "RETIRED";
  /**
   * Not part of {@link TimbradoRangeRecord}: the allocation never reads the
   * series' start, and only `setSeriesStart` is allowed to write it. The column
   * is here so the set-once rule has something to be set once.
   */
  seriesStartedAt: Date | null;
};

/**
 * A delegate that behaves like the applied schema: the CAS is decided by the
 * stored counter, and a second ACTIVE range for the same authorisation is
 * refused the way the partial unique index refuses it.
 */
class FakeRanges implements TimbradoRangeStore {
  readonly rows: StoredRange[] = [];
  /** How many claims lost the race, so a test can prove the retry happened. */
  lostRaces = 0;

  seed(overrides: Partial<StoredRange> = {}): StoredRange {
    const row: StoredRange = {
      id: `range-${String(this.rows.length + 1)}`,
      timbradoNumber: "12345678",
      establishmentId: ESTABLISHMENT,
      expeditionPoint: "001",
      documentType: 1,
      series: null,
      rangeFrom: 1,
      rangeTo: 9_999_999,
      validityStart: new Date("2019-09-01T00:00:00Z"),
      nextNumber: 1,
      status: "ACTIVE",
      seriesStartedAt: null,
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  findCurrentRange(key: {
    tenantId: string;
    establishmentId: string;
    expeditionPoint: string;
    documentType: number;
  }): Promise<TimbradoRangeRecord | null> {
    const candidates = this.rows.filter(
      (row) =>
        row.status === "ACTIVE" &&
        row.establishmentId === key.establishmentId &&
        row.expeditionPoint === key.expeditionPoint &&
        row.documentType === key.documentType
    );
    // The current authorisation is the one whose validity started last.
    candidates.sort((a, b) => b.validityStart.getTime() - a.validityStart.getTime());
    // A COPY, as Prisma returns: handing back the live row would let the claim's
    // increment contaminate the value the algorithm already read.
    return Promise.resolve(candidates[0] ? { ...candidates[0] } : null);
  }

  claimNumber(args: {
    key: { tenantId: string };
    rangeId: string;
    expectedNextNumber: number;
  }): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === args.rangeId);
    if (!row) return Promise.resolve(false);
    // The compare-and-swap: a claim whose observed value has moved loses.
    if (row.nextNumber !== args.expectedNextNumber) {
      this.lostRaces += 1;
      return Promise.resolve(false);
    }
    row.nextNumber += 1;
    return Promise.resolve(true);
  }

  closeRange(args: { key: { tenantId: string }; rangeId: string }): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === args.rangeId);
    if (row?.status !== "ACTIVE") return Promise.resolve(false);
    row.status = "EXHAUSTED";
    return Promise.resolve(true);
  }

  openSeries(args: {
    key: { establishmentId: string; expeditionPoint: string; documentType: number };
    series: string;
    timbradoNumber: string;
    rangeFrom: number;
    rangeTo: number;
    validityStart: Date;
    nextNumber: number;
  }): Promise<void> {
    // The `single_active_key` partial unique index, scoped per authorisation:
    // one ACTIVE range per timbrado and key.
    const clash = this.rows.some(
      (row) =>
        row.status === "ACTIVE" &&
        row.timbradoNumber === args.timbradoNumber &&
        row.expeditionPoint === args.key.expeditionPoint &&
        row.documentType === args.key.documentType
    );
    if (clash) {
      throw new Error("fiscal_timbrado_range_single_active_key");
    }
    this.seed({
      series: args.series,
      timbradoNumber: args.timbradoNumber,
      establishmentId: args.key.establishmentId,
      expeditionPoint: args.key.expeditionPoint,
      documentType: args.key.documentType,
      rangeFrom: args.rangeFrom,
      rangeTo: args.rangeTo,
      validityStart: args.validityStart,
      nextNumber: args.nextNumber,
      status: "ACTIVE",
    });
    return Promise.resolve();
  }

  setSeriesStart(args: {
    key: { tenantId: string };
    rangeId: string;
    startedAt: Date;
  }): Promise<boolean> {
    // The guard the adapter applies before its statement, applied here too: a
    // fake that accepted `Invalid Date` would quietly allow what PostgreSQL
    // would not.
    assertSeriesStartUsable(args.startedAt);
    const row = this.rows.find((candidate) => candidate.id === args.rangeId);
    // Set-once, as the `seriesStartedAt: null` predicate in the adapter's
    // `where`: a row that already has a start cannot match again, and neither
    // can a row that is not there at all.
    if (row?.seriesStartedAt === null) {
      row.seriesStartedAt = args.startedAt;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

/** The failure code a call raises, which is the part a caller branches on. */
async function failureOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (error instanceof TimbradoAllocationError) {
      return error.failure;
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

function allocate(
  store: TimbradoRangeStore,
  overrides: { documentType?: number; expeditionPoint?: string } = {}
): Promise<AllocatedDocumentNumber> {
  return allocateDocumentNumber({
    store,
    key: {
      tenantId: TENANT,
      establishmentId: ESTABLISHMENT,
      expeditionPoint: overrides.expeditionPoint ?? "001",
      documentType: overrides.documentType ?? 1,
    },
  });
}

describe("the number the allocation hands out", () => {
  it("starts at 0000001 and advances by one", async () => {
    const ranges = new FakeRanges();
    ranges.seed();

    expect((await allocate(ranges)).documentNumber).toBe("0000001");
    expect((await allocate(ranges)).documentNumber).toBe("0000002");
    expect((await allocate(ranges)).documentNumber).toBe("0000003");
  });

  it("returns the seriesless range as null, which is a state and not a gap", async () => {
    const ranges = new FakeRanges();
    ranges.seed();
    expect((await allocate(ranges)).series).toBeNull();
  });

  it("pads to seven digits at both ends of the width", () => {
    expect(formatDocumentNumber(1)).toBe("0000001");
    expect(formatDocumentNumber(999_999)).toBe("0999999");
    expect(formatDocumentNumber(9_999_999)).toBe("9999999");
  });

  it("refuses a number that is not a sequence value", () => {
    // Both ends: the floor is the schema's all-zero rule and the ceiling is the
    // seven-digit width. A floor-only guard would return eight digits.
    for (const value of [0, -1, 1.5, 10_000_000]) {
      expect(() => formatDocumentNumber(value)).toThrow(TimbradoAllocationError);
      expect(() => formatDocumentNumber(value)).toThrow(/from 1 to 9999999/);
    }
  });
});

describe("the series rollover", () => {
  it("closes the spent range and continues in the next series", async () => {
    const ranges = new FakeRanges();
    const spent = ranges.seed({ rangeTo: 3 });

    expect((await allocate(ranges)).documentNumber).toBe("0000001");
    expect((await allocate(ranges)).documentNumber).toBe("0000002");
    expect((await allocate(ranges)).documentNumber).toBe("0000003");

    // The fourth is the first of `AA`, and the seriesless range is now spent.
    const rolled = await allocate(ranges);
    expect(rolled.series).toBe("AA");
    expect(rolled.documentNumber).toBe("0000001");
    expect(spent.status).toBe("EXHAUSTED");
  });

  it("inherits the authorised span, the validity start and the timbrado", async () => {
    const ranges = new FakeRanges();
    ranges.seed({ rangeTo: 1, rangeFrom: 1 });
    await allocate(ranges);
    const rolled = await allocate(ranges);

    const successor = ranges.rows.find((row) => row.series === "AA");
    expect(successor).toMatchObject({
      timbradoNumber: "12345678",
      establishmentId: ESTABLISHMENT,
      expeditionPoint: "001",
      documentType: 1,
      rangeFrom: 1,
      rangeTo: 1,
      status: "ACTIVE",
      nextNumber: 2,
    });
    expect(rolled.sequenceNumber).toBe(1);
  });

  it("walks the Manual's order, one series at a time", async () => {
    const ranges = new FakeRanges();
    ranges.seed({ rangeFrom: 1, rangeTo: 1, series: "AZ" });

    await allocate(ranges);
    // `AZ` is spent, so the next number is `BA`'s first.
    expect((await allocate(ranges)).series).toBe("BA");
  });

  it("treats ZZ exhausted as terminal rather than wrapping", async () => {
    const ranges = new FakeRanges();
    ranges.seed({ rangeFrom: 1, rangeTo: 1, series: "ZZ" });
    await allocate(ranges);

    await expect(allocate(ranges)).rejects.toThrow(TimbradoAllocationError);
    await expect(allocate(ranges)).rejects.toThrow(/exhausted its last series \(ZZ\)/);
    expect(await failureOf(() => allocate(ranges))).toBe("SERIES_EXHAUSTED");
  });
});

describe("which authorisation is current", () => {
  it("takes the ACTIVE range with the greatest validity start", async () => {
    const ranges = new FakeRanges();
    // An older authorisation still in use, and next year's, both ACTIVE. The
    // schema admits both on purpose: a new timbrado has to be registrable while
    // the current one is still in use.
    ranges.seed({ timbradoNumber: "11111111", validityStart: new Date("2019-01-01T00:00:00Z") });
    ranges.seed({ timbradoNumber: "22222222", validityStart: new Date("2026-01-01T00:00:00Z") });

    const allocated = await allocate(ranges);
    expect(allocated.timbradoNumber).toBe("22222222");
  });

  it("falls back to the older one once the newer is retired", async () => {
    const ranges = new FakeRanges();
    const older = ranges.seed({
      timbradoNumber: "11111111",
      validityStart: new Date("2019-01-01T00:00:00Z"),
    });
    const newer = ranges.seed({
      timbradoNumber: "22222222",
      validityStart: new Date("2026-01-01T00:00:00Z"),
    });
    newer.status = "RETIRED";

    expect((await allocate(ranges)).timbradoNumber).toBe("11111111");
    expect(older.status).toBe("ACTIVE");
  });

  it("names the key when there is no active range at all", async () => {
    const ranges = new FakeRanges();
    await expect(allocate(ranges)).rejects.toThrow(/No active timbrado range/);
    expect(await failureOf(() => allocate(ranges))).toBe("RANGE_NOT_FOUND");
  });

  it("does not confuse two document types on the same point", async () => {
    const ranges = new FakeRanges();
    ranges.seed({ documentType: 1 });
    ranges.seed({ documentType: 5, rangeFrom: 1, rangeTo: 9_999_999 });

    expect((await allocate(ranges, { documentType: 1 })).documentNumber).toBe("0000001");
    expect((await allocate(ranges, { documentType: 5 })).documentNumber).toBe("0000001");
    expect((await allocate(ranges, { documentType: 1 })).documentNumber).toBe("0000002");
  });
});

describe("the claim is a compare-and-swap, so a number is never handed out twice", () => {
  it("gives N concurrent callers N distinct numbers", async () => {
    const ranges = new FakeRanges();
    ranges.seed();

    const allocated = await Promise.all(Array.from({ length: 12 }, () => allocate(ranges)));

    const numbers = allocated.map((entry) => entry.documentNumber);
    expect(new Set(numbers).size).toBe(12);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => formatDocumentNumber(index + 1))
    );
  });

  it("retries when it loses the race, and reports how many times", async () => {
    const ranges = new FakeRanges();
    ranges.seed();

    // Two callers read the same counter before either claims it. The loser must
    // re-read rather than take the number it observed.
    const [first, second] = await Promise.all([allocate(ranges), allocate(ranges)]);
    expect(first.documentNumber).not.toBe(second.documentNumber);
    expect(ranges.lostRaces).toBeGreaterThan(0);
  });

  it("fails loudly rather than spinning when the race is never won", async () => {
    const ranges = new FakeRanges();
    ranges.seed();
    // A delegate whose claim always loses: the caller must stop, not loop.
    const neverWins: TimbradoRangeStore = {
      findCurrentRange: (key) => ranges.findCurrentRange(key),
      claimNumber: () => Promise.resolve(false),
      closeRange: (args) => ranges.closeRange(args),
      openSeries: (args) => ranges.openSeries(args),
      setSeriesStart: (args) => ranges.setSeriesStart(args),
    };

    await expect(allocate(neverWins)).rejects.toThrow(TimbradoAllocationError);
    await expect(allocate(neverWins)).rejects.toThrow(
      new RegExp(`made no progress in ${String(ALLOCATION_MAX_ATTEMPTS)} attempts`)
    );
    expect(await failureOf(() => allocate(neverWins))).toBe("ALLOCATION_CONTENDED");
  });

  it("does not spend the contention budget on rollovers that make progress", async () => {
    // Forty spent ranges in a row, each of which the store closes, and then one
    // that can be claimed. Counting a successful rollover against the contention
    // budget would report ALLOCATION_CONTENDED at 32 and never reach the claim —
    // and nothing is competing here. The series space is the bound that applies.
    const spent = {
      id: "range-spent",
      timbradoNumber: "12345678",
      establishmentId: ESTABLISHMENT,
      expeditionPoint: "001",
      documentType: 1,
      series: null,
      rangeFrom: 1,
      rangeTo: 1,
      validityStart: new Date("2019-09-01T00:00:00Z"),
      nextNumber: 2,
    };
    let reads = 0;
    const store: TimbradoRangeStore = {
      findCurrentRange: () => {
        reads += 1;
        return Promise.resolve(
          reads <= 40 ? { ...spent } : { ...spent, nextNumber: 1, rangeTo: 9_999_999 }
        );
      },
      claimNumber: () => Promise.resolve(true),
      closeRange: () => Promise.resolve(true),
      openSeries: () => Promise.resolve(),
      setSeriesStart: () => Promise.resolve(false),
    };

    expect((await allocate(store)).documentNumber).toBe("0000001");
    expect(reads).toBe(41);
  });

  it("still bounds a store that never closes what it is asked to close", async () => {
    // A pathological store: every read reports a spent range and every close
    // "succeeds", so progress is claimed but never happens. The series space is
    // the only bound that cannot be exceeded legitimately, and it stops the loop.
    const ranges = new FakeRanges();
    const alwaysSpent: TimbradoRangeStore = {
      findCurrentRange: () => Promise.resolve({ ...ranges.seed({ rangeTo: 1, nextNumber: 2 }) }),
      claimNumber: () => Promise.resolve(false),
      closeRange: () => Promise.resolve(true),
      openSeries: () => Promise.resolve(),
      setSeriesStart: () => Promise.resolve(false),
    };

    expect(await failureOf(() => allocate(alwaysSpent))).toBe("ALLOCATION_CONTENDED");
  });

  it("does not open a second series when another caller already did", async () => {
    const ranges = new FakeRanges();
    const spent = ranges.seed({ rangeTo: 2 });
    await allocate(ranges);
    await allocate(ranges);

    // Two callers see the same spent range and both try to roll it over.
    const [first, second] = await Promise.all([allocate(ranges), allocate(ranges)]);
    expect(first.series).toBe("AA");
    expect(second.series).toBe("AA");
    expect(first.documentNumber).not.toBe(second.documentNumber);
    expect(ranges.rows.filter((row) => row.series === "AA")).toHaveLength(1);
    expect(spent.status).toBe("EXHAUSTED");
  });
});

describe("a range whose own numbers cannot describe a sequence", () => {
  it.each([
    ["a zero floor", { rangeFrom: 0 }],
    ["an inverted span", { rangeFrom: 5, rangeTo: 2 }],
    ["a counter below the floor", { rangeFrom: 3, nextNumber: 1 }],
    ["a ceiling beyond tdNumDoc", { rangeTo: 10_000_000 }],
  ])("refuses %s", async (_label, overrides) => {
    const ranges = new FakeRanges();
    ranges.seed(overrides);
    expect(await failureOf(() => allocate(ranges))).toBe("INVALID_RANGE");
  });
});

describe("the series' start is recorded once", () => {
  // Manual §10.5: the start is the first DE's signature timestamp, and the
  // allocation cannot know it — the number is part of the CDC and the CDC is
  // signed after the number is handed out. So the caller that has just signed
  // records it, in a second step, exactly once.
  const STARTED_AT = new Date("2026-10-07T12:34:56.000Z");

  it("answers true on the first call, and stores the instant", async () => {
    const ranges = new FakeRanges();
    const range = ranges.seed();

    expect(
      await ranges.setSeriesStart({ key: KEY, rangeId: range.id, startedAt: STARTED_AT })
    ).toBe(true);
    expect(range.seriesStartedAt).toEqual(STARTED_AT);
  });

  it("answers false on a second call with a different instant, and keeps the first", async () => {
    const ranges = new FakeRanges();
    const range = ranges.seed();
    const later = new Date("2027-01-02T00:00:00.000Z");

    await ranges.setSeriesStart({ key: KEY, rangeId: range.id, startedAt: STARTED_AT });

    // The series' validity started at the FIRST signature, so the later one must
    // not overwrite it — the caller is told it did nothing rather than refused.
    expect(await ranges.setSeriesStart({ key: KEY, rangeId: range.id, startedAt: later })).toBe(
      false
    );
    expect(range.seriesStartedAt).toEqual(STARTED_AT);
  });

  it("answers false on a second call with the same instant", async () => {
    const ranges = new FakeRanges();
    const range = ranges.seed();

    await ranges.setSeriesStart({ key: KEY, rangeId: range.id, startedAt: STARTED_AT });

    // Set-once is about the CALL, not about the value: an idempotent-looking
    // repeat is still a second caller that must be told it set nothing.
    expect(
      await ranges.setSeriesStart({ key: KEY, rangeId: range.id, startedAt: STARTED_AT })
    ).toBe(false);
  });

  it("refuses an unusable instant by its own failure code, and stores nothing", async () => {
    const ranges = new FakeRanges();
    const range = ranges.seed();
    const unusable = new Date("not an instant");

    expect(
      await failureOf(() =>
        ranges.setSeriesStart({ key: KEY, rangeId: range.id, startedAt: unusable })
      )
    ).toBe("INVALID_SERIES_START");
    // The code is the part a caller branches on, and the refusal has to leave
    // the column unset rather than write a timestamp nobody chose.
    expect(range.seriesStartedAt).toBeNull();
  });

  it("names the instant when the guard itself refuses", () => {
    expect(() => assertSeriesStartUsable(new Date("not an instant"))).toThrow(
      TimbradoAllocationError
    );
    expect(() => assertSeriesStartUsable(new Date("not an instant"))).toThrow(
      /must be a usable instant/
    );
    // A real instant is not the guard's business, and it does not re-derive one.
    expect(() => assertSeriesStartUsable(STARTED_AT)).not.toThrow();
  });
});
