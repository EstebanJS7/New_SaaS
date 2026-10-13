/**
 * FISC-015 WU-B — the allocation's decision table, and the row it persists.
 *
 * The service's whole content is WHICH source numbers an invoice and WHAT is
 * written where, so this suite drives the REAL `FiscalAllocationService` over a
 * delegate fake: the real allocator (`allocateDocumentNumber`), the real range
 * store adapter and the real profile reader run above it, and only the SQL is
 * faked. The fake's compare-and-swap and its "at most one ACTIVE range per
 * authorisation" rule mirror the applied schema, so the refusal cases are the
 * ones the database would produce.
 *
 * The live-PostgreSQL suite owns the other half: that the allocation and the
 * invoice's transition really do commit together, and that a refusal leaves the
 * range's counter untouched.
 */

import { DomainError } from "@newsaas/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { FiscalAllocationTx } from "./fiscal-allocation.service.js";
import {
  FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE,
  FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE,
  FISCAL_ALLOCATION_REFUSED_MESSAGE,
  FISCAL_ALLOCATION_SERIES_EXHAUSTED_MESSAGE,
  FiscalAllocationService,
} from "./fiscal-allocation.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const ESTABLISHMENT = "33333333-3333-4333-8333-333333333333";
const OTHER_ESTABLISHMENT = "88888888-8888-4888-8888-888888888888";

/** The range row as the store's adapter selects it. */
interface RangeRow {
  id: string;
  timbradoNumber: string;
  establishmentId: string;
  expeditionPoint: string;
  documentType: number;
  series: string | null;
  rangeFrom: number;
  rangeTo: number;
  validityStart: Date;
  nextNumber: number;
  status: "ACTIVE" | "EXHAUSTED" | "RETIRED";
  tenantId: string;
}

interface AllocationWrite {
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly rangeId: string;
  readonly timbradoNumber: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly documentNumber: string;
}

/**
 * A delegate that behaves like the applied schema where it matters: the claim is
 * a compare-and-swap decided by the stored counter, the count sees only the rows
 * the `where` admits, and `openSeries` inherits the authorisation's span.
 */
class FakeFiscalClient {
  readonly ranges: RangeRow[] = [];
  readonly allocations: AllocationWrite[] = [];
  readonly countArgs: unknown[] = [];
  private rangeSequence = 0;

  /** The profile row, or `null` for a tenant that has none. */
  profile: { id: string; defaultEstablishmentId: string | null } | null = null;
  /** The declared point's other two columns; the establishment is above. */
  declaredPoint: { expeditionPoint: string | null; documentType: number | null } = {
    expeditionPoint: null,
    documentType: null,
  };

  seedRange(overrides: Partial<RangeRow> = {}): RangeRow {
    this.rangeSequence += 1;
    const row: RangeRow = {
      id: `range-${String(this.rangeSequence)}`,
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
      tenantId: TENANT,
      ...overrides,
    };
    this.ranges.push(row);
    return row;
  }

  /** The delegate surface `FiscalAllocationService` declares, and nothing else. */
  readonly client: FiscalAllocationTx;

  constructor() {
    const matches = (row: RangeRow, where: Record<string, unknown>): boolean =>
      Object.entries(where).every(([key, value]) => {
        if (value === undefined) return true;
        return (row as unknown as Record<string, unknown>)[key] === value;
      });

    this.client = {
      fiscalEmitterProfile: {
        findUnique: () => {
          if (this.profile === null) return Promise.resolve(null);
          return Promise.resolve({
            id: this.profile.id,
            ruc: "80012345",
            checkDigit: "6",
            taxpayerType: 2,
            regimeCode: 8,
            legalName: "Clínica Veterinaria del Sur S.A.",
            tradeName: null,
            responsibleIssuerType: null,
            responsibleIssuerTypeName: null,
            responsibleIssuerId: null,
            responsibleIssuerName: null,
            responsibleIssuerRole: null,
            transactionType: 1,
            taxType: 1,
            emissionType: 1,
            defaultEstablishmentId: this.profile.defaultEstablishmentId,
            defaultExpeditionPoint: this.declaredPoint.expeditionPoint,
            defaultDocumentType: this.declaredPoint.documentType,
          });
        },
      },
      fiscalEmitterActivity: {
        findMany: () => Promise.resolve([]),
      },
      fiscalEstablishment: {
        findFirst: () => Promise.resolve(null),
      },
      fiscalTimbradoRange: {
        count: (args) => {
          this.countArgs.push(args);
          const where = (args.where ?? {}) as Record<string, unknown>;
          return Promise.resolve(this.ranges.filter((row) => matches(row, where)).length);
        },
        findFirst: (args) => {
          const where = (args.where ?? {}) as Record<string, unknown>;
          const candidates = this.ranges.filter((row) => matches(row, where));
          // "Current" is the ACTIVE range whose validity started last, with the
          // timbrado number as the tie-break — the store's own order.
          candidates.sort(
            (left, right) =>
              right.validityStart.getTime() - left.validityStart.getTime() ||
              right.timbradoNumber.localeCompare(left.timbradoNumber)
          );
          const found = candidates[0];
          // A COPY, as Prisma returns: the claim's increment must not contaminate
          // the value the algorithm already read.
          return Promise.resolve(found === undefined ? null : { ...found });
        },
        updateMany: (args) => {
          const where = (args.where ?? {}) as Record<string, unknown>;
          const data = (args.data ?? {}) as Record<string, unknown>;
          const candidates = this.ranges.filter((row) => matches(row, where));
          let count = 0;
          for (const row of candidates) {
            if (data.status === "EXHAUSTED") {
              row.status = "EXHAUSTED";
            }
            const increment = data.nextNumber as { increment?: number } | undefined;
            if (increment?.increment !== undefined) {
              row.nextNumber += increment.increment;
            }
            count += 1;
          }
          return Promise.resolve({ count });
        },
        create: (args) => {
          const data = args.data as unknown as Omit<RangeRow, "id" | "status"> & {
            status?: RangeRow["status"];
          };
          this.seedRange({ ...data, status: data.status ?? "ACTIVE" });
          return Promise.resolve({});
        },
      },
      invoiceFiscalAllocation: {
        create: (args) => {
          this.allocations.push(args.data as unknown as AllocationWrite);
          return Promise.resolve({});
        },
      },
    };
  }
}

