/**
 * FISC-011 WU-E part 3 — the Prisma adapter.
 *
 * The adapter's whole content is the SHAPE of four statements, so that is what
 * this suite asserts: the tenant is in every write's `where`, the claim's
 * compare-and-swap really compares, and the successor inherits the authorisation
 * rather than reissuing it. The compare-and-swap against a real database is the
 * live-PostgreSQL case; here the delegate is a fake that records what it was
 * asked to do.
 */

import type { Prisma } from "@newsaas/database";
import type { TimbradoRangeRecord } from "@newsaas/fiscal";
import { describe, expect, it } from "vitest";
import {
  type TimbradoRangePrismaClient,
  type TimbradoRangePrismaDelegate,
  createTimbradoRangeStore,
} from "./timbrado-range.store.js";

const KEY = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  establishmentId: "22222222-2222-4222-8222-222222222222",
  expeditionPoint: "001",
  documentType: 1,
} as const;

const ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  timbradoNumber: "12345678",
  establishmentId: KEY.establishmentId,
  expeditionPoint: "001",
  documentType: 1,
  series: null,
  rangeFrom: 1,
  rangeTo: 9_999_999,
  validityStart: new Date("2019-09-01T00:00:00Z"),
  nextNumber: 42,
};

/** Records every call, and answers with what the case tells it to. */
class RecordingDelegate implements TimbradoRangePrismaDelegate {
  findFirstArgs: Prisma.FiscalTimbradoRangeFindFirstArgs[] = [];
  updateManyArgs: Prisma.FiscalTimbradoRangeUpdateManyArgs[] = [];
  createArgs: Prisma.FiscalTimbradoRangeCreateArgs[] = [];

  constructor(
    private readonly found: TimbradoRangeRecord | null = ROW,
    private readonly updatedCount = 1
  ) {}

  findFirst(args: Prisma.FiscalTimbradoRangeFindFirstArgs): Promise<TimbradoRangeRecord | null> {
    this.findFirstArgs.push(args);
    return Promise.resolve(this.found);
  }

  updateMany(args: Prisma.FiscalTimbradoRangeUpdateManyArgs): Promise<{ count: number }> {
    this.updateManyArgs.push(args);
    return Promise.resolve({ count: this.updatedCount });
  }

  create(args: Prisma.FiscalTimbradoRangeCreateArgs): Promise<unknown> {
    this.createArgs.push(args);
    return Promise.resolve({});
  }
}

function store(delegate: TimbradoRangePrismaDelegate) {
  const client: TimbradoRangePrismaClient = { fiscalTimbradoRange: delegate };
  return createTimbradoRangeStore(client);
}

describe("findCurrentRange", () => {
  it("reads only ACTIVE rows for the key, newest validity first", async () => {
    const delegate = new RecordingDelegate();
    await store(delegate).findCurrentRange(KEY);

    expect(delegate.findFirstArgs[0]?.where).toEqual({
      tenantId: KEY.tenantId,
      establishmentId: KEY.establishmentId,
      expeditionPoint: "001",
      documentType: 1,
      status: "ACTIVE",
    });
    // The order is what makes "current" mean the authorisation in force, because
    // two authorisations may each be ACTIVE — and it is TOTAL, because a single
    // key would leave two equal validity starts to PostgreSQL's whim.
    expect(delegate.findFirstArgs[0]?.orderBy).toEqual([
      { validityStart: "desc" },
      { timbradoNumber: "desc" },
    ]);
  });

  it("selects the columns the allocation reads rather than the whole row", async () => {
    const delegate = new RecordingDelegate();
    await store(delegate).findCurrentRange(KEY);

    expect(Object.keys(delegate.findFirstArgs[0]?.select ?? {}).sort()).toEqual([
      "documentType",
      "establishmentId",
      "expeditionPoint",
      "id",
      "nextNumber",
      "rangeFrom",
      "rangeTo",
      "series",
      "timbradoNumber",
      "validityStart",
    ]);
  });

  it("returns null rather than undefined when there is no active range", async () => {
    const delegate = new RecordingDelegate(null);
    expect(await store(delegate).findCurrentRange(KEY)).toBeNull();
  });
});

describe("claimNumber", () => {
  it("compares the counter it was given, and it is in the tenant's scope", async () => {
    const delegate = new RecordingDelegate();
    await store(delegate).claimNumber({
      key: KEY,
      rangeId: ROW.id,
      expectedNextNumber: 42,
    });

    expect(delegate.updateManyArgs[0]?.where).toEqual({
      id: ROW.id,
      tenantId: KEY.tenantId,
      nextNumber: 42,
    });
    expect(delegate.updateManyArgs[0]?.data).toEqual({ nextNumber: { increment: 1 } });
  });

  it("reports the race it lost as false rather than retrying the write", async () => {
    const delegate = new RecordingDelegate(ROW, 0);
    expect(
      await store(delegate).claimNumber({ key: KEY, rangeId: ROW.id, expectedNextNumber: 42 })
    ).toBe(false);
  });

  it("reports a won race as true", async () => {
    const delegate = new RecordingDelegate(ROW, 1);
    expect(
      await store(delegate).claimNumber({ key: KEY, rangeId: ROW.id, expectedNextNumber: 42 })
    ).toBe(true);
  });
});

describe("closeRange", () => {
  it("closes only a range that is still ACTIVE, in the tenant's scope", async () => {
    const delegate = new RecordingDelegate();
    await store(delegate).closeRange({ key: KEY, rangeId: ROW.id });

    expect(delegate.updateManyArgs[0]?.where).toEqual({
      id: ROW.id,
      tenantId: KEY.tenantId,
      status: "ACTIVE",
    });
    expect(delegate.updateManyArgs[0]?.data).toEqual({ status: "EXHAUSTED" });
  });
});

describe("openSeries", () => {
  it("continues the same authorisation instead of reissuing it", async () => {
    const delegate = new RecordingDelegate();
    await store(delegate).openSeries({
      key: KEY,
      series: "AA",
      timbradoNumber: "12345678",
      rangeFrom: 1,
      rangeTo: 9_999_999,
      validityStart: ROW.validityStart,
      nextNumber: 1,
    });

    expect(delegate.createArgs[0]?.data).toEqual({
      tenantId: KEY.tenantId,
      establishmentId: KEY.establishmentId,
      expeditionPoint: "001",
      documentType: 1,
      series: "AA",
      // Carried over, not reissued: this is the same authorisation under a new
      // series, which is why the timbrado has no end-of-validity date.
      timbradoNumber: "12345678",
      rangeFrom: 1,
      rangeTo: 9_999_999,
      validityStart: ROW.validityStart,
      // The Manual puts a series' start at the first DE's signature date, which
      // is a later step, so it is absent here.
      nextNumber: 1,
      status: "ACTIVE",
    });
  });
});
