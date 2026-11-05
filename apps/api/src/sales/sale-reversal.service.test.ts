import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { CashRepository } from "../cash/cash.repository.js";
import type { RequestContextService } from "../context/request-context.service.js";
import type { EntitlementsService } from "../entitlements/entitlements.service.js";
import type { FiscalCreditNoteService } from "../fiscal/fiscal-credit-note.service.js";
import type { InventoryRepository } from "../inventory/inventory.repository.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import {
  SALE_ALREADY_REVERSED_MESSAGE,
  SALE_HAS_DRAFT_INVOICE_MESSAGE,
  SALE_NOT_REVERSIBLE_MESSAGE,
  SALE_REVERSAL_KEY_CONFLICT_MESSAGE,
  SALE_REVERSAL_MOVEMENT_REASON,
  SALE_REVERSE_OPERATION,
  SaleReversalService,
} from "./sale-reversal.service.js";
import type { SaleRepository } from "./sales.repository.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const SALE = "33333333-3333-4333-8333-333333333333";
const SALE_BRANCH = "55555555-5555-4555-8555-555555555555";
const OTHER_BRANCH = "66666666-6666-4666-8666-666666666666";
const REVERSAL = "44444444-4444-4444-8444-444444444444";
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = { id: "55555555-5555-4555-8555-555555555555", registerId: "reg-1" };

interface Options {
  status?: string;
  invoices?: { id?: string; status: string }[];
  noteRefusal?: DomainError;
  payments?: { id: string; method: string; amount: string }[];
  originals?: { id: string; catalogItemId: string; quantity: string; branchId?: string }[];
  permissions?: string[];
  idempotency?: { fingerprint: string; resultSaleId: string } | null;
  existingReversal?: boolean;
  noOpenSession?: boolean;
  balances?: Record<string, string>;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const movements: { catalogItemId: string; quantity: string; reverses: unknown; type: string }[] =
    [];
  const balances: Record<string, string> = {};
  const movementBranches: string[] = [];
  const refunds: unknown[] = [];
  const cashRefunds: unknown[] = [];
  const audits: { action: string; metadata?: unknown }[] = [];

  const reversalRow = {
    id: REVERSAL,
    saleId: SALE,
    reason: "Cobro duplicado",
    createdAt: new Date("2026-11-03T10:00:00.000Z"),
    reversedByUserProfileId: ACTOR,
    cashSessionId: null as string | null,
    refunds: [] as { paymentId: string; method: string; amount: string }[],
    creditNote: null,
  };

  const tx = {
    invoice: { findMany: vi.fn(() => Promise.resolve(options.invoices ?? [])) },
    stockMovement: { findMany: vi.fn(() => Promise.resolve(options.originals ?? [])) },
    saleReversal: {
      findFirst: vi.fn(() =>
        Promise.resolve(options.existingReversal === false ? null : reversalRow)
      ),
      create: vi.fn((args: { data: { cashSessionId: string | null } }) => {
        calls.push("reversal");
        reversalRow.cashSessionId = args.data.cashSessionId;
        return Promise.resolve({ id: REVERSAL });
      }),
    },
    paymentRefund: {
      create: vi.fn((args: { data: { paymentId: string; method: string; amount: string } }) => {
        calls.push(`refund:${args.data.method}`);
        refunds.push(args.data);
        reversalRow.refunds.push(args.data);
        return Promise.resolve({ id: "pr" });
      }),
    },
    sale: {
      updateMany: vi.fn(() => {
        calls.push("status");
        return Promise.resolve({ count: 1 });
      }),
    },
  };

  const sales = {
    lockById: vi.fn(() => {
      calls.push("lock");
      return Promise.resolve();
    }),
    findIdempotencyRecord: vi.fn(() => Promise.resolve(options.idempotency ?? null)),
    createIdempotencyRecord: vi.fn(() => {
      calls.push("idempotency");
      return Promise.resolve();
    }),
    findById: vi.fn(() =>
      Promise.resolve({
        id: SALE,
        tenantId: TENANT,
        status: options.status ?? "COMPLETED",
        // MB-003: the sale's branch; stock returns to where each unit left.
        branchId: SALE_BRANCH,
        lines: [
          { catalogItemId: ITEM_B, quantity: "1.000" },
          { catalogItemId: ITEM_A, quantity: "2.000" },
        ],
      })
    ),
    listPayments: vi.fn(() =>
      Promise.resolve(
        options.payments ?? [
          { id: "p-cash", method: "CASH", amount: "100000.00" },
          { id: "p-card", method: "CARD", amount: "85000.00" },
        ]
      )
    ),
  } as unknown as SaleRepository;

