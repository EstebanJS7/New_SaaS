/**
 * FISC-015 WU-B — which source numbers a confirmed invoice, and what a refusal
 * does to the confirmation.
 *
 * The command's whole content at this unit is the BRANCH: a tenant that declared
 * its issuance point draws its number from the timbrado range (through the
 * Fiscal application boundary), a tenant that declared nothing keeps Billing's
 * counter, and a refusal rolls the confirmation back. The transaction is a fake
 * with real rollback semantics — it snapshots the state and restores it on any
 * throw — so "the invoice stays `DRAFT` and the counter did not move" is
 * observed rather than asserted by construction. The allocation itself is
 * covered by `fiscal-allocation.service.test.ts`, and the real commit/rollback
 * against PostgreSQL by the live-PG suite.
 */

import { DomainError } from "@newsaas/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { BILLING_PERMISSIONS } from "./billing.permissions.js";
import type { InvoiceRow } from "./billing.repository.js";
import { BillingService } from "./billing.service.js";
// Through the Fiscal MODULE, never the service's own file: `fiscal-boundary.test.ts`
// pins Billing's import surface to `fiscal.service.js` and `fiscal.module.js`, and
// that guard is the boundary this unit's one-way dependency travels along.
import { type FiscalAllocationService } from "../fiscal/fiscal.module.js";

/**
 * The two stable `409` messages, mirrored as LITERALS (never imported): the
 * constants themselves are pinned in `fiscal-allocation.service.test.ts` and in
 * the live-PostgreSQL suite's envelope assertion, and what this suite proves is
 * that the refusal PROPAGATES out of the confirmation unchanged.
 */
const FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE =
  "The issuance point this tenant declared has no ACTIVE timbrado range.";
const FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE =
  "The issuance point this tenant declared matches more than one ACTIVE timbrado range.";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const SALE = "33333333-3333-4333-8333-333333333333";

/** What one confirmation writes, in the shape the fakes mutate. */
interface FakeInvoice {
  id: string;
  tenantId: string;
  saleId: string;
  customerId: string | null;
  currency: string;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
  series: string;
  number: number | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The state one confirmation touches, with a transaction that really rolls back:
 * a throw restores every map, which is what makes "the refusal left nothing
 * behind" an observation.
 */
class FakeDatabase {
  readonly invoice: FakeInvoice = {
    id: INVOICE,
    tenantId: TENANT,
    saleId: SALE,
    customerId: null,
    currency: "PYG",
    status: "DRAFT",
    series: "A",
    number: null,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date("2026-10-10T00:00:00Z"),
    updatedAt: new Date("2026-10-10T00:00:00Z"),
  };
  /** The `(tenant, series)` counter rows, keyed by series. */
  readonly sequence = new Map<string, number>();
  readonly allocations: { invoiceId: string; documentNumber: string }[] = [];
  readonly audits: string[] = [];
  readonly counterCalls: string[] = [];