function buildService() {
  const client = new FakeFiscalClient();
  const service = new FiscalAllocationService({
    requireTenantId: () => TENANT,
  } as never);
  return { client, service };
}

/** A tenant that HAS declared its issuance point. */
function declarePoint(client: FakeFiscalClient): void {
  client.profile = { id: "profile-1", defaultEstablishmentId: ESTABLISHMENT };
  client.declaredPoint = { expeditionPoint: "001", documentType: 1 };
}

describe("the allocation path", () => {
  let client: FakeFiscalClient;
  let service: FiscalAllocationService;

  beforeEach(() => {
    ({ client, service } = buildService());
  });

  it("allocates from the declared point's ACTIVE range and answers the integer", async () => {
    declarePoint(client);
    const range = client.seedRange({ nextNumber: 7 });

    await service.allocateForConfirmation({ invoiceId: INVOICE, tx: client.client });

    // The invoice's own `number` is the allocated integer; the formatted
    // `dNumDoc` is the allocation's.
    expect(client.allocations[0]?.documentNumber).toBe(String(7).padStart(7, "0"));
    expect(client.allocations).toEqual([
      {
        tenantId: TENANT,
        invoiceId: INVOICE,
        rangeId: range.id,
        timbradoNumber: "12345678",
        establishmentId: ESTABLISHMENT,
        expeditionPoint: "001",
        documentType: 1,
        series: null,
        documentNumber: "0000007",
      },
    ]);
    // The counter moved INSIDE the caller's transaction: one number, consumed once.
    expect(range.nextNumber).toBe(8);
  });

  it("counts the ACTIVE ranges of the DECLARED key only", async () => {
    declarePoint(client);
    client.seedRange();
    // A second ACTIVE authorisation for a DIFFERENT point is not the declared
    // point's ambiguity, and a different tenant's range is not this tenant's.
    client.seedRange({ expeditionPoint: "002", timbradoNumber: "87654321" });
    client.seedRange({ establishmentId: OTHER_ESTABLISHMENT, timbradoNumber: "11112222" });
    client.seedRange({ tenantId: OTHER_TENANT, timbradoNumber: "33334444" });

    await expect(
      service.allocateForConfirmation({ invoiceId: INVOICE, tx: client.client })
    ).resolves.toBeUndefined();

    expect(client.countArgs).toEqual([
      {
        where: {
          tenantId: TENANT,
          establishmentId: ESTABLISHMENT,
          expeditionPoint: "001",
          documentType: 1,
          status: "ACTIVE",
        },
      },
    ]);
  });

  it("carries the fiscal series once the initial range is spent", async () => {
    declarePoint(client);
    const spent = client.seedRange({ rangeTo: 1, nextNumber: 2 });

    await service.allocateForConfirmation({ invoiceId: INVOICE, tx: client.client });

    // The successor series restarts the numbering under the SAME authorisation,
    // so the number repeats and the series is what distinguishes it.
    expect(client.allocations[0]?.documentNumber).toBe(String(1).padStart(7, "0"));
    // The invoice must take THIS series: the successor restarts at 1, so keeping
    // Billing's series would collide on `(tenant_id, series, number)` with the
    // invoice the previous range numbered 1 (finding R3-001).
    expect(client.allocations[0]?.series).toBe("AA");
    expect(spent.status).toBe("EXHAUSTED");
    const successor = client.ranges.find((row) => row.series === "AA");
    expect(successor).toBeDefined();
    expect(client.allocations[0]).toMatchObject({
      rangeId: successor?.id,
      timbradoNumber: "12345678",
      series: "AA",
      documentNumber: "0000001",
    });
  });
});