  const inventory = {
    findItem: vi.fn((id: string) => Promise.resolve({ id, tracksStock: id === ITEM_A })),
    lockItemStock: vi.fn((id: string, _branchId: string) => {
      calls.push(`lock-stock:${id}`);
      return Promise.resolve();
    }),
    findBalance: vi.fn((id: string, _branchId: string) =>
      Promise.resolve({ quantity: options.balances?.[id] ?? "10.000" })
    ),
    createMovement: vi.fn(
      (data: {
        catalogItemId: string;
        quantity: Prisma.Decimal;
        reversesMovementId: unknown;
        type: string;
        reason: string;
        saleId: string;
        branchId: string;
      }) => {
        expect(data.reason).toBe(SALE_REVERSAL_MOVEMENT_REASON);
        expect(data.saleId).toBe(SALE);
        movementBranches.push(data.branchId);
        movements.push({
          catalogItemId: data.catalogItemId,
          quantity: data.quantity.toString(),
          reverses: data.reversesMovementId,
          type: data.type,
        });
        return Promise.resolve({});
      }
    ),
    upsertBalance: vi.fn((id: string, _branchId: string, value: Prisma.Decimal) => {
      balances[id] = value.toString();
      return Promise.resolve();
    }),
  } as unknown as InventoryRepository;

  const sessionLookup = vi.fn(() =>
    options.noOpenSession
      ? Promise.reject(new DomainError("CONFLICT", "An OPEN cash session is required."))
      : Promise.resolve(SESSION)
  );
  const cash = {
    resolveSingleOpenSession: sessionLookup,
    createRefundMovement: vi.fn((data: unknown) => {
      calls.push("cash-refund");
      cashRefunds.push(data);
      return Promise.resolve({ id: "cm-refund" });
    }),
  } as unknown as CashRepository;

  const prisma = {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    saleReversal: tx.saleReversal,
  };

  const entitlements = {
    has: vi.fn(() => Promise.resolve(true)),
  } as unknown as EntitlementsService;
  const context = {
    requireTenantId: () => TENANT,
    requireUserProfileId: () => ACTOR,
  } as unknown as RequestContextService;
  const resolver = {
    resolveForActiveRequest: () =>
      Promise.resolve(new Set(options.permissions ?? ["sales.reverse", "sales.read"])),
  } as unknown as PermissionResolver;
  const audit = {
    append: vi.fn((input: { action: string; metadata?: unknown }) => {
      calls.push("audit");
      audits.push(input);
      return Promise.resolve();
    }),
  } as unknown as AuditWriter;

  const creditNotes = {
    issueForReversal: vi.fn(
      (args: { invoiceId: string; saleReversalId: string; reason: string }) => {
        calls.push(`credit-note:${args.invoiceId}`);
        if (options.noteRefusal) return Promise.reject(options.noteRefusal);
        return Promise.resolve({
          creditNoteId: "cn-1",
          fiscalDocumentId: "fd-note",
          documentNumber: "0000001",
        });
      }
    ),
    enqueue: vi.fn((id: string) => {
      calls.push(`enqueue:${id}`);
      return Promise.resolve();
    }),
  };

  const service = new SaleReversalService(
    sales,
    inventory,
    cash,
    prisma as never,
    entitlements,
    context,
    resolver,
    audit,
    creditNotes as unknown as FiscalCreditNoteService
  );
  return {
    service,
    creditNotes,
    tx,
    sales,
    sessionLookup,
    calls,
    movements,
    movementBranches,
    balances,
    refunds,
    cashRefunds,
    audits,
  };
}

