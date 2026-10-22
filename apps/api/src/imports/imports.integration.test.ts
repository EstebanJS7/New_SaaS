import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedRoleWithKeys, type SeededRbacRole } from "../../test/support/rbac-fixture.js";
import { insertLiveStaffSession } from "../../test/support/seed-two-tenants.js";
import {
  IMPORT_ARTEFACT_CONTENT_TYPE_MESSAGE,
  IMPORT_ARTEFACT_ENTITY_MESSAGE,
  IMPORT_ARTEFACT_MAX_BYTES,
  IMPORT_ARTEFACT_MISSING_FILE_MESSAGE,
  IMPORT_ARTEFACT_MULTIPART_MESSAGE,
  IMPORT_ARTEFACT_SIZE_MESSAGE,
  IMPORT_ARTEFACT_SPREADSHEET_MESSAGE,
} from "./import-artefact.pipe.js";
import { IMPORT_JOB_TERMINAL_STATES, isTerminal } from "./imports.repository.js";
import { IMPORT_LIST_LIMIT_MAX } from "./imports.zod.js";
import type { ImportJobResponse } from "./imports.dto.js";

/**
 * IMP-001 HTTP boundary suite.
 *
 * Boots the REAL AppModule (so the real guard chain runs) over the in-memory
 * boundary fake, and drives the IMP-001 routes with a real multipart body. (The
 * fourth route — `POST /imports/:id/preview` from IMP-002 — has its own suite,
 * which replaces the queue producer with a recording double.)
 * What it proves, in the Story's words:
 *
 * - the upload refuses an oversized file and a non-CSV content type with DISTINCT
 *   stable messages, and refuses an `.xlsx`/`.xls` BY NAME while naming CSV as the
 *   accepted format ([[DEC-068]]);
 * - the storage key is opaque, is `put` under the generated key, and appears in NO
 *   response;
 * - `imports.run` guards the upload and `imports.read` guards both reads, with the
 *   service re-asserting so a denial reaches no storage call;
 * - both reads are tenant-scoped and a foreign import id is the byte-equivalent
 *   `404`;
 * - the list bound REFUSES an oversized page instead of truncating it ([[TD-026]]).
 */

interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string };
}

const CSV_BODY = "name,phone,document\nexample,0981,1234567\n";

