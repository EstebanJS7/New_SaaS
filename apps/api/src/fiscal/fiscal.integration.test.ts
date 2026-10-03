import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { expectCrossTenant404 } from "../../test/support/expect-cross-tenant-404.js";
import type { AuditLogRow, TenantRow } from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import { FISCAL_PERMISSIONS } from "./fiscal.permissions.js";
import { FISCAL_DOCUMENT_NOT_FOUND_MESSAGE } from "./fiscal.repository.js";
import {
  FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE,
  FISCAL_FEATURE_NOT_ENTITLED_MESSAGE,
  FISCAL_INVOICE_NOT_CONFIRMED_MESSAGE,
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
