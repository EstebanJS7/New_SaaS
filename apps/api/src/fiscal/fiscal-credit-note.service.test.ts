import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@newsaas/shared";
import type { AuditWriter } from "../audit/audit-writer.service.js";
import type { RequestContextService } from "../context/request-context.service.js";
import {
  FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE,
  type FiscalAllocationService,
} from "./fiscal-allocation.service.js";
import {
  CREDIT_NOTE_ALREADY_ISSUED_MESSAGE,
  CREDIT_NOTE_INVOICE_CANCELLING_MESSAGE,
  CREDIT_NOTE_INVOICE_NOT_APPROVED_MESSAGE,
  CREDIT_NOTE_INVOICE_NOT_ELECTRONIC_MESSAGE,
  CREDIT_NOTE_INVOICE_PENDING_MESSAGE,
  CREDIT_NOTE_NO_ISSUANCE_POINT_MESSAGE,
  CREDIT_NOTE_NO_RANGE_MESSAGE,
  FISCAL_CREDIT_NOTE_ISSUED_ACTION,
  FiscalCreditNoteService,
  type CreditNoteTx,
} from "./fiscal-credit-note.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const INVOICE = "33333333-3333-4333-8333-333333333333";
const REVERSAL = "44444444-4444-4444-8444-444444444444";
const FE_CDC = `01${"8".repeat(42)}`;

const ALLOCATED = {
  rangeId: "range-5",
  timbradoNumber: "12345678",
  establishmentId: "est-1",
  expeditionPoint: "001",
  documentType: 5,
  series: null,
  documentNumber: "0000007",
};

interface Options {
  factura?: { status: string; cdc: string | null } | null;
  existingNote?: boolean;
  allocation?: "none" | "no-range" | "ok";
  enqueueFails?: boolean;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const factura =
    options.factura === undefined
      ? { id: "fd-fe", status: "APPROVED", cdc: FE_CDC }
      : options.factura;
  const tx = {
    $queryRaw: vi.fn(() => {
      calls.push("lock-invoice");
      return Promise.resolve([]);
    }),
    fiscalDocument: {
      findFirst: vi.fn((_args: unknown) => Promise.resolve(factura)),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        calls.push("document");
        return Promise.resolve({ id: "fd-note", ...args.data });
      }),
      updateMany: vi.fn(() => {
        calls.push("queued");
        return Promise.resolve({ count: 1 });
      }),
    },
    creditNote: {
      findFirst: vi.fn(() => Promise.resolve(options.existingNote ? { id: "cn-0" } : null)),
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        calls.push("note");
        return Promise.resolve({ id: "cn-1", ...args.data });
      }),
    },
  };
  const allocation = {
    allocateForDocumentType: vi.fn((args: { documentType: number }) => {
      calls.push(`allocate:${args.documentType}`);
      if (options.allocation === "none") return Promise.resolve(null);
      if (options.allocation === "no-range")
        return Promise.reject(
          new DomainError("CONFLICT", FISCAL_ALLOCATION_NO_ACTIVE_RANGE_MESSAGE)
        );
      return Promise.resolve(ALLOCATED);
    }),
  } as unknown as FiscalAllocationService;
  const audits: { action: string; metadata?: unknown }[] = [];
  const audit = {
    append: vi.fn((entry: { action: string; metadata?: unknown }) => {
      calls.push("audit");
      audits.push(entry);
      return Promise.resolve();
    }),
  } as unknown as AuditWriter;
  const context = {
    requireTenantId: () => TENANT,
    requireUserProfileId: () => ACTOR,
  } as unknown as RequestContextService;
  const producer = {
    enqueue: vi.fn(() =>
      options.enqueueFails ? Promise.reject(new Error("redis down")) : Promise.resolve()
    ),
  };
  const service = new FiscalCreditNoteService(
    context,
    allocation,
    audit,
    { provider: "FAKE" } as never,
    producer
  );
  const issue = () =>
    service.issueForReversal({
      invoiceId: INVOICE,
      saleReversalId: REVERSAL,
      reason: "Cobro duplicado",
      tx: tx as unknown as CreditNoteTx,
    });
  return { service, tx, calls, audits, producer, issue };
}