describe("imports HTTP boundary", () => {
  let booted: BootedTestApp;
  let tenantAId: string;
  let runnerRole: SeededRbacRole;
  let runnerCookie: string;
  let readerCookie: string;
  let noPermissionCookie: string;
  let tenantBReaderCookie: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    const db = booted.db;

    const tenantA = db.prisma.tenant.create({ data: { slug: "imports-a", name: "Imports A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: "imports-b", name: "Imports B" } });
    tenantAId = tenantA.id;

    runnerRole = seedRoleWithKeys(db, "IMPORTS_RUNNER", "Imports Runner", [
      "imports.run",
      "imports.read",
    ]);
    const readerRole = seedRoleWithKeys(db, "IMPORTS_READER", "Imports Reader", ["imports.read"]);
    const noPermissionRole = seedRoleWithKeys(db, "IMPORTS_NONE", "Imports None", [
      "customers.read",
    ]);

    const runnerProfile = db.prisma.userProfile.create({
      data: { email: "imports-runner@test.test", displayName: "Runner", status: "active" },
    });
    const readerProfile = db.prisma.userProfile.create({
      data: { email: "imports-reader@test.test", displayName: "Reader", status: "active" },
    });
    const noPermissionProfile = db.prisma.userProfile.create({
      data: { email: "imports-none@test.test", displayName: "None", status: "active" },
    });
    const tenantBRunnerProfile = db.prisma.userProfile.create({
      data: { email: "imports-b@test.test", displayName: "Runner B", status: "active" },
    });

    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: runnerProfile.id,
        roleId: runnerRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: readerProfile.id,
        roleId: readerRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: noPermissionProfile.id,
        roleId: noPermissionRole.role.id,
        status: "ACTIVE",
      },
    });
    db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: tenantBRunnerProfile.id,
        roleId: runnerRole.role.id,
        status: "ACTIVE",
      },
    });

    runnerCookie = insertLiveStaffSession(db, runnerProfile.id).cookie;
    readerCookie = insertLiveStaffSession(db, readerProfile.id).cookie;
    noPermissionCookie = insertLiveStaffSession(db, noPermissionProfile.id).cookie;
    tenantBReaderCookie = insertLiveStaffSession(db, tenantBRunnerProfile.id).cookie;
  });

  afterAll(async () => {
    await booted.close();
  });

  /** Uploads one artefact as the runner and returns the created import id. */
  async function uploadCsv(entity = "CUSTOMER", body = CSV_BODY): Promise<string> {
    const response = await supertest(booted.app.getHttpServer())
      .post("/imports")
      .set("Cookie", runnerCookie)
      .field("entity", entity)
      .attach("file", Buffer.from(body, "utf8"), {
        filename: "customers.csv",
        contentType: "text/csv",
      })
      .expect(201);

    return (response.body as { importId: string }).importId;
  }

  describe("authentication", () => {
    it("requires authentication on every route", async () => {
      await supertest(booted.app.getHttpServer()).get("/imports").expect(401);
      await supertest(booted.app.getHttpServer()).get(`/imports/${tenantAId}`).expect(401);
      await supertest(booted.app.getHttpServer()).post("/imports").expect(401);
      // The IMP-002 preview trigger is a command, and an unauthenticated call
      // reaches neither the service nor the queue.
      await supertest(booted.app.getHttpServer()).post(`/imports/${tenantAId}/preview`).expect(401);
    });
  });

  describe("POST /imports", () => {
    it("accepts text/csv and returns ONLY the import id and its state", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "PATIENT")
        .attach("file", Buffer.from(CSV_BODY, "utf8"), {
          filename: "patients.csv",
          contentType: "text/csv",
        })
        .expect(201);

      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["importId", "state"]);
      expect(body.state).toBe("UPLOADED");

      // The storage key is opaque, stored, and NOWHERE in the response.
      const row = booted.db.tables.importJobs.get(body.importId as string);
      expect(row?.entity).toBe("PATIENT");
      expect(row?.tenantId).toBe(tenantAId);
      expect(row?.storageKey).toMatch(/^import_[A-Za-z0-9_-]{22}$/);
      expect(booted.db.storage.hasKey(row?.storageKey ?? "")).toBe(true);
      expect(JSON.stringify(body)).not.toContain("storage");
      expect(JSON.stringify(body)).not.toContain("import_");
    });

    it("accepts application/csv as the same format", async () => {
      await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "CUSTOMER")
        .attach("file", Buffer.from(CSV_BODY, "utf8"), {
          filename: "customers.csv",
          contentType: "application/csv",
        })
        .expect(201);
    });

    it("parses the entity field even when the FILE part arrives first", async () => {
      // The reason this pipe walks the parts instead of using `request.file()`:
      // the two fields have no required order.
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .attach("file", Buffer.from(CSV_BODY, "utf8"), {
          filename: "customers.csv",
          contentType: "text/csv",
        })
        .field("entity", "PATIENT")
        .expect(201);

      const row = booted.db.tables.importJobs.get((response.body as { importId: string }).importId);
      expect(row?.entity).toBe("PATIENT");
    });

    it("refuses an .xlsx upload NAMING csv as the accepted format", async () => {
      const storedBefore = booted.db.storage.size();
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "CUSTOMER")
        .attach("file", Buffer.from("not really a spreadsheet", "utf8"), {
          filename: "customers.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
        .expect(400);

      const body = response.body as ErrorEnvelope;
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.message).toBe(IMPORT_ARTEFACT_SPREADSHEET_MESSAGE);
      // The message NAMES the accepted format rather than failing generically.
      expect(body.error.message).toContain("CSV");
      expect(booted.db.storage.size()).toBe(storedBefore);
    });

    it("refuses a legacy .xls upload with the same by-name message", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "CUSTOMER")
        .attach("file", Buffer.from("legacy", "utf8"), {
          filename: "customers.xls",
          contentType: "application/vnd.ms-excel",
        })
        .expect(400);

      expect((response.body as ErrorEnvelope).error.message).toBe(
        IMPORT_ARTEFACT_SPREADSHEET_MESSAGE
      );
    });

    it("refuses a non-CSV content type with its own distinct message", async () => {
      const storedBefore = booted.db.storage.size();
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "CUSTOMER")
        .attach("file", Buffer.from("%PDF-1.4", "utf8"), {
          filename: "customers.pdf",
          contentType: "application/pdf",
        })
        .expect(400);

      const body = response.body as ErrorEnvelope;
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.message).toBe(IMPORT_ARTEFACT_CONTENT_TYPE_MESSAGE);
      expect(body.error.message).not.toBe(IMPORT_ARTEFACT_SPREADSHEET_MESSAGE);
      expect(booted.db.storage.size()).toBe(storedBefore);
    });

    it("refuses an oversized file with its own stable message and writes nothing", async () => {
      const storedBefore = booted.db.storage.size();
      const oversized = Buffer.alloc(IMPORT_ARTEFACT_MAX_BYTES + 1024, 0x61);

      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "CUSTOMER")
        .attach("file", oversized, { filename: "customers.csv", contentType: "text/csv" })
        .expect(413);

      const body = response.body as ErrorEnvelope;
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(body.error.message).toBe(IMPORT_ARTEFACT_SIZE_MESSAGE);
      expect(booted.db.storage.size()).toBe(storedBefore);
    });

    it("refuses a multipart body with no file part", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "CUSTOMER")
        .expect(400);

      expect((response.body as ErrorEnvelope).error.message).toBe(
        IMPORT_ARTEFACT_MISSING_FILE_MESSAGE
      );
    });

    it("refuses a missing or unknown entity field", async () => {
      const missing = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .attach("file", Buffer.from(CSV_BODY, "utf8"), {
          filename: "customers.csv",
          contentType: "text/csv",
        })
        .expect(400);
      expect((missing.body as ErrorEnvelope).error.message).toBe(IMPORT_ARTEFACT_ENTITY_MESSAGE);

      const unknown = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .field("entity", "INVOICE")
        .attach("file", Buffer.from(CSV_BODY, "utf8"), {
          filename: "customers.csv",
          contentType: "text/csv",
        })
        .expect(400);
      expect((unknown.body as ErrorEnvelope).error.message).toBe(IMPORT_ARTEFACT_ENTITY_MESSAGE);
    });

    it("refuses a non-multipart request with a stable message", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", runnerCookie)
        .send({ entity: "CUSTOMER" })
        .expect(400);

      expect((response.body as ErrorEnvelope).error.message).toBe(
        IMPORT_ARTEFACT_MULTIPART_MESSAGE
      );
    });

    it("refuses without imports.run, before any storage write", async () => {
      const storedBefore = booted.db.storage.size();
      const jobsBefore = booted.db.tables.importJobs.size;
      const response = await supertest(booted.app.getHttpServer())
        .post("/imports")
        .set("Cookie", readerCookie)
        .field("entity", "CUSTOMER")
        .attach("file", Buffer.from(CSV_BODY, "utf8"), {
          filename: "customers.csv",
          contentType: "text/csv",
        })
        .expect(403);

      // The guard refuses first (it never reaches the service), and the service
      // would refuse again — either way nothing is stored and no job exists.
      expect((response.body as ErrorEnvelope).error.code).toBe("FORBIDDEN");
      expect(booted.db.storage.size()).toBe(storedBefore);
      expect(booted.db.tables.importJobs.size).toBe(jobsBefore);
    });

    it("audits the upload against the requesting tenant", async () => {
      await uploadCsv("CUSTOMER");
      const audit = [...booted.db.tables.audits.values()].find(
        (row) => row.action === "import.uploaded"
      );
      expect(audit?.tenantId).toBe(tenantAId);
      expect(audit?.targetType).toBe("import_job");
      // The audit row never carries the storage key.
      expect(JSON.stringify(audit?.metadata)).not.toContain("import_");
    });
  });

  describe("GET /imports", () => {
    it("lists the caller tenant's imports, newest first, with no storage key", async () => {
      const first = await uploadCsv("CUSTOMER");
      const second = await uploadCsv("PATIENT");

      const response = await supertest(booted.app.getHttpServer())
        .get("/imports")
        .set("Cookie", runnerCookie)
        .expect(200);

      const rows = response.body as { id: string }[];
      // The two just uploaded are the newest, in upload order.
      expect(rows.slice(0, 2).map((row) => row.id)).toEqual([second, first]);
      expect(JSON.stringify(response.body)).not.toContain("import_");
      expect(JSON.stringify(response.body)).not.toContain("storageKey");
    });

    it("refuses a page larger than the documented ceiling instead of truncating it", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/imports?limit=${IMPORT_LIST_LIMIT_MAX + 1}`)
        .set("Cookie", runnerCookie)
        .expect(400);

      expect((response.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
    });

    it("refuses an unknown query key, an unparseable limit and an unknown entity", async () => {
      // `entity` IS a known key since IMP-004, so it can no longer stand in for an
      // unknown one — the example moved to a key nothing declares.
      await supertest(booted.app.getHttpServer())
        .get("/imports?tenantId=somewhere-else")
        .set("Cookie", runnerCookie)
        .expect(400);
      await supertest(booted.app.getHttpServer())
        .get("/imports?limit=many")
        .set("Cookie", runnerCookie)
        .expect(400);
      // A known key with an unknown value is refused too, rather than ignored: a
      // typo must not return the whole list under a filter the caller believes it
      // applied.
      await supertest(booted.app.getHttpServer())
        .get("/imports?entity=INVOICE")
        .set("Cookie", runnerCookie)
        .expect(400);
    });

    it("narrows the history to one entity when asked, and only to the caller's", async () => {
      const customers = await supertest(booted.app.getHttpServer())
        .get("/imports?entity=CUSTOMER")
        .set("Cookie", runnerCookie)
        .expect(200);
      const patients = await supertest(booted.app.getHttpServer())
        .get("/imports?entity=PATIENT")
        .set("Cookie", runnerCookie)
        .expect(200);

      const customerBodies = customers.body as ImportJobResponse[];
      const patientBodies = patients.body as ImportJobResponse[];

      expect(customerBodies.every((row) => row.entity === "CUSTOMER")).toBe(true);
      expect(patientBodies.every((row) => row.entity === "PATIENT")).toBe(true);
      // The filter NARROWS: it cannot widen the list past the caller's tenant, and
      // the two halves partition the unfiltered answer.
      const all = await supertest(booted.app.getHttpServer())
        .get("/imports")
        .set("Cookie", runnerCookie)
        .expect(200);
      expect((all.body as ImportJobResponse[]).length).toBe(
        customerBodies.length + patientBodies.length
      );
    });

    it("serves the reader role and refuses a caller without imports.read", async () => {
      await supertest(booted.app.getHttpServer())
        .get("/imports")
        .set("Cookie", readerCookie)
        .expect(200);

      const denied = await supertest(booted.app.getHttpServer())
        .get("/imports")
        .set("Cookie", noPermissionCookie)
        .expect(403);
      expect((denied.body as ErrorEnvelope).error.code).toBe("FORBIDDEN");
    });

    it("never shows another tenant's imports", async () => {
      await uploadCsv("CUSTOMER");

      const otherTenant = await supertest(booted.app.getHttpServer())
        .get("/imports")
        .set("Cookie", tenantBReaderCookie)
        .expect(200);

      expect(otherTenant.body as unknown[]).toEqual([]);
    });
  });

  describe("GET /imports/:id", () => {
    it("returns one import with its counters", async () => {
      const id = await uploadCsv("PATIENT");

      const response = await supertest(booted.app.getHttpServer())
        .get(`/imports/${id}`)
        .set("Cookie", runnerCookie)
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(body.id).toBe(id);
      expect(body.entity).toBe("PATIENT");
      expect(body.state).toBe("UPLOADED");
      expect(body.createdCount).toBe(0);
      expect(body.failedCount).toBe(0);
      expect(body.suspectedDuplicateCount).toBe(0);
      expect(typeof body.artefactExpiresAt).toBe("string");
      expect(JSON.stringify(body)).not.toContain("import_");
    });

    it("answers a foreign import id with the byte-equivalent 404", async () => {
      const foreignId = await uploadCsv("CUSTOMER");

      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/imports/${foreignId}`)
        .set("Cookie", tenantBReaderCookie)
        .expect(404);
      const unknown = await supertest(booted.app.getHttpServer())
        .get("/imports/44444444-4444-4444-8444-444444444444")
        .set("Cookie", tenantBReaderCookie)
        .expect(404);

      // Byte-equivalent apart from the per-request correlation id: a foreign row
      // and a row that never existed must be indistinguishable.
      const normalize = (body: ErrorEnvelope): ErrorEnvelope => ({
        error: { ...body.error, requestId: "normalized" },
      });
      expect(normalize(foreign.body as ErrorEnvelope)).toEqual(
        normalize(unknown.body as ErrorEnvelope)
      );
    });

    it("refuses a non-UUID id as a 400", async () => {
      await supertest(booted.app.getHttpServer())
        .get("/imports/not-a-uuid")
        .set("Cookie", runnerCookie)
        .expect(400);
    });

    it("refuses without imports.read", async () => {
      const id = await uploadCsv("CUSTOMER");
      await supertest(booted.app.getHttpServer())
        .get(`/imports/${id}`)
        .set("Cookie", noPermissionCookie)
        .expect(403);
    });
  });

  describe("the surface has no state route and no artefact download", () => {
    it("refuses PATCH, PUT and DELETE on the imports surface", async () => {
      const id = await uploadCsv("CUSTOMER");
      await supertest(booted.app.getHttpServer())
        .patch(`/imports/${id}`)
        .set("Cookie", runnerCookie)
        .send({ state: "COMMITTED" })
        .expect(404);
      await supertest(booted.app.getHttpServer())
        .put(`/imports/${id}`)
        .set("Cookie", runnerCookie)
        .send({ state: "COMMITTED" })
        .expect(404);
      await supertest(booted.app.getHttpServer())
        .delete(`/imports/${id}`)
        .set("Cookie", runnerCookie)
        .expect(404);

      // The state is untouched: the only way to move it is a command on the
      // service, and there is no route for one on this surface.
      expect(booted.db.tables.importJobs.get(id)?.state).toBe("UPLOADED");
    });

    it("has no route that serves the artefact back", async () => {
      const id = await uploadCsv("CUSTOMER");
      const row = booted.db.tables.importJobs.get(id);
      const storageKey = row?.storageKey ?? "";

      for (const path of [
        "/imports/artefacts",
        `/imports/${id}/artefact`,
        `/imports/${id}/file`,
        `/imports/${id}/download`,
        `/imports/artefacts/${storageKey}`,
      ]) {
        await supertest(booted.app.getHttpServer())
          .get(path)
          .set("Cookie", runnerCookie)
          // A 404 (no route) or a 400 (the `:id` param is not a UUID) — never a
          // 200, which is the whole point: DEC-072 says this surface never
          // downloads the artefact back.
          .then((response) => expect([400, 404]).toContain(response.status));
      }
    });
  });

  describe("the terminal set is closed", () => {
    it("is exactly COMMITTED, FAILED and EXPIRED", () => {
      expect([...IMPORT_JOB_TERMINAL_STATES]).toEqual(["COMMITTED", "FAILED", "EXPIRED"]);
      for (const state of ["UPLOADED", "PREVIEWING", "PREVIEWED", "COMMITTING"] as const) {
        expect(isTerminal(state)).toBe(false);
      }
    });
  });
});
