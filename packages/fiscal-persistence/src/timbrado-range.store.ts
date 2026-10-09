import type { Prisma } from "@newsaas/database";
import {
  assertSeriesStartUsable,
  type TimbradoRangeRecord,
  type TimbradoRangeStore,
} from "@newsaas/fiscal";

/**
 * FISC-011 WU-E — the Prisma side of the allocation's port.
 *
 * The port is five named operations (`TimbradoRangeStore`), and this is the only
 * implementation that talks to PostgreSQL. It is deliberately thin: every
 * decision the allocation makes is in `packages/fiscal`, and everything here is
 * one statement.
 *
 * **Why the delegate is typed with Prisma's own argument types.** A hand-written
 * delegate interface does not fit Prisma: `findFirst` is assignable, but
 * `updateMany` is generic over a `SelectSubset` of an `XOR<>` data type and
 * refuses to match a signature declared outside the package. That is why the port
 * is named operations in the first place; here, where Prisma's types ARE
 * available, using them means the delegate fits by construction instead of by
 * hope.
 *
 * **Why every statement carries the key.** A tenant-scoped write whose scope came
 * from anything but the caller would be the one place a cross-tenant read could
 * pass unnoticed, so `claimNumber`, `closeRange` and `setSeriesStart` take the
 * key with the write and put `tenantId` in the `where` clause.
 */

/** The delegate surface, in Prisma's own terms. */
export interface TimbradoRangePrismaDelegate {
  /**
   * Returns the record the port declares, not Prisma's full row: the adapter
   * selects only the columns the allocation reads, and a full payload is
   * assignable to it because the extra columns are simply not required.
   */
  findFirst(args: Prisma.FiscalTimbradoRangeFindFirstArgs): Promise<TimbradoRangeRecord | null>;
  updateMany(args: Prisma.FiscalTimbradoRangeUpdateManyArgs): Promise<{ count: number }>;
  create(args: Prisma.FiscalTimbradoRangeCreateArgs): Promise<unknown>;
}

/** What the store needs from the client: just this one delegate. */
export interface TimbradoRangePrismaClient {
  fiscalTimbradoRange: TimbradoRangePrismaDelegate;
}

/** The columns the allocation reads, and nothing else. */
const RANGE_COLUMNS = {
  id: true,
  timbradoNumber: true,
  establishmentId: true,
  expeditionPoint: true,
  documentType: true,
  series: true,
  rangeFrom: true,
  rangeTo: true,
  validityStart: true,
  nextNumber: true,
} as const;

export function createTimbradoRangeStore(client: TimbradoRangePrismaClient): TimbradoRangeStore {
  return {
    async findCurrentRange(key): Promise<TimbradoRangeRecord | null> {
      // "Current" is the ACTIVE range whose validity started last. Two
      // authorisations may each be ACTIVE, because a new timbrado has to be
      // registrable while the current one is still in use.
      const row = await client.fiscalTimbradoRange.findFirst({
        where: {
          tenantId: key.tenantId,
          establishmentId: key.establishmentId,
          expeditionPoint: key.expeditionPoint,
          documentType: key.documentType,
          status: "ACTIVE",
        },
        // Total, not partial: two authorisations may share a validity start, and
        // a single sort key would leave the choice to PostgreSQL's whim. The
        // port's contract names the timbrado number as the tie-break.
        orderBy: [{ validityStart: "desc" }, { timbradoNumber: "desc" }],
        select: RANGE_COLUMNS,
      });
      return row ?? null;
    },

    async claimNumber({ key, rangeId, expectedNextNumber }): Promise<boolean> {
      // The compare-and-swap. `nextNumber` in the WHERE is what makes it one:
      // two callers that observed the same counter cannot both match, so a zero
      // count means this caller lost and must re-read rather than write.
      const claimed = await client.fiscalTimbradoRange.updateMany({
        where: { id: rangeId, tenantId: key.tenantId, nextNumber: expectedNextNumber },
        data: { nextNumber: { increment: 1 } },
      });
      return claimed.count === 1;
    },

    async closeRange({ key, rangeId }): Promise<boolean> {
      // Also a compare-and-swap, on the status: whichever caller closes it first
      // opens the successor, and the other must not open a second one.
      const closed = await client.fiscalTimbradoRange.updateMany({
        where: { id: rangeId, tenantId: key.tenantId, status: "ACTIVE" },
        data: { status: "EXHAUSTED" },
      });
      return closed.count === 1;
    },

    async openSeries({
      key,
      series,
      timbradoNumber,
      rangeFrom,
      rangeTo,
      validityStart,
      nextNumber,
    }) {
      // The successor continues the SAME authorisation, which is why the
      // timbrado number and the authorised span are carried over rather than
      // reissued. `seriesStartedAt` stays NULL: the Manual puts the series'
      // start at the first DE's signature date, and `setSeriesStart` is that
      // later step.
      await client.fiscalTimbradoRange.create({
        data: {
          tenantId: key.tenantId,
          establishmentId: key.establishmentId,
          expeditionPoint: key.expeditionPoint,
          documentType: key.documentType,
          series,
          timbradoNumber,
          rangeFrom,
          rangeTo,
          validityStart,
          nextNumber,
          status: "ACTIVE",
        },
      });
    },

    async setSeriesStart({ key, rangeId, startedAt }): Promise<boolean> {
      // Set-once is the `seriesStartedAt: null` predicate INSIDE the update, and
      // not a read followed by a write: two callers that both observed an unset
      // start cannot both match it, so a zero count means the first signature's
      // timestamp is the one that stands and this caller set nothing.
      //
      // The guard runs before the statement, so an unusable instant is a named
      // failure here instead of a timestamp PostgreSQL was asked to store.
      assertSeriesStartUsable(startedAt);
      const updated = await client.fiscalTimbradoRange.updateMany({
        where: { id: rangeId, tenantId: key.tenantId, seriesStartedAt: null },
        data: { seriesStartedAt: startedAt },
      });
      return updated.count === 1;
    },
  };
}