const input = { reason: "  Cobro duplicado  " };

describe("SaleReversalService — the whole reversal in one transaction (SAL-REV-001)", () => {
  it("compensates stock, refunds every payment, cancels the sale and audits, in order", async () => {
    const { service, calls, refunds, cashRefunds, audits, tx } = setup({
      originals: [
        { id: "mv-b", catalogItemId: ITEM_B, quantity: "-1.000", branchId: SALE_BRANCH },
        { id: "mv-a", catalogItemId: ITEM_A, quantity: "-2.000", branchId: SALE_BRANCH },
      ],
    });
    const result = await service.reverse(SALE, input, "key-1");

    expect(result.replay).toBe(false);
    expect(calls).toEqual([
      "lock",
      `lock-stock:${ITEM_A}`,
      `lock-stock:${ITEM_B}`,
      "reversal",
      // Payments in ascending id order: p-card, then p-cash with its cash movement.
      "refund:CARD",
      "cash-refund",
      "refund:CASH",
      "status",
      "idempotency",
      "audit",
    ]);
    expect(tx.saleReversal.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        reason: "Cobro duplicado",
        reversedByUserProfileId: ACTOR,
        cashSessionId: SESSION.id,
      },
    });
    expect(tx.sale.updateMany).toHaveBeenCalledWith({
      where: { id: SALE, tenantId: TENANT, status: "COMPLETED" },
      data: { status: "CANCELLED" },
    });
    expect(cashRefunds[0]).toMatchObject({
      sessionId: SESSION.id,
      amount: "100000.00",
      saleId: SALE,
      reason: SALE_REVERSAL_MOVEMENT_REASON,
    });
    expect(refunds).toEqual([
      expect.objectContaining({ paymentId: "p-card", method: "CARD", cashMovementId: null }),
      expect.objectContaining({ paymentId: "p-cash", method: "CASH", cashMovementId: "cm-refund" }),
    ]);
    expect(audits[0]).toMatchObject({
      action: "sale.reversed",
      metadata: { saleReversalId: REVERSAL, refunds: 2, cashRefund: true },
    });
    expect(JSON.stringify(audits[0])).not.toContain("Cobro duplicado");
  });

  it("returns every sold unit with a POSITIVE SALE_REVERSAL that names its original", async () => {
    const { service, movements, movementBranches, balances } = setup({
      originals: [
        { id: "mv-a", catalogItemId: ITEM_A, quantity: "-2.000", branchId: OTHER_BRANCH },
      ],
      balances: { [ITEM_A]: "18.000" },
    });
    await service.reverse(SALE, input);
    expect(movements).toEqual([
      { catalogItemId: ITEM_A, quantity: "2", reverses: "mv-a", type: "SALE_REVERSAL" },
    ]);
    expect(balances[ITEM_A]).toBe("20");
    // MB-003: back to the branch the unit left, which is the original's.
    expect(movementBranches).toEqual([OTHER_BRANCH]);
  });

  it("falls back to the tracked lines for a sale completed before movements were stamped", async () => {
    const { service, movements, movementBranches } = setup({ originals: [] });
    await service.reverse(SALE, input);
    // ITEM_B does not track stock; ITEM_A does.
    expect(movements).toEqual([
      { catalogItemId: ITEM_A, quantity: "2", reverses: null, type: "SALE_REVERSAL" },
    ]);
    // MB-003: without a stamped original, the sale's own branch.
    expect(movementBranches).toEqual([SALE_BRANCH]);
  });

  it("needs no cash session when nothing was paid in cash", async () => {
    const { service, sessionLookup, refunds } = setup({
      payments: [{ id: "p-card", method: "CARD", amount: "185000.00" }],
    });
    await service.reverse(SALE, input);
    expect(sessionLookup).not.toHaveBeenCalled();
    expect(refunds).toHaveLength(1);
  });
});

