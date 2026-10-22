import { beforeEach, describe, expect, it } from "vitest";
import type { InMemoryStorageDriver, StoragePort } from "@newsaas/storage";
import type { ImportCommitJob, ImportPreviewJob, ImportPreviewProducer } from "@newsaas/imports";
import {
  createIsolationDatabase,
  type ImportJobRow,
  type IsolationDatabase,
} from "../../test/support/in-memory-database.js";
import { AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { PermissionResolver } from "../rbac/permission-resolver.service.js";
import type { ParsedImportArtefact } from "./import-artefact.pipe.js";
import { toImportRowOutcomeResponse, type ImportRowOutcomeResponse } from "./imports.dto.js";
import {
  IMPORT_COMMITTED_ACTION,
  IMPORT_EXPIRED_ACTION,
  IMPORT_FAILED_ACTION,
  IMPORT_PREVIEWED_ACTION,
  IMPORT_PREVIEWING_ACTION,
  IMPORT_PERMISSION_DENIED_MESSAGE,
  IMPORT_SWEEP_BATCH_SIZE,
  IMPORT_UPLOADED_ACTION,
  ImportsService,
} from "./imports.service.js";
import {
  IMPORT_ARTEFACT_TTL_MS,
  IMPORT_JOB_STATES,
  IMPORT_JOB_TERMINAL_STATES,
  IMPORT_MEMBERSHIP_NOT_RESOLVED_MESSAGE,
  IMPORT_NOT_FOUND_MESSAGE,
  IMPORT_TRANSITION_CONFLICT_MESSAGE,
  ImportRepository,
  isTerminal,
  type ImportJobStateValue,
} from "./imports.repository.js";

/**
 * IMP-001 service suite: the aggregate, the artefact and the closed state machine.
 *
 * Driven against the in-memory boundary fake (the landed convention for API
 * suites) with the REAL `AuditWriter` over it, so "a transition appends an audit
 * row" is asserted against rows rather than against a mock's call count.
 *
 * What this file exists to prove, in the order the Story states it:
 * - every legal transition succeeds and every illegal one is the SAME stable
 *   `409`, including a replay and a transition from a terminal state;
 * - the upload writes the artefact under an opaque key, never signs it, and never
 *   puts that key in a response;
 * - `imports.run` is asserted BEFORE any storage call;
 * - the artefact deletion is idempotent, and the TTL sweep expires (and deletes)
 *   an import that never finished;
 * - the row-outcome projection carries no personal data, asserted over its exact
 *   key set and over a PERSISTED row.
 */

/** An id that exists in no tenant — the "never existed" half of the 404 proof. */
const UNKNOWN_IMPORT_ID = "44444444-4444-4444-8444-444444444444";

/** The storage port with recording seams, delegating to the in-memory driver. */
interface RecordingStorage {
  readonly port: StoragePort;
  readonly puts: { key: string; contentType: string; byteSize: number }[];
  readonly deletes: string[];
  readonly signs: string[];
}

function createRecordingStorage(inner: InMemoryStorageDriver): RecordingStorage {
  const puts: RecordingStorage["puts"] = [];
  const deletes: string[] = [];
  const signs: string[] = [];
  const port: StoragePort = {
    put: (args) => {
      puts.push({ key: args.key, contentType: args.contentType, byteSize: args.body.length });
      return inner.put(args);
    },
    delete: (args) => {
      deletes.push(args.key);
      return inner.delete(args);
    },
    signedUrl: (args) => {
      signs.push(args.key);
      return inner.signedUrl(args);
    },
    get: (args) => inner.get(args),
  };
  return { port, puts, deletes, signs };
}

describe("ImportsService", () => {
  let db: IsolationDatabase;
  let requestContext: RequestContextService;
  let permissionResolver: PermissionResolver;
  let service: ImportsService;
  let storage: RecordingStorage;
  let previewProducer: ImportPreviewProducer & {
    readonly enqueued: ImportPreviewJob[];
    readonly enqueuedCommits: ImportCommitJob[];
  };
  let granted: Set<string>;
  let membershipId: string;
  let userProfileId: string;
  let tenantIds: { a: string; b: string };

  function artefact(overrides: Partial<ParsedImportArtefact> = {}): ParsedImportArtefact {
    const buffer = Buffer.from("name,phone\nAna,0981\n", "utf8");
    return {
      buffer,
      filename: "customers.csv",
      contentType: "text/csv",
      byteSize: buffer.length,
      entity: "CUSTOMER",
      ...overrides,
    };
  }

  /** Runs one unit of work inside a request context for `tenantId`. */
  function withContext<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return requestContext.run("req-imports", async () => {
      requestContext.setUserProfileId(userProfileId);
      requestContext.setTenantMembership({
        tenantId,
        membershipId,
        roleId: "role-owner",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  /** Seeds one job directly at a given state, bypassing the machine on purpose. */
  function seedJob(state: ImportJobStateValue, tenantId = tenantIds.a): ImportJobRow {
    return db.prisma.importJob.create({
      data: {
        tenantId,
        entity: "CUSTOMER",
        state,
        storageKey: `import_seeded_${state}`,
        contentType: "text/csv",
        byteSize: 12,
        createdByMembershipId: membershipId,
        artefactExpiresAt: new Date(Date.now() + IMPORT_ARTEFACT_TTL_MS),
      },
    });
  }

  function auditActions(): string[] {
    return [...db.tables.audits.values()].map((row) => row.action);
  }

  beforeEach(() => {
    db = createIsolationDatabase();
    requestContext = new RequestContextService();
    storage = createRecordingStorage(db.storage);
    granted = new Set(["imports.read", "imports.run"]);

    permissionResolver = {
      resolveForActiveRequest: () => Promise.resolve(new Set(granted)),
    } as unknown as PermissionResolver;

    const tenantA = db.prisma.tenant.create({ data: { slug: "imports-a", name: "Imports A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: "imports-b", name: "Imports B" } });
    expect(tenantA.id).not.toBe(tenantB.id);

    const role = db.prisma.role.create({ data: { code: "IMPORTS_OWNER", name: "Imports Owner" } });
    const profile = db.prisma.userProfile.create({
      data: { email: "imports@test.test", displayName: "Imports", status: "active" },
    });
    const membership = db.prisma.tenantMembership.create({
      data: { tenantId: tenantA.id, userProfileId: profile.id, roleId: role.id, status: "ACTIVE" },
    });
    membershipId = membership.id;
    userProfileId = profile.id;
    tenantIds = { a: tenantA.id, b: tenantB.id };

    const enqueued: ImportPreviewJob[] = [];
    const enqueuedCommits: ImportCommitJob[] = [];
    previewProducer = {
      enqueued,
      enqueuedCommits,
      enqueue: (job: ImportPreviewJob) => {
        enqueued.push(job);
        return Promise.resolve();
      },
      // The same port produces BOTH phases ([[IMP-003]]): one queue, two job names.
      enqueueCommit: (job: ImportCommitJob) => {
        enqueuedCommits.push(job);
        return Promise.resolve();
      },
    };

    service = new ImportsService(
      db.prisma as unknown as ConstructorParameters<typeof ImportsService>[0],
      new ImportRepository(
        db.prisma as unknown as ConstructorParameters<typeof ImportRepository>[0],
        requestContext
      ),
      requestContext,
      permissionResolver,
      new AuditWriter(
        db.prisma as unknown as ConstructorParameters<typeof AuditWriter>[0],
        requestContext
      ),
      storage.port,
      previewProducer
    );
  });

  describe("upload", () => {
    it("stores the artefact under an opaque key and creates the job in UPLOADED", async () => {
      const response = await withContext(tenantIds.a, () => service.upload(artefact()));

      expect(response.state).toBe("UPLOADED");
      expect(Object.keys(response).sort()).toEqual(["importId", "state"]);

      const row = db.tables.importJobs.get(response.importId);
      expect(row).toBeDefined();

      // The key is opaque, generated server-side, and NOT derivable from anything
      // the caller controls.
      expect(row?.storageKey.startsWith("import_")).toBe(true);
      expect(row?.storageKey).not.toContain(tenantIds.a);
      expect(row?.storageKey).not.toContain("customers.csv");
      expect(row?.storageKey).not.toContain("CUSTOMER");
      // A random 128-bit token, base64url encoded, after the prefix.
      expect(row?.storageKey).toMatch(/^import_[A-Za-z0-9_-]{22}$/);

      // The bytes are IN storage under exactly that key, with the declared type.
      expect(storage.puts).toEqual([
        { key: row?.storageKey, contentType: "text/csv", byteSize: artefact().byteSize },
      ]);
      expect(db.storage.hasKey(row?.storageKey ?? "")).toBe(true);

      // Nothing ever signed a URL for the artefact: the key has no browser path.
      expect(storage.signs).toEqual([]);

      // 72 hours, generous on purpose, stamped at upload.
      const ttlMs = (row?.artefactExpiresAt.getTime() ?? 0) - Date.now();
      expect(ttlMs).toBeGreaterThan(IMPORT_ARTEFACT_TTL_MS - 60_000);
      expect(ttlMs).toBeLessThanOrEqual(IMPORT_ARTEFACT_TTL_MS);

      expect(auditActions()).toEqual([IMPORT_UPLOADED_ACTION]);
    });

    it("records the uploader from the request context, never from the caller", async () => {
      const response = await withContext(tenantIds.a, () => service.upload(artefact()));
      const row = db.tables.importJobs.get(response.importId);
      expect(row?.createdByMembershipId).toBe(membershipId);
      expect(row?.tenantId).toBe(tenantIds.a);
    });

    it("refuses without imports.run BEFORE any storage call", async () => {
      granted = new Set(["imports.read"]);

      await expect(
        withContext(tenantIds.a, () => service.upload(artefact()))
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: IMPORT_PERMISSION_DENIED_MESSAGE,
      });

      // The point of the ordering: a denial reaches no `put`, so nothing can be
      // written into storage by a caller who was never allowed to run an import.
      expect(storage.puts).toEqual([]);
      expect(db.tables.importJobs.size).toBe(0);
    });

    it("refuses when the caller has no ACTIVE membership in the tenant", async () => {
      const otherProfile = db.prisma.userProfile.create({
        data: { email: "outsider@test.test", displayName: "Outsider", status: "active" },
      });

      await expect(
        requestContext.run("req-imports", async () => {
          requestContext.setUserProfileId(otherProfile.id);
          requestContext.setTenantMembership({
            tenantId: tenantIds.a,
            membershipId: "not-a-membership",
            roleId: "role-owner",
            roleCode: "OWNER",
          });
          return service.upload(artefact());
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: IMPORT_MEMBERSHIP_NOT_RESOLVED_MESSAGE,
      });

      expect(storage.puts).toEqual([]);
    });
  });

  describe("the closed state machine", () => {
    /** The command table: every command, the states it accepts, its audit action. */
    const COMMANDS = [
      {
        name: "startPreview",
        action: IMPORT_PREVIEWING_ACTION,
        legalFrom: ["UPLOADED"],
        run: (id: string) => service.startPreview(id),
      },
      {
        name: "completePreview",
        action: IMPORT_PREVIEWED_ACTION,
        legalFrom: ["PREVIEWING"],
        run: (id: string) => service.completePreview(id),
      },
      {
        name: "startCommit",
        action: "import.committing",
        legalFrom: ["PREVIEWED"],
        run: (id: string) => service.startCommit(id),
      },
      {
        name: "completeCommit",
        action: IMPORT_COMMITTED_ACTION,
        legalFrom: ["COMMITTING"],
        run: (id: string) =>
          service.completeCommit(id, {
            createdCount: 3,
            failedCount: 1,
            suspectedDuplicateCount: 1,
          }),
      },
      {
        name: "fail",
        action: IMPORT_FAILED_ACTION,
        legalFrom: ["PREVIEWING", "COMMITTING"],
        run: (id: string) => service.fail(id, "The file has no header row."),
      },
      {
        name: "expire",
        action: IMPORT_EXPIRED_ACTION,
        legalFrom: ["UPLOADED", "PREVIEWING", "PREVIEWED", "COMMITTING"],
        run: (id: string) => service.expire(id),
      },
    ] as const;

    const MATRIX = COMMANDS.flatMap((command) =>
      IMPORT_JOB_STATES.map((from) => ({
        command,
        from,
        legal: (command.legalFrom as readonly string[]).includes(from),
      }))
    );

    for (const { command, from, legal } of MATRIX) {
      const expected = legal ? "succeeds" : "the stable 409";
      it(`${command.name} from ${from} ${expected}`, async () => {
        const job = seedJob(from);

        if (legal) {
          const response = await withContext(tenantIds.a, () => command.run(job.id));
          expect(response.state).not.toBe(from);
          expect(auditActions()).toContain(command.action);
          return;
        }

        await expect(withContext(tenantIds.a, () => command.run(job.id))).rejects.toMatchObject({
          code: "CONFLICT",
          message: IMPORT_TRANSITION_CONFLICT_MESSAGE,
        });

        // A refused transition changes NOTHING and audits nothing.
        expect(db.tables.importJobs.get(job.id)?.state).toBe(from);
        expect(auditActions()).toEqual([]);
      });
    }

    it("walks the whole happy path and audits every transition it passes", async () => {
      const uploaded = await withContext(tenantIds.a, () => service.upload(artefact()));
      const id = uploaded.importId;

      await withContext(tenantIds.a, () => service.startPreview(id));
      await withContext(tenantIds.a, () => service.completePreview(id));
      await withContext(tenantIds.a, () => service.startCommit(id));
      const committed = await withContext(tenantIds.a, () =>
        service.completeCommit(id, {
          createdCount: 120,
          failedCount: 3,
          suspectedDuplicateCount: 2,
        })
      );

      expect(committed.state).toBe("COMMITTED");
      expect(committed.createdCount).toBe(120);
      expect(committed.failedCount).toBe(3);
      expect(committed.suspectedDuplicateCount).toBe(2);

      const row = db.tables.importJobs.get(id);
      expect(row?.committedAt).toBeInstanceOf(Date);
      expect(row?.previewedAt).toBeInstanceOf(Date);

      expect(auditActions()).toEqual([
        IMPORT_UPLOADED_ACTION,
        IMPORT_PREVIEWING_ACTION,
        IMPORT_PREVIEWED_ACTION,
        "import.committing",
        IMPORT_COMMITTED_ACTION,
      ]);
    });

    it("refuses a REPLAY of a transition that already happened", async () => {
      const job = seedJob("UPLOADED");

      await withContext(tenantIds.a, () => service.startPreview(job.id));

      await expect(
        withContext(tenantIds.a, () => service.startPreview(job.id))
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: IMPORT_TRANSITION_CONFLICT_MESSAGE,
      });
      expect(db.tables.importJobs.get(job.id)?.state).toBe("PREVIEWING");
    });

    it("has no exit from any terminal state, and says so with the same 409", async () => {
      for (const terminal of IMPORT_JOB_TERMINAL_STATES) {
        expect(isTerminal(terminal)).toBe(true);
        const job = seedJob(terminal);
        for (const command of COMMANDS) {
          await expect(withContext(tenantIds.a, () => command.run(job.id))).rejects.toMatchObject({
            code: "CONFLICT",
            message: IMPORT_TRANSITION_CONFLICT_MESSAGE,
          });
        }
        expect(db.tables.importJobs.get(job.id)?.state).toBe(terminal);
      }
    });

    it("answers a foreign or unknown import id with the shared 404, not the 409", async () => {
      const foreign = seedJob("UPLOADED", tenantIds.b);

      await expect(
        withContext(tenantIds.a, () => service.startPreview(foreign.id))
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: IMPORT_NOT_FOUND_MESSAGE });

      await expect(
        withContext(tenantIds.a, () => service.startPreview(UNKNOWN_IMPORT_ID))
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: IMPORT_NOT_FOUND_MESSAGE });

      // The foreign import is untouched.
      expect(db.tables.importJobs.get(foreign.id)?.state).toBe("UPLOADED");
    });
  });

  describe("the artefact", () => {
    it("is deleted when the import reaches a terminal state", async () => {
      const uploaded = await withContext(tenantIds.a, () => service.upload(artefact()));
      const id = uploaded.importId;
      const key = db.tables.importJobs.get(id)?.storageKey ?? "";
      expect(db.storage.hasKey(key)).toBe(true);

      await withContext(tenantIds.a, () => service.startPreview(id));
      await withContext(tenantIds.a, () => service.completePreview(id));
      await withContext(tenantIds.a, () => service.startCommit(id));
      await withContext(tenantIds.a, () =>
        service.completeCommit(id, { createdCount: 1, failedCount: 0, suspectedDuplicateCount: 0 })
      );

      expect(db.storage.hasKey(key)).toBe(false);
      expect(db.tables.importJobs.get(id)?.artefactDeletedAt).toBeInstanceOf(Date);
    });

    it("is deleted when the import FAILS", async () => {
      const job = seedJob("PREVIEWING");
      await db.storage.put({
        key: job.storageKey,
        body: Buffer.from("a"),
        contentType: "text/csv",
      });

      await withContext(tenantIds.a, () => service.fail(job.id, "The file has no header row."));

      expect(db.storage.hasKey(job.storageKey)).toBe(false);
      expect(db.tables.importJobs.get(job.id)?.failureReason).toBe("The file has no header row.");
    });

    it("deletes idempotently: the second call does nothing and says so", async () => {
      const job = seedJob("PREVIEWING");
      await db.storage.put({
        key: job.storageKey,
        body: Buffer.from("a"),
        contentType: "text/csv",
      });

      const first = await withContext(tenantIds.a, () => service.deleteArtefact(job.id));
      const deletesAfterFirst = storage.deletes.length;
      const second = await withContext(tenantIds.a, () => service.deleteArtefact(job.id));

      expect(first).toEqual({ deleted: true });
      expect(second).toEqual({ deleted: false });
      // The object was asked for exactly once: a stamp that already exists is not
      // a second delete.
      expect(storage.deletes).toHaveLength(deletesAfterFirst);
      expect(db.tables.importJobs.get(job.id)?.artefactDeletedAt).toBeInstanceOf(Date);
    });

    it("sweeps an import that never reached a terminal state: expires it, audits it, deletes it", async () => {
      const stale = db.prisma.importJob.create({
        data: {
          tenantId: tenantIds.a,
          entity: "PATIENT",
          state: "PREVIEWING",
          storageKey: "import_stale",
          contentType: "text/csv",
          byteSize: 9,
          createdByMembershipId: membershipId,
          // One hour past its deadline.
          artefactExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });
      await db.storage.put({
        key: stale.storageKey,
        body: Buffer.from("a"),
        contentType: "text/csv",
      });

      const result = await withContext(tenantIds.a, () =>
        service.sweepOverdueArtefacts(new Date())
      );

      expect(result).toEqual({ expired: 1, deleted: 1, failed: 0 });
      expect(db.tables.importJobs.get(stale.id)?.state).toBe("EXPIRED");
      expect(db.storage.hasKey(stale.storageKey)).toBe(false);
      expect(auditActions()).toEqual([IMPORT_EXPIRED_ACTION]);
    });

    it("leaves an import whose deadline has not passed alone", async () => {
      const fresh = seedJob("UPLOADED");
      await db.storage.put({
        key: fresh.storageKey,
        body: Buffer.from("a"),
        contentType: "text/csv",
      });

      const result = await withContext(tenantIds.a, () =>
        service.sweepOverdueArtefacts(new Date())
      );

      expect(result).toEqual({ expired: 0, deleted: 0, failed: 0 });
      expect(db.tables.importJobs.get(fresh.id)?.state).toBe("UPLOADED");
      expect(db.storage.hasKey(fresh.storageKey)).toBe(true);
    });

    it("retries the deletion of a finished import whose object outlived it", async () => {
      // A COMMITTED job that was never stamped: the sweep's second purpose.
      const committed = db.prisma.importJob.create({
        data: {
          tenantId: tenantIds.a,
          entity: "CUSTOMER",
          state: "COMMITTED",
          storageKey: "import_committed_orphan",
          contentType: "text/csv",
          byteSize: 4,
          createdByMembershipId: membershipId,
          artefactExpiresAt: new Date(Date.now() - 1000),
        },
      });
      await db.storage.put({
        key: committed.storageKey,
        body: Buffer.from("a"),
        contentType: "text/csv",
      });

      const result = await withContext(tenantIds.a, () =>
        service.sweepOverdueArtefacts(new Date())
      );

      // Nothing to expire — it is already terminal — but the object still goes.
      expect(result).toEqual({ expired: 0, deleted: 1, failed: 0 });
      expect(db.tables.importJobs.get(committed.id)?.state).toBe("COMMITTED");
      expect(db.storage.hasKey(committed.storageKey)).toBe(false);
    });

    it("bounds one sweep pass instead of running for ever", () => {
      // The batch ceiling is a documented constant, not a number in a loop.
      expect(IMPORT_SWEEP_BATCH_SIZE).toBeGreaterThan(0);
    });
  });

  describe("the row-outcome projection carries no personal data", () => {
    /**
     * COMPILE-TIME PIN: this is the EXACT key set of the projection. The type
     * assertion fails to compile the moment a field is added or removed, which is
     * what makes "no personal data" a structural promise rather than a review
     * habit.
     */
    it("pins the projection's key set exactly (compile-time + runtime)", () => {
      type Equal<A, B> =
        (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
      type Assert<T extends true> = T;

      const pinned = [
        "importId",
        "message",
        "reasonCode",
        "rowNumber",
        "status",
        "suspectedDuplicate",
      ] as const;

      const keySetPinned: Assert<Equal<keyof ImportRowOutcomeResponse, (typeof pinned)[number]>> =
        true;
      expect(keySetPinned).toBe(true);

      const job = seedJob("COMMITTING");
      const persisted = db.prisma.importRowOutcome.create({
        data: {
          tenantId: tenantIds.a,
          importId: job.id,
          rowNumber: 7,
          status: "FAILED",
          reasonCode: "DUPLICATE_DOCUMENT",
          // The message names the CONDITION. It never echoes the value.
          message: "The document number already exists for another customer.",
          suspectedDuplicate: true,
        },
      });

      const projection = toImportRowOutcomeResponse(persisted);

      expect(Object.keys(projection).sort()).toEqual([...pinned]);

      // A runtime scan over the PERSISTED row and over the projection: none of
      // these personal-data values may appear anywhere in either.
      const forbidden = [
        "Ana Benítez", // a customer name
        "0981-123-456", // a phone
        "ana@example.test", // an e-mail
        "4123456", // a document number
      ];
      const haystack = JSON.stringify({ persisted, projection });
      for (const value of forbidden) {
        expect(haystack).not.toContain(value);
      }

      // And the schema-level promise: no field of the row can even hold one.
      const columns = Object.keys(persisted);
      for (const forbiddenColumn of [
        "name",
        "firstName",
        "lastName",
        "phone",
        "email",
        "documentNumber",
        "document",
        "species",
        "birthDate",
        "customerId",
        "patientId",
      ]) {
        expect(columns).not.toContain(forbiddenColumn);
      }
    });
  });

  describe("reads", () => {
    it("lists the caller tenant's imports newest first and never another tenant's", async () => {
      const mineOld = seedJob("UPLOADED", tenantIds.a);
      const mineNew = seedJob("FAILED", tenantIds.a);
      const theirs = seedJob("UPLOADED", tenantIds.b);
      // The fake assigns `createdAt` at insert; make the order unambiguous.
      const older = db.tables.importJobs.get(mineOld.id);
      const newer = db.tables.importJobs.get(mineNew.id);
      if (older && newer) {
        older.createdAt = new Date("2026-10-19T10:00:00.000Z");
        newer.createdAt = new Date("2026-10-19T11:00:00.000Z");
      }

      const listed = await withContext(tenantIds.a, () => service.list(50));

      expect(listed.map((row) => row.id)).toEqual([mineNew.id, mineOld.id]);
      expect(listed.map((row) => row.id)).not.toContain(theirs.id);
    });

    it("returns one import with its counters, and no storage key", async () => {
      const job = seedJob("UPLOADED");
      const response = await withContext(tenantIds.a, () => service.getById(job.id));

      expect(response.id).toBe(job.id);
      expect(response.createdCount).toBe(0);
      expect(response.failedCount).toBe(0);
      expect(response.suspectedDuplicateCount).toBe(0);
      expect(JSON.stringify(response)).not.toContain("import_seeded");
      expect(JSON.stringify(response)).not.toContain("storageKey");
    });

    it("answers a foreign import id with the byte-equivalent 404", async () => {
      const foreign = seedJob("UPLOADED", tenantIds.b);
      await expect(
        withContext(tenantIds.a, () => service.getById(foreign.id))
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: IMPORT_NOT_FOUND_MESSAGE });
    });

    it("refuses the reads without imports.read", async () => {
      granted = new Set(["imports.run"]);
      const job = seedJob("UPLOADED");

      await expect(withContext(tenantIds.a, () => service.list(50))).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: IMPORT_PERMISSION_DENIED_MESSAGE,
      });
      await expect(withContext(tenantIds.a, () => service.getById(job.id))).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: IMPORT_PERMISSION_DENIED_MESSAGE,
      });
    });
  });

  describe("the preview trigger (IMP-002)", () => {
    it("enqueues one job for an UPLOADED import and answers the phase it was accepted into", async () => {
      const job = seedJob("UPLOADED");

      const response = await withContext(tenantIds.a, () => service.preview(job.id));

      expect(response).toEqual({ importId: job.id, state: "PREVIEWING" });
      expect(previewProducer.enqueued).toEqual([{ importJobId: job.id }]);
      // The trigger does NOT transition: the worker's claim owns
      // `UPLOADED -> PREVIEWING`, and moving the row here would make that claim —
      // which pins UPLOADED — skip every preview.
      expect(db.tables.importJobs.get(job.id)?.state).toBe("UPLOADED");
      expect(auditActions()).toEqual([]);
    });

    it("refuses every state but UPLOADED with the aggregate's stable 409, before any enqueue", async () => {
      for (const state of [
        "PREVIEWING",
        "PREVIEWED",
        "COMMITTING",
        "COMMITTED",
        "EXPIRED",
      ] as const) {
        const job = seedJob(state);

        await expect(withContext(tenantIds.a, () => service.preview(job.id))).rejects.toMatchObject(
          {
            code: "CONFLICT",
            message: IMPORT_TRANSITION_CONFLICT_MESSAGE,
          }
        );
        expect(db.tables.importJobs.get(job.id)?.state).toBe(state);
      }

      // A FAILED import is refused the same way — no exit from a terminal state.
      const failed = seedJob("FAILED");
      await expect(
        withContext(tenantIds.a, () => service.preview(failed.id))
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });

      expect(previewProducer.enqueued).toEqual([]);
    });

    it("answers a foreign import id with the shared 404 and enqueues nothing", async () => {
      const foreign = seedJob("UPLOADED", tenantIds.b);

      await expect(
        withContext(tenantIds.a, () => service.preview(foreign.id))
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: IMPORT_NOT_FOUND_MESSAGE });
      expect(previewProducer.enqueued).toEqual([]);
    });

    it("refuses without imports.run, before the read and before any queue call", async () => {
      granted = new Set(["imports.read"]);
      const job = seedJob("UPLOADED");

      await expect(withContext(tenantIds.a, () => service.preview(job.id))).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: IMPORT_PERMISSION_DENIED_MESSAGE,
      });
      expect(previewProducer.enqueued).toEqual([]);
    });
  });

  describe("state vocabulary", () => {
    it("keeps the terminal set a subset of the lifecycle and disjoint from the rest", () => {
      for (const state of IMPORT_JOB_TERMINAL_STATES) {
        expect(IMPORT_JOB_STATES).toContain(state);
        expect(isTerminal(state)).toBe(true);
      }
      for (const state of IMPORT_JOB_STATES) {
        if ((IMPORT_JOB_TERMINAL_STATES as readonly string[]).includes(state)) continue;
        expect(isTerminal(state)).toBe(false);
      }
    });
  });
});