describe("FiscalCreditNoteService.issueForReversal (NCE-001)", () => {
  it("locks the invoice, numbers the note under type 5, writes it, queues its document and audits", async () => {
    const { issue, calls, tx, audits } = setup();
    const issued = await issue();

    expect(issued).toEqual({
      creditNoteId: "cn-1",
      fiscalDocumentId: "fd-note",
      documentNumber: "0000007",
    });
    expect(calls).toEqual(["lock-invoice", "allocate:5", "note", "document", "queued", "audit"]);
    expect(tx.fiscalDocument.findFirst.mock.calls[0]?.[0]).toEqual({
      where: {
        tenantId: TENANT,
        invoiceId: INVOICE,
        creditNoteId: null,
        status: { not: "CANCELLED" },
      },
    });
    expect(tx.creditNote.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        tenantId: TENANT,
        invoiceId: INVOICE,
        saleReversalId: REVERSAL,
        motive: 2,
        associatedCdc: FE_CDC,
        documentType: 5,
        documentNumber: "0000007",
        issuedByUserProfileId: ACTOR,
      },
    });
    expect(tx.fiscalDocument.create.mock.calls[0]?.[0]).toMatchObject({
      data: { invoiceId: INVOICE, creditNoteId: "cn-1", provider: "FAKE", status: "PENDING" },
    });
    expect(audits[0]).toMatchObject({
      action: FISCAL_CREDIT_NOTE_ISSUED_ACTION,
      targetType: "credit_note",
      targetId: "cn-1",
    });
    expect(JSON.stringify(audits[0])).not.toContain("Cobro duplicado");
  });

  it.each([
    ["no electronic factura", { factura: null }, CREDIT_NOTE_INVOICE_NOT_ELECTRONIC_MESSAGE],
    [
      "a factura still queued",
      { factura: { status: "QUEUED", cdc: null } },
      CREDIT_NOTE_INVOICE_PENDING_MESSAGE,
    ],
    [
      "a factura submitted but unresolved",
      { factura: { status: "SUBMITTED", cdc: FE_CDC } },
      CREDIT_NOTE_INVOICE_PENDING_MESSAGE,
    ],
    [
      "a rejected factura",
      { factura: { status: "REJECTED", cdc: FE_CDC } },
      CREDIT_NOTE_INVOICE_NOT_APPROVED_MESSAGE,
    ],
    [
      "a factura being cancelled",
      { factura: { status: "CANCEL_PENDING", cdc: FE_CDC } },
      CREDIT_NOTE_INVOICE_CANCELLING_MESSAGE,
    ],
    [
      "an invoice that already has a note",
      { existingNote: true },
      CREDIT_NOTE_ALREADY_ISSUED_MESSAGE,
    ],
    [
      "a tenant with no declared issuance point",
      { allocation: "none" },
      CREDIT_NOTE_NO_ISSUANCE_POINT_MESSAGE,
    ],
    ["no ACTIVE type-5 range", { allocation: "no-range" }, CREDIT_NOTE_NO_RANGE_MESSAGE],
  ] as const)("refuses %s with a 409 and writes nothing", async (_label, options, message) => {
    const { issue, tx } = setup(options);
    await expect(issue()).rejects.toMatchObject({ code: "CONFLICT", message });
    expect(tx.creditNote.create).not.toHaveBeenCalled();
    expect(tx.fiscalDocument.create).not.toHaveBeenCalled();
  });
});

describe("FiscalCreditNoteService.enqueue", () => {
  it("hands the document to the producer with the tenant", async () => {
    const { service, producer } = setup();
    await service.enqueue("fd-note");
    expect(producer.enqueue).toHaveBeenCalledWith({
      fiscalDocumentId: "fd-note",
      tenantId: TENANT,
    });
  });

  it("never throws: the reversal is committed and the sweep re-drives QUEUED", async () => {
    const { service } = setup({ enqueueFails: true });
    await expect(service.enqueue("fd-note")).resolves.toBeUndefined();
  });
});
