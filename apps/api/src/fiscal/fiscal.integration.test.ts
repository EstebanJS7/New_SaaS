import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import type {
  AuditLogRow,
  FiscalDocumentRow,
  TenantRow,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { FISCAL_PERMISSIONS } from "./fiscal.permissions.js";
import {
  FISCAL_DOCUMENT_NOT_FOUND_MESSAGE,
  FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE,
} from "./fiscal.repository.js";
import {
  FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE,
  FISCAL_FEATURE_NOT_ENTITLED_MESSAGE,
  FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE,
  FISCAL_DOCUMENT_CANCEL_SENDING_MESSAGE,
  FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION,
  FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION,
} from "./fiscal.service.js";

interface ErrorDto {
  error: { code: string; message: string };
}

interface FiscalDocumentDto {
  id: string;
  invoiceId: string;
  provider: string;
  status: string;
  attemptCount: number;
  externalId: string | null;
  cdc: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

const RESPONSE_KEYS = [
  "id",
  "invoiceId",
  "provider",
  "status",
  "attemptCount",
  "externalId",
  "cdc",
  "lastErrorCode",
  "createdAt",
  "updatedAt",
  "cancelledAt",
];

interface FiscalTenant {
  tenant: TenantRow;
  actor: RbacActor;
}

function seedTenant(
  booted: BootedTestApp,
  label: string,
  entitled: boolean,
  permitted: boolean
): FiscalTenant {
  const suffix = randomUUID().slice(0, 8);
  const tenant = booted.db.prisma.tenant.create({
    data: { slug: `fiscal-${label}-${suffix}`, name: `Fiscal ${label}` },
  });
  const role = seedRoleWithKeys(
    booted.db,
    `FISCAL_${label}_${suffix}`,
    `Fiscal ${label}`,
    permitted ? [FISCAL_PERMISSIONS.issue] : []
  );
  const actor = seedRbacActor(booted.db, {
    email: `fiscal-${label}-${suffix}@isolation.test`,
    tenantId: tenant.id,
    roleId: role.role.id,
  });
  if (entitled) {
    const feature = booted.db.prisma.featureCode.create({ data: { code: "fiscal" } });
    booted.db.prisma.tenantEntitlement.create({
      data: { tenantId: tenant.id, featureCodeId: feature.id },
    });
  }
  return { tenant, actor };
}

let invoiceNumber = 0;

function seedInvoice(booted: BootedTestApp, tenantId: string, status: "CONFIRMED" | "DRAFT") {
  return booted.db.prisma.invoice.create({
    data: {
      tenantId,
      saleId: randomUUID(),
      currency: "PYG",
      status,
      number: status === "CONFIRMED" ? ++invoiceNumber : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      lines: { create: [] },
    },
  });
}

function auditsFor(booted: BootedTestApp, action: string): AuditLogRow[] {
  return [...booted.db.tables.audits.values()].filter((row) => row.action === action);
}

const issue = (booted: BootedTestApp, cookie: string, invoiceId: string) =>
  supertest(booted.app.getHttpServer())
    .post("/fiscal-documents")
    .set("Cookie", cookie)
    .send({ invoiceId });

describe("Fiscal HTTP boundary — cancel command", () => {
  let booted: BootedTestApp;
  let entitled: FiscalTenant;
  let foreign: FiscalTenant;
  let unentitled: FiscalTenant;
  let forbidden: FiscalTenant;
  beforeAll(async () => {
    booted = await bootTestApp();
    entitled = seedTenant(booted, "cancel-a", true, true);
    foreign = seedTenant(booted, "cancel-b", true, true);
    unentitled = seedTenant(booted, "cancel-c", false, true);
    forbidden = seedTenant(booted, "cancel-d", true, false);
  });
  afterAll(async () => booted.close());

  function document(tenantId: string, status: FiscalDocumentRow["status"] = "QUEUED") {
    const invoice = seedInvoice(booted, tenantId, "CONFIRMED");
    const now = new Date();
    const row: FiscalDocumentRow = {
      id: randomUUID(),
      tenantId,
      invoiceId: invoice.id,
      provider: "FAKE",
      status,
      attemptCount: 0,
      externalId: "provider-123",
      cdc: "cdc-456",
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    booted.db.tables.fiscalDocuments.set(row.id, row);
    return row;
  }
  const cancel = (
    cookie: string,
    id: string,
    body: Record<string, unknown> = { reason: "operator request" }
  ) =>
    supertest(booted.app.getHttpServer())
      .post(`/fiscal-documents/${id}/cancel`)
      .set("Cookie", cookie)
      .send(body);

  it("cancels a QUEUED document and audits exactly one request", async () => {
    const queued = document(entitled.tenant.id);
    booted.fiscalProvider.scriptCancel(["CANCELLED"]);
    const jobsBefore = booted.fiscalSubmissionProducer.enqueued.length;
    const providerBefore = booted.fiscalProvider.cancelRequests.length;
    const auditsBefore = auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION).length;
    const success = await cancel(entitled.actor.cookie, queued.id).expect(200);
    const body = success.body as FiscalDocumentDto;
    expect(body.status).toBe("CANCELLED");
    expect(Object.keys(body).sort()).toEqual([...RESPONSE_KEYS].sort());
    expect(auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION)).toHaveLength(
      auditsBefore + 1
    );
    expect(booted.fiscalSubmissionProducer.enqueued).toHaveLength(jobsBefore);
    expect(booted.fiscalProvider.cancelRequests).toHaveLength(providerBefore + 1);
    const request = booted.fiscalProvider.cancelRequests.at(-1);
    expect(request?.fiscalDocumentId).toBe(queued.id);
    expect(request?.reason).toBe("operator request");
    expect(request?.externalId).toBe("provider-123");
    expect(request?.cdc).toBe("cdc-456");
  });

  it("replays an already CANCELLED document without provider call or audit", async () => {
    const cancelled = document(entitled.tenant.id, "CANCELLED");
    booted.fiscalProvider.scriptCancel(["REJECTED"]);
    const providerBefore = booted.fiscalProvider.cancelRequests.length;
    const auditsBefore = auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION).length;
    const response = await cancel(entitled.actor.cookie, cancelled.id).expect(200);
    const body = response.body as FiscalDocumentDto;
    expect(body.status).toBe("CANCELLED");
    expect(Object.keys(body).sort()).toEqual([...RESPONSE_KEYS].sort());
    expect(auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION)).toHaveLength(
      auditsBefore
    );
    expect(booted.fiscalProvider.cancelRequests).toHaveLength(providerBefore);
  });

  it("rejects a SENDING document before provider call or audit", async () => {
    const sending = document(entitled.tenant.id, "SENDING");
    booted.fiscalProvider.scriptCancel(["CANCELLED"]);
    const providerBefore = booted.fiscalProvider.cancelRequests.length;
    const auditBefore = booted.db.tables.audits.size;
    const response = await cancel(entitled.actor.cookie, sending.id).expect(409);
    expect((response.body as ErrorDto).error.message).toBe(FISCAL_DOCUMENT_CANCEL_SENDING_MESSAGE);
    expect(booted.fiscalProvider.cancelRequests).toHaveLength(providerBefore);
    expect(booted.db.tables.audits.size).toBe(auditBefore);
  });

  it("persists and audits a REJECTED provider outcome while preserving document status", async () => {
    const row = document(entitled.tenant.id, "APPROVED");
    booted.fiscalProvider.scriptCancel(["REJECTED"]);
    const failedBefore = auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION).length;
    const response = await cancel(entitled.actor.cookie, row.id).expect(409);
    expect((response.body as ErrorDto).error.message).toBe("Simulated rejected");
    expect(row.status).toBe("APPROVED");
    expect(row.lastErrorCode).toBe("FAKE_REJECTED");
    expect(row.lastErrorMessage).toBe("Simulated rejected");
    expect(auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION)).toHaveLength(
      failedBefore + 1
    );
  });

  it("persists a TRANSIENT_FAILURE without moving the document to ERROR", async () => {
    const row = document(entitled.tenant.id, "APPROVED");
    booted.fiscalProvider.scriptCancel(["TRANSIENT_FAILURE"]);
    const failedBefore = auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION).length;
    const response = await cancel(entitled.actor.cookie, row.id).expect(409);
    expect((response.body as ErrorDto).error.message).toBe("Simulated transient_failure");
    expect(row.status).toBe("APPROVED");
    expect(row.status).not.toBe("ERROR");
    expect(row.lastErrorCode).toBe("FAKE_TRANSIENT_FAILURE");
    expect(auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_FAILED_ACTION)).toHaveLength(
      failedBefore + 1
    );
  });

  it("accepts CANCEL_PENDING for an APPROVED document", async () => {
    const row = document(entitled.tenant.id, "APPROVED");
    booted.fiscalProvider.scriptCancel(["CANCEL_PENDING"]);
    const requestedBefore = auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION).length;
    const response = await cancel(entitled.actor.cookie, row.id).expect(200);
    expect((response.body as FiscalDocumentDto).status).toBe("CANCEL_PENDING");
    expect(auditsFor(booted, FISCAL_DOCUMENT_CANCELLATION_REQUESTED_ACTION)).toHaveLength(
      requestedBefore + 1
    );
  });

  it("masks unknown and foreign document ids as equivalent 404s", async () => {
    const foreignRow = document(foreign.tenant.id);
    booted.fiscalProvider.scriptCancel(["CANCELLED"]);
    await expectCrossTenant404({
      app: booted.app,
      cookie: entitled.actor.cookie,
      method: "POST",
      nonexistentUrl: `/fiscal-documents/${randomUUID()}/cancel`,
      foreignUrl: `/fiscal-documents/${foreignRow.id}/cancel`,
      body: { reason: "operator request" },
      forbiddenIdentifiers: [foreignRow.id, foreign.tenant.id],
    });
    expect(foreignRow.status).toBe("QUEUED");
    const unknown = await cancel(entitled.actor.cookie, randomUUID()).expect(404);
    expect((unknown.body as ErrorDto).error.message).toBe(FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE);
    expect(foreignRow.status).toBe("QUEUED");
  });

  it("checks entitlement before permission without provider calls or audit writes", async () => {
    booted.fiscalProvider.scriptCancel(["CANCELLED"]);
    const providerBefore = booted.fiscalProvider.cancelRequests.length;
    const auditBefore = booted.db.tables.audits.size;
    const noEntitlement = await cancel(unentitled.actor.cookie, randomUUID()).expect(403);
    expect((noEntitlement.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((noEntitlement.body as ErrorDto).error.message).toBe(
      FISCAL_FEATURE_NOT_ENTITLED_MESSAGE
    );
    const noPermission = await cancel(forbidden.actor.cookie, randomUUID()).expect(403);
    expect((noPermission.body as ErrorDto).error.code).toBe("FORBIDDEN");
    expect(booted.fiscalProvider.cancelRequests).toHaveLength(providerBefore);
    expect(booted.db.tables.audits.size).toBe(auditBefore);
  });

  it("rejects invalid cancel bodies and non-UUID path ids", async () => {
    booted.fiscalProvider.scriptCancel(["CANCELLED"]);
    const providerBefore = booted.fiscalProvider.cancelRequests.length;
    const validationId = randomUUID();
    const invalidBodies = [
      {},
      { reason: "" },
      { reason: "   " },
      { reason: "x".repeat(501) },
      { reason: "ok", status: "CANCELLED" },
    ];
    for (const body of invalidBodies) {
      const response = await cancel(entitled.actor.cookie, validationId, body).expect(400);
      expect((response.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    }
    const invalidPath = await cancel(entitled.actor.cookie, "not-a-uuid").expect(400);
    expect((invalidPath.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    expect(booted.fiscalProvider.cancelRequests).toHaveLength(providerBefore);
  });
});

describe("Fiscal HTTP boundary — read commands", () => {
  let booted: BootedTestApp;
  let entitled: FiscalTenant;
  let unentitled: FiscalTenant;
  let forbidden: FiscalTenant;
  let foreign: FiscalTenant;

  beforeAll(async () => {
    booted = await bootTestApp();
    const seedReadTenant = (label: string, isEntitled: boolean, readPermission: boolean) => {
      const suffix = randomUUID().slice(0, 8);
      const tenant = booted.db.prisma.tenant.create({
        data: { slug: `fiscal-read-${label}-${suffix}`, name: `Fiscal read ${label}` },
      });
      const keys = readPermission
        ? [FISCAL_PERMISSIONS.issue, FISCAL_PERMISSIONS.read]
        : [FISCAL_PERMISSIONS.issue];
      const role = seedRoleWithKeys(
        booted.db,
        `FISCAL_READ_${label}_${suffix}`,
        `Fiscal read ${label}`,
        keys
      );
      const actor = seedRbacActor(booted.db, {
        email: `fiscal-read-${label}-${suffix}@isolation.test`,
        tenantId: tenant.id,
        roleId: role.role.id,
      });
      if (isEntitled) {
        const feature = booted.db.prisma.featureCode.create({ data: { code: "fiscal" } });
        booted.db.prisma.tenantEntitlement.create({
          data: { tenantId: tenant.id, featureCodeId: feature.id },
        });
      }
      return { tenant, actor };
    };
    entitled = seedReadTenant("a", true, true);
    unentitled = seedReadTenant("b", false, true);
    forbidden = seedReadTenant("c", true, false);
    foreign = seedReadTenant("d", true, true);
  });

  afterAll(async () => {
    await booted.close();
  });

  function document(
    tenantId: string,
    status: FiscalDocumentRow["status"],
    createdAt: Date
  ): FiscalDocumentRow {
    const invoice = seedInvoice(booted, tenantId, "CONFIRMED");
    const row: FiscalDocumentRow = {
      id: randomUUID(),
      tenantId,
      invoiceId: invoice.id,
      provider: "FAKE",
      status,
      attemptCount: 0,
      externalId: "provider-read-123",
      cdc: "cdc-read-456",
      lastErrorCode: null,
      createdAt,
      updatedAt: createdAt,
    };
    booted.db.tables.fiscalDocuments.set(row.id, row);
    return row;
  }

  const getDocuments = (cookie: string, query = "") =>
    supertest(booted.app.getHttpServer()).get(`/fiscal-documents${query}`).set("Cookie", cookie);
  const getDocument = (cookie: string, id: string) =>
    supertest(booted.app.getHttpServer()).get(`/fiscal-documents/${id}`).set("Cookie", cookie);

  it("lists only the caller tenant's newest-first documents with the allowlisted DTO", async () => {
    const first = document(entitled.tenant.id, "QUEUED", new Date("2100-01-01T00:00:00.000Z"));
    const second = document(entitled.tenant.id, "APPROVED", new Date("2101-01-01T00:00:00.000Z"));
    const foreignRow = document(foreign.tenant.id, "QUEUED", new Date("2102-01-01T00:00:00.000Z"));

    const response = await getDocuments(entitled.actor.cookie).expect(200);
    const rows = response.body as FiscalDocumentDto[];
    expect(rows[0].id).toBe(second.id);
    expect(rows[1].id).toBe(first.id);
    expect(rows.map((row) => row.id)).not.toContain(foreignRow.id);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...RESPONSE_KEYS].sort());
      expect("requestSnapshot" in row).toBe(false);
      expect("responseSnapshot" in row).toBe(false);
      expect("tenantId" in row).toBe(false);
    }
    expect(response.text).not.toContain(foreignRow.id);
  });

  it("honours the status filter and leaves omitted status unfiltered", async () => {
    const queued = document(entitled.tenant.id, "QUEUED", new Date("2103-01-01T00:00:00.000Z"));
    const approved = document(entitled.tenant.id, "APPROVED", new Date("2104-01-01T00:00:00.000Z"));
    const allCallerRows = [...booted.db.tables.fiscalDocuments.values()].filter(
      (row) => row.tenantId === entitled.tenant.id
    );
    expect(new Set(allCallerRows.map((row) => row.status)).size).toBeGreaterThan(1);

    const queuedRows = (await getDocuments(entitled.actor.cookie, "?status=QUEUED").expect(200))
      .body as FiscalDocumentDto[];
    expect(queuedRows.map((row) => row.id)).toContain(queued.id);
    expect(queuedRows.map((row) => row.id)).not.toContain(approved.id);
    expect(queuedRows.every((row) => row.status === "QUEUED")).toBe(true);

    const unfiltered = (await getDocuments(entitled.actor.cookie).expect(200))
      .body as FiscalDocumentDto[];
    expect(unfiltered).toHaveLength(allCallerRows.length);
    expect(unfiltered.map((row) => row.id)).toContain(queued.id);
    expect(unfiltered.map((row) => row.id)).toContain(approved.id);
  });

  it("returns an issued document by id with the issue response representation", async () => {
    const invoice = seedInvoice(booted, entitled.tenant.id, "CONFIRMED");
    const issued = await issue(booted, entitled.actor.cookie, invoice.id).expect(201);
    const issuedBody = issued.body as FiscalDocumentDto;
    const fetched = await getDocument(entitled.actor.cookie, issuedBody.id).expect(200);
    const fetchedBody = fetched.body as FiscalDocumentDto;
    expect(Object.keys(fetchedBody).sort()).toEqual([...RESPONSE_KEYS].sort());
    expect(fetched.text).toBe(issued.text);
  });

  it("masks unknown and foreign document ids as byte-equivalent 404s", async () => {
    const foreignRow = document(foreign.tenant.id, "QUEUED", new Date());
    const statusBefore = foreignRow.status;
    const errorBefore = foreignRow.lastErrorCode;
    await expectCrossTenant404({
      app: booted.app,
      cookie: entitled.actor.cookie,
      method: "GET",
      nonexistentUrl: `/fiscal-documents/${randomUUID()}`,
      foreignUrl: `/fiscal-documents/${foreignRow.id}`,
      forbiddenIdentifiers: [foreignRow.id, foreign.tenant.id],
    });
    const unknown = await getDocument(entitled.actor.cookie, randomUUID()).expect(404);
    expect((unknown.body as ErrorDto).error.message).toBe(FISCAL_DOCUMENT_TARGET_NOT_FOUND_MESSAGE);
    expect(foreignRow.status).toBe(statusBefore);
    expect(foreignRow.lastErrorCode).toBe(errorBefore);
  });

  it("checks fiscal entitlement before fiscal.read permission", async () => {
    const noEntitlement = await getDocuments(unentitled.actor.cookie).expect(403);
    expect((noEntitlement.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((noEntitlement.body as ErrorDto).error.message).toBe(
      FISCAL_FEATURE_NOT_ENTITLED_MESSAGE
    );

    const noPermission = await getDocuments(forbidden.actor.cookie).expect(403);
    expect((noPermission.body as ErrorDto).error.code).toBe("FORBIDDEN");
  });

  it("rejects unknown query keys, invalid statuses and non-UUID path ids", async () => {
    const unknownQuery = await getDocuments(entitled.actor.cookie, "?unexpected=value").expect(400);
    expect((unknownQuery.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    const invalidStatus = await getDocuments(entitled.actor.cookie, "?status=NOT_A_STATUS").expect(
      400
    );
    expect((invalidStatus.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
    const invalidId = await getDocument(entitled.actor.cookie, "not-a-uuid").expect(400);
    expect((invalidId.body as ErrorDto).error.code).toBe("VALIDATION_FAILED");
  });

  it("does not append audit rows for list or get reads", async () => {
    const row = document(entitled.tenant.id, "QUEUED", new Date());
    const auditsBefore = booted.db.tables.audits.size;
    await getDocuments(entitled.actor.cookie).expect(200);
    await getDocument(entitled.actor.cookie, row.id).expect(200);
    expect(booted.db.tables.audits.size).toBe(auditsBefore);
  });
});

describe("Fiscal HTTP boundary — issue command", () => {
  let booted: BootedTestApp;
  let entitled: FiscalTenant;
  let foreign: FiscalTenant;
  let unentitled: FiscalTenant;
  let forbidden: FiscalTenant;

  beforeAll(async () => {
    booted = await bootTestApp();
    entitled = seedTenant(booted, "a", true, true);
    foreign = seedTenant(booted, "b", true, true);
    unentitled = seedTenant(booted, "c", false, true);
    forbidden = seedTenant(booted, "d", true, false);
  });
  afterAll(async () => {
    await booted.close();
  });

  it("issues one document and one exactly-shaped job, returns the allowlisted DTO and audits once", async () => {
    const invoice = seedInvoice(booted, entitled.tenant.id, "CONFIRMED");
    const auditCount = auditsFor(booted, "fiscal.document.issue_requested").length;
    const response = await issue(booted, entitled.actor.cookie, invoice.id).expect(201);
    const body = response.body as FiscalDocumentDto;
    expect(Object.keys(body).sort()).toEqual([...RESPONSE_KEYS].sort());
    expect("requestSnapshot" in body).toBe(false);
    expect("responseSnapshot" in body).toBe(false);
    expect(body.invoiceId).toBe(invoice.id);
    expect(body.status).toBe("QUEUED");
    expect(booted.db.tables.fiscalDocuments.size).toBe(1);
    expect(booted.fiscalSubmissionProducer.enqueued).toHaveLength(1);
    const job = booted.fiscalSubmissionProducer.enqueued[0];
    expect(Object.keys(job).sort()).toEqual(["fiscalDocumentId", "tenantId"]);
    expect(job.fiscalDocumentId).toBe(body.id);
    expect(job.tenantId).toBe(entitled.tenant.id);
    const audits = auditsFor(booted, "fiscal.document.issue_requested");
    expect(audits).toHaveLength(auditCount + 1);
    expect(audits.at(-1)?.targetId).toBe(body.id);
  });

  it("masks unknown and cross-tenant invoice ids as byte-equivalent 404s", async () => {
    const invoice = seedInvoice(booted, foreign.tenant.id, "CONFIRMED");
    await expectCrossTenant404({
      app: booted.app,
      cookie: entitled.actor.cookie,
      method: "POST",
      nonexistentUrl: "/fiscal-documents",
      foreignUrl: "/fiscal-documents",
      body: { invoiceId: randomUUID() },
      foreignBody: { invoiceId: invoice.id },
      forbiddenIdentifiers: [invoice.id, foreign.tenant.id],
    });
    const response = await issue(booted, entitled.actor.cookie, randomUUID()).expect(404);
    expect((response.body as ErrorDto).error.message).toBe(FISCAL_DOCUMENT_NOT_FOUND_MESSAGE);
  });

  it("rejects a DRAFT invoice without creating a document, job or audit", async () => {
    const invoice = seedInvoice(booted, entitled.tenant.id, "DRAFT");
    const auditsBefore = auditsFor(booted, "fiscal.document.issue_requested").length;
    const jobsBefore = booted.fiscalSubmissionProducer.enqueued.length;
    const response = await issue(booted, entitled.actor.cookie, invoice.id).expect(409);
    expect((response.body as ErrorDto).error.message).toBe(FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE);
    expect(booted.fiscalSubmissionProducer.enqueued).toHaveLength(jobsBefore);
    expect(auditsFor(booted, "fiscal.document.issue_requested")).toHaveLength(auditsBefore);
  });

  it("rejects a repeated command without enqueueing or auditing again", async () => {
    const invoice = seedInvoice(booted, entitled.tenant.id, "CONFIRMED");
    const jobsBefore = booted.fiscalSubmissionProducer.enqueued.length;
    await issue(booted, entitled.actor.cookie, invoice.id).expect(201);
    const auditsBefore = auditsFor(booted, "fiscal.document.issue_requested").length;
    const response = await issue(booted, entitled.actor.cookie, invoice.id).expect(409);
    expect((response.body as ErrorDto).error.message).toBe(FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE);
    expect(booted.fiscalSubmissionProducer.enqueued).toHaveLength(jobsBefore + 1);
    expect(auditsFor(booted, "fiscal.document.issue_requested")).toHaveLength(auditsBefore);
  });

  it("applies entitlement before permission and refuses missing permission", async () => {
    const invoice = seedInvoice(booted, entitled.tenant.id, "CONFIRMED");
    const jobsBefore = booted.fiscalSubmissionProducer.enqueued.length;
    const auditsBefore = auditsFor(booted, "fiscal.document.issue_requested").length;
    const noEntitlement = await issue(booted, unentitled.actor.cookie, invoice.id).expect(403);
    expect((noEntitlement.body as ErrorDto).error.code).toBe("FEATURE_NOT_ENTITLED");
    expect((noEntitlement.body as ErrorDto).error.message).toBe(
      FISCAL_FEATURE_NOT_ENTITLED_MESSAGE
    );
    const noPermission = await issue(booted, forbidden.actor.cookie, invoice.id).expect(403);
    expect((noPermission.body as ErrorDto).error.code).toBe("FORBIDDEN");
    expect(booted.fiscalSubmissionProducer.enqueued).toHaveLength(jobsBefore);
    expect(auditsFor(booted, "fiscal.document.issue_requested")).toHaveLength(auditsBefore);
  });
});