  async $transaction<T>(work: (tx: FakeDatabase) => Promise<T>): Promise<T> {
    const snapshot = {
      status: this.invoice.status,
      number: this.invoice.number,
      confirmedAt: this.invoice.confirmedAt,
      sequence: new Map(this.sequence),
      allocations: [...this.allocations],
      audits: [...this.audits],
    };
    try {
      return await work(this);
    } catch (error) {
      this.invoice.status = snapshot.status;
      this.invoice.number = snapshot.number;
      this.invoice.confirmedAt = snapshot.confirmedAt;
      this.sequence.clear();
      for (const [series, value] of snapshot.sequence) this.sequence.set(series, value);
      this.allocations.length = 0;
      this.allocations.push(...snapshot.allocations);
      this.audits.length = 0;
      this.audits.push(...snapshot.audits);
      throw error;
    }
  }
}

/** The Billing repository surface the confirm command uses, over the fake. */
function buildRepository(db: FakeDatabase) {
  return {
    lockById: () => Promise.resolve(),
    findById: () =>
      Promise.resolve({
        ...db.invoice,
        lines: [],
      } as unknown as InvoiceRow),
    allocateNumber: (series: string) => {
      db.counterCalls.push(series);
      const allocated = db.sequence.get(series) ?? 1;
      db.sequence.set(series, allocated + 1);
      return Promise.resolve(allocated);
    },
    markConfirmed: (id: string, number: number) => {
      if (db.invoice.id !== id || db.invoice.status !== "DRAFT") {
        return Promise.resolve(0);
      }
      db.invoice.status = "CONFIRMED";
      db.invoice.number = number;
      db.invoice.confirmedAt = new Date();
      return Promise.resolve(1);
    },
  };
}

type AllocationBehaviour = "allocate" | "counter" | "no-range" | "ambiguous";

function buildService(behaviour: AllocationBehaviour) {
  const db = new FakeDatabase();
  const repository = buildRepository(db);
  const received: { tx: unknown; invoiceId: string }[] = [];

  const allocation = {
    allocateForConfirmation: (args: { invoiceId: string; tx: unknown }) => {
      received.push(args);
      if (behaviour === "counter") {
        return Promise.resolve(null);
      }
      if (behaviour === "no-range") {
        return Promise.reject(
          new DomainError("CONFLICT", FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE)
        );
      }
      if (behaviour === "ambiguous") {
        return Promise.reject(
          new DomainError("CONFLICT", FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE)
        );
      }
      db.allocations.push({ invoiceId: args.invoiceId, documentNumber: "0000042" });
      return Promise.resolve();
    },
  };

  const audit = {
    append: () => {
      db.audits.push("invoice.confirmed");
      return Promise.resolve({});
    },
  };

  const service = new BillingService(
    repository as never,
    {} as never,
    db as never,
    {} as never,
    { has: () => Promise.resolve(true) } as never,
    {
      requireTenantId: () => TENANT,
      requireUserProfileId: () => ACTOR,
    } as never,
    {
      resolveForActiveRequest: () => Promise.resolve(new Set([BILLING_PERMISSIONS.confirm])),
    } as never,
    audit as never,
    {} as never,
    allocation as unknown as FiscalAllocationService
  );

  return { db, service, received };
}

describe("the confirmation's number source", () => {
  let db: FakeDatabase;
  let service: BillingService;
  let received: { tx: unknown; invoiceId: string }[];

  beforeEach(() => {
    ({ db, service, received } = buildService("allocate"));
  });

  it("persists the fiscal allocation and numbers the invoice with the counter", async () => {
    const response = await service.confirmInvoice(INVOICE);

    // TWO identities, deliberately: the invoice's own `number` is Billing's,
    // and the fiscal number is the allocation's. Writing the fiscal number here
    // would collide, because a successor range restarts at 1 while the invoice's
    // series is immutable across a permitted transition and its uniqueness is
    // `(tenant_id, series, number)` (finding R3-001).
    expect(response.number).toBe(1);
    expect(response.status).toBe("CONFIRMED");
    expect(response.confirmedAt).not.toBeNull();
    expect(db.allocations).toEqual([{ invoiceId: INVOICE, documentNumber: "0000042" }]);
    expect(db.counterCalls).toEqual(["A"]);
    expect(db.audits).toEqual(["invoice.confirmed"]);
  });

  it("hands the allocation the confirmation's OWN transaction handle", async () => {
    await service.confirmInvoice(INVOICE);

    // The range's compare-and-swap and the `DRAFT -> CONFIRMED` write have to
    // commit together (DEC-056), so the allocation must run on this handle and
    // not on a client of its own.
    expect(received).toHaveLength(1);
    expect(received[0]?.tx).toBe(db);
    expect(received[0]?.invoiceId).toBe(INVOICE);
  });

  it("does not allocate anything on a REPLAY of a confirmed invoice", async () => {
    await service.confirmInvoice(INVOICE);
    const first = db.invoice.number;

    const replay = await service.confirmInvoice(INVOICE);

    expect(replay.number).toBe(first);
    expect(received).toHaveLength(1);
    expect(db.audits).toEqual(["invoice.confirmed"]);
  });

  it("refuses a non-DRAFT invoice before any allocation", async () => {
    db.invoice.status = "CANCELLED";

    await expect(service.confirmInvoice(INVOICE)).rejects.toThrow(/Only a draft invoice/);

    expect(received).toEqual([]);
    expect(db.allocations).toEqual([]);
  });
});

describe("the counter path", () => {
  it("numbers the invoice from the counter when the tenant declared nothing", async () => {
    const { db, service } = buildService("counter");

    const response = await service.confirmInvoice(INVOICE);

    // The existing behaviour, pinned: the counter is created on first use and
    // returns 1, and no allocation row is written.
    expect(response.number).toBe(1);
    expect(response.status).toBe("CONFIRMED");
    expect(db.sequence.get("A")).toBe(2);
    expect(db.counterCalls).toEqual(["A"]);
    expect(db.allocations).toEqual([]);
    expect(db.audits).toEqual(["invoice.confirmed"]);
  });

  it("keeps consecutive numbers for a tenant that confirms twice", async () => {
    const { db, service } = buildService("counter");

    const first = await service.confirmInvoice(INVOICE);
    // A second invoice of the same tenant, same series.
    db.invoice.status = "DRAFT";
    db.invoice.number = null;
    db.invoice.confirmedAt = null;
    const second = await service.confirmInvoice(INVOICE);

    expect([first.number, second.number]).toEqual([1, 2]);
    expect(db.sequence.get("A")).toBe(3);
  });
});

describe("a refusal rolls the confirmation back", () => {
  it("leaves the invoice unconfirmed and the counter untouched when no ACTIVE range resolves", async () => {
    const { db, service } = buildService("no-range");

    await expect(service.confirmInvoice(INVOICE)).rejects.toThrow(
      FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE
    );

    // The property the whole design exists for: the refusal consumed nothing.
    expect(db.invoice.status).toBe("DRAFT");
    expect(db.invoice.number).toBeNull();
    expect(db.invoice.confirmedAt).toBeNull();
    expect(db.sequence.size).toBe(0);
    expect(db.allocations).toEqual([]);
    expect(db.audits).toEqual([]);
  });

  it("does the same when the declared point matches more than one ACTIVE range", async () => {
    const { db, service } = buildService("ambiguous");

    await expect(service.confirmInvoice(INVOICE)).rejects.toThrow(
      FISCAL_ALLOCATION_AMBIGUOUS_RANGE_MESSAGE
    );

    expect(db.invoice.status).toBe("DRAFT");
    expect(db.invoice.number).toBeNull();
    expect(db.sequence.size).toBe(0);
    expect(db.audits).toEqual([]);
  });

  it("propagates the stable code, so the API renders a 409 and not a 500", async () => {
    const { service } = buildService("no-range");

    const failure = await service.confirmInvoice(INVOICE).then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("CONFLICT");
  });
});