describe("the counter path", () => {
  let client: FakeFiscalClient;
  let service: FiscalAllocationService;

  beforeEach(() => {
    ({ client, service } = buildService());
  });

  it("answers null when the tenant has no fiscal profile at all", async () => {
    await service.allocateForConfirmation({ invoiceId: INVOICE, tx: client.client });

    // DEC-056: the counter stays as the non-fiscal path, and it is the caller
    // that reaches it — this service writes nothing and allocates nothing.
    expect(client.allocations).toHaveLength(0);
    expect(client.allocations).toEqual([]);
    expect(client.countArgs).toEqual([]);
  });

  it("answers null when the profile declares no issuance point", async () => {
    client.profile = { id: "profile-1", defaultEstablishmentId: null };
    client.declaredPoint = { expeditionPoint: null, documentType: null };

    await service.allocateForConfirmation({ invoiceId: INVOICE, tx: client.client });

    // The three columns are all-or-nothing by the migration's CHECK, so this is
    // the one "nothing declared" state and it must not reach a range at all.
    expect(client.allocations).toHaveLength(0);
    expect(client.allocations).toEqual([]);
    expect(client.countArgs).toEqual([]);
  });
});

describe("the two refusals", () => {
  let client: FakeFiscalClient;
  let service: FiscalAllocationService;

  beforeEach(() => {
    ({ client, service } = buildService());
    declarePoint(client);
  });

  it("refuses a declared point with no ACTIVE range, naming that state", async () => {
    // A spent range that was retired, and an ACTIVE one for a different point:
    // neither authorises the declared point.
    client.seedRange({ status: "RETIRED" });
    client.seedRange({ expeditionPoint: "002", timbradoNumber: "87654321" });

    const failure = await service
      .allocateForConfirmation({ invoiceId: INVOICE, tx: client.client })
      .then(
        () => null,
        (error: unknown) => error
      );

    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("CONFLICT");
    expect((failure as DomainError).message).toBe(FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE);
    // A refusal allocates nothing and persists nothing: the caller's transaction
    // rolls back, which the live-PostgreSQL suite proves end to end.
    expect(client.allocations).toEqual([]);
  });

  it("refuses a declared point that matches more than one ACTIVE range", async () => {
    // Two authorisations may each be ACTIVE — a new timbrado has to be
    // registrable while the current one is in use — so this is a real tenant
    // state, and the allocator's "greatest validity start" rule would pick one
    // the tenant did not mean.
    client.seedRange();
    client.seedRange({
      timbradoNumber: "87654321",
      validityStart: new Date("2026-01-01T00:00:00Z"),
    });

    const failure = await service
      .allocateForConfirmation({ invoiceId: INVOICE, tx: client.client })
      .then(
        () => null,
        (error: unknown) => error
      );

    expect((failure as DomainError).code).toBe("CONFLICT");
    expect((failure as DomainError).message).toBe(FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE);
    expect(client.allocations).toEqual([]);
    // Nothing was claimed either: both counters are where they started.
    expect(client.ranges.map((row) => row.nextNumber)).toEqual([1, 1]);
  });

  it("refuses a spent last series, naming the exhaustion instead of resolving it", async () => {
    client.seedRange({ series: "ZZ", rangeTo: 1, nextNumber: 2 });

    const failure = await service
      .allocateForConfirmation({ invoiceId: INVOICE, tx: client.client })
      .then(
        () => null,
        (error: unknown) => error
      );

    expect((failure as DomainError).code).toBe("CONFLICT");
    expect((failure as DomainError).message).toBe(FISCAL_ALLOCATION_SERIES_EXHAUSTED_MESSAGE);
    expect(client.allocations).toEqual([]);
  });

  it("keeps the allocator's internal detail out of the envelope", async () => {
    // A range whose own numbers cannot describe a sequence is a data defect: the
    // refusal is stable and carries no ids, because the allocator's message
    // names internal rows.
    client.seedRange({ rangeFrom: 10, rangeTo: 1, nextNumber: 10 });

    const failure = await service
      .allocateForConfirmation({ invoiceId: INVOICE, tx: client.client })
      .then(
        () => null,
        (error: unknown) => error
      );

    expect((failure as DomainError).message).toBe(FISCAL_ALLOCATION_REFUSED_MESSAGE);
    expect((failure as DomainError).message).not.toMatch(/range-1|12345678/);
  });
});