describe("SaleReversalService — an invoiced sale is compensated by a credit note (NCE-001)", () => {
  it("issues the note inside the transaction and enqueues it only after the commit", async () => {
    const { service, calls, creditNotes, audits } = setup({
      invoices: [{ id: "inv-1", status: "CONFIRMED" }],
      payments: [{ id: "p-card", method: "CARD", amount: "185000.00" }],
    });
    await service.reverse(SALE, input);

    expect(calls).toEqual([
      "lock",
      `lock-stock:${ITEM_A}`,
      "reversal",
      "refund:CARD",
      "credit-note:inv-1",
      "status",
      "audit",
      "enqueue:fd-note",
    ]);
    expect(creditNotes.issueForReversal.mock.calls[0]?.[0]).toMatchObject({
      invoiceId: "inv-1",
      saleReversalId: REVERSAL,
      reason: "Cobro duplicado",
    });
    expect(audits[0]).toMatchObject({ metadata: { creditNoteId: "cn-1" } });
  });

  it("rolls the whole reversal back when the note cannot be issued", async () => {
    const refusal = new DomainError("CONFLICT", "La factura electrónica todavía no fue aprobada");
    const { service, calls, tx } = setup({
      invoices: [{ id: "inv-1", status: "CONFIRMED" }],
      payments: [{ id: "p-card", method: "CARD", amount: "185000.00" }],
      noteRefusal: refusal,
    });
    await expect(service.reverse(SALE, input)).rejects.toBe(refusal);
    expect(tx.sale.updateMany).not.toHaveBeenCalled();
    expect(calls).not.toContain("enqueue:fd-note");
  });

  it("issues no note for a sale without a confirmed invoice", async () => {
    const { service, creditNotes } = setup();
    await service.reverse(SALE, input);
    expect(creditNotes.issueForReversal).not.toHaveBeenCalled();
    expect(creditNotes.enqueue).not.toHaveBeenCalled();
  });
});

describe("SaleReversalService — what it refuses, before writing anything", () => {
  it.each([
    ["a draft", { status: "DRAFT" }, SALE_NOT_REVERSIBLE_MESSAGE],
    ["an already reversed sale", { status: "CANCELLED" }, SALE_ALREADY_REVERSED_MESSAGE],
    [
      "a cancelled draft",
      { status: "CANCELLED", existingReversal: false },
      SALE_NOT_REVERSIBLE_MESSAGE,
    ],
    [
      "a sale with a draft invoice",
      { invoices: [{ status: "DRAFT" }] },
      SALE_HAS_DRAFT_INVOICE_MESSAGE,
    ],
  ] as const)("refuses %s", async (_label, options, message) => {
    const { service, calls } = setup(options as Options);
    await expect(service.reverse(SALE, input)).rejects.toMatchObject({ code: "CONFLICT", message });
    expect(calls).toEqual(["lock"]);
  });

  it("refuses a cash refund when no cash session is open", async () => {
    const { service, calls } = setup({ noOpenSession: true });
    await expect(service.reverse(SALE, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls).toEqual(["lock"]);
  });

  it("refuses a caller without sales.reverse before touching any data", async () => {
    const { service, calls } = setup({ permissions: ["sales.read", "sales.complete"] });
    await expect(service.reverse(SALE, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual([]);
  });
});

describe("SaleReversalService — idempotency", () => {
  it("replays an identical request with the same key and writes nothing", async () => {
    const first = setup();
    await first.service.reverse(SALE, input, "key-1");
    const fingerprint = (
      first.sales.createIdempotencyRecord as unknown as {
        mock: { calls: [[{ fingerprint: string; operation: string }]] };
      }
    ).mock.calls[0][0];
    expect(fingerprint.operation).toBe(SALE_REVERSE_OPERATION);

    const second = setup({
      idempotency: { fingerprint: fingerprint.fingerprint, resultSaleId: SALE },
    });
    const replay = await second.service.reverse(SALE, input, "key-1");
    expect(replay.replay).toBe(true);
    expect(second.calls).toEqual(["lock"]);
  });

  it("refuses the same key with a different reason", async () => {
    const { service } = setup({ idempotency: { fingerprint: "other", resultSaleId: SALE } });
    await expect(service.reverse(SALE, input, "key-1")).rejects.toMatchObject({
      message: SALE_REVERSAL_KEY_CONFLICT_MESSAGE,
    });
  });
});
