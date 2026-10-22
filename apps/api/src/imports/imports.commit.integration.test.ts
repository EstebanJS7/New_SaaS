import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { PrismaModule, PrismaService } from "@newsaas/database";
import {
  IMPORT_PREVIEW_PRODUCER,
  type ImportCommitJob,
  type ImportPreviewJob,
  type ImportPreviewProducer,
} from "@newsaas/imports";
import { StorageModule, STORAGE_PORT } from "@newsaas/storage";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "../auth/auth.config.js";
import { AuthModule } from "../auth/auth.module.js";
import { CommonModule } from "../common/common.module.js";
import { createApiLogger } from "../common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../common/http/fastify-adapter.factory.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import {
  createIsolationDatabase,
  type IsolationDatabase,
} from "../../test/support/in-memory-database.js";
import { seedRoleWithKeys } from "../../test/support/rbac-fixture.js";
import { insertLiveStaffSession } from "../../test/support/seed-two-tenants.js";
import { ImportsModule } from "./imports.module.js";
import {
  IMPORT_NOT_FOUND_MESSAGE,
  IMPORT_TRANSITION_CONFLICT_MESSAGE,
} from "./imports.repository.js";
import {
  IMPORT_SUMMARY_LIMIT_DEFAULT,
  IMPORT_SUMMARY_LIMIT_MAX,
  IMPORT_SUMMARY_QUERY_INVALID_MESSAGE,
} from "./imports.zod.js";

/**
 * IMP-003 HTTP boundary suite for the commit trigger and the result summary.
 *
 * Composed the way `imports.preview.integration.test.ts` composes its graph — the
 * producer token replaced with a RECORDING double, and the same guard chain in the
 * same order (`AuthModule` → `TenancyModule` → `RbacModule`) plus `CommonModule` and
 * `ImportsModule` — so both routes run through the real guards, the real service and
 * the real repository over the in-memory boundary.
 *
 * What it proves, in the Story's words:
 *
 * - `POST /imports/:id/commit` enqueues one COMMIT job for a `PREVIEWED` import,
 *   answers `202`, and moves nothing (the worker's claim owns the transition);
 * - every other state is refused with the aggregate's existing stable `409`, with
 *   nothing enqueued;
 * - a foreign or unknown id is the byte-equivalent `404`, and a `PATIENT` file is
 *   ACCEPTED since [[IMP-004]] (the refusal that used to be here is gone, and the test
 *   that asserted it now asserts the queue call);
 * - `GET /imports/:id/summary` serves the totals and a bounded page of the STORED
 *   outcomes (so it is readable after a reload), refuses an oversized page rather
 *   than truncating it, `404`s a foreign id byte-equivalently, and needs
 *   `imports.read` and not `imports.run`.
 */

interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string };
}

interface SummaryBody {
  importId: string;
  state: string;
  totals: {
    createdCount: number;
    failedCount: number;
    suspectedDuplicateCount: number;
  };
  page: { limit: number; offset: number };
  rows: {
    importId: string;
    rowNumber: number;
    status: "CREATE" | "FAILED";
    reasonCode: string | null;
    message: string | null;
    suspectedDuplicate: boolean;
  }[];
}

interface RecordingProducer extends ImportPreviewProducer {
  readonly enqueued: ImportPreviewJob[];
  readonly enqueuedCommits: ImportCommitJob[];
  scriptFailure(failing: boolean): void;
}

interface CommitFixture {
  readonly app: NestFastifyApplication;
  readonly db: IsolationDatabase;
  readonly producer: RecordingProducer;
  close(): Promise<void>;
}

async function bootCommitHarness(): Promise<CommitFixture> {
  const db = createIsolationDatabase();

  let failing = false;
  const producer: RecordingProducer = {
    enqueued: [],
    enqueuedCommits: [],
    enqueue: (job: ImportPreviewJob) => {
      if (failing) return Promise.reject(new Error("redis unreachable"));
      producer.enqueued.push(job);
      return Promise.resolve();
    },
    enqueueCommit: (job: ImportCommitJob) => {
      if (failing) return Promise.reject(new Error("redis unreachable"));
      producer.enqueuedCommits.push(job);
      return Promise.resolve();
    },
    scriptFailure: (next: boolean) => {
      failing = next;
    },
  };

  const authConfig: AuthConfig = {
    ...readAuthConfig(process.env),
    cookieSecure: false,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      CommonModule,
      ContextModule,
      PrismaModule,
      // The guard chain, in the production registration order.
      AuthModule,
      TenancyModule,
      RbacModule,
      // `@Global`, exactly as `AppModule` composes it.
      StorageModule.forRoot(),
      ImportsModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(db.prisma as unknown as PrismaService)
    .overrideProvider(AUTH_CONFIG)
    .useValue(authConfig)
    .overrideProvider(STORAGE_PORT)
    .useValue(db.storage)
    .overrideProvider(IMPORT_PREVIEW_PRODUCER)
    .useValue(producer)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ loggerInstance: createApiLogger({ level: "info" }) })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    producer,
    close: (): Promise<void> => app.close(),
  };
}

describe("POST /imports/:id/commit", () => {
  let harness: CommitFixture;
  let db: IsolationDatabase;
  let tenantAId: string;
  let tenantBId: string;
  let runnerCookie: string;
  let readerCookie: string;
  let importOnlyCookie: string;
  let tenantBrunnerCookie: string;
  let createdByMembershipId: string;

  beforeAll(async () => {
    harness = await bootCommitHarness();
    db = harness.db;

    const tenantA = db.prisma.tenant.create({ data: { slug: "commit-a", name: "Commit A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: "commit-b", name: "Commit B" } });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const runnerRole = seedRoleWithKeys(db, "COMMIT_RUNNER", "Commit Runner", [
      "imports.run",
      "imports.read",
    ]);
    const readerRole = seedRoleWithKeys(db, "COMMIT_READER", "Commit Reader", ["imports.read"]);
    // `imports.run` WITHOUT `imports.read`: the summary must refuse this caller, which
    // is how "the summary requires imports.read" is proven rather than assumed.
    const runOnlyRole = seedRoleWithKeys(db, "COMMIT_RUN_ONLY", "Commit Run Only", ["imports.run"]);

    const runnerProfile = db.prisma.userProfile.create({
      data: { email: "commit-runner@test.test", displayName: "Runner", status: "active" },
    });
    const readerProfile = db.prisma.userProfile.create({
      data: { email: "commit-reader@test.test", displayName: "Reader", status: "active" },
    });
    const runOnlyProfile = db.prisma.userProfile.create({
      data: { email: "commit-run-only@test.test", displayName: "Run Only", status: "active" },
    });
    const tenantBRunnerProfile = db.prisma.userProfile.create({
      data: { email: "commit-b@test.test", displayName: "Runner B", status: "active" },
    });

    const membership = db.prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: runnerProfile.id,
        roleId: runnerRole.role.id,
        status: "ACTIVE",
      },
    });
    createdByMembershipId = membership.id;
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
        userProfileId: runOnlyProfile.id,
        roleId: runOnlyRole.role.id,
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
    importOnlyCookie = insertLiveStaffSession(db, runOnlyProfile.id).cookie;
    tenantBrunnerCookie = insertLiveStaffSession(db, tenantBRunnerProfile.id).cookie;
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(() => {
    harness.producer.enqueued.length = 0;
    harness.producer.enqueuedCommits.length = 0;
  });

  /** Seeds one import job directly, so a test can start it in ANY state. */
  function seedImport(args: {
    state?:
      "UPLOADED" | "PREVIEWING" | "PREVIEWED" | "COMMITTING" | "COMMITTED" | "FAILED" | "EXPIRED";
    entity?: "CUSTOMER" | "PATIENT";
    counters?: { createdCount?: number; failedCount?: number; suspectedDuplicateCount?: number };
  }): { id: string } {
    return db.prisma.importJob.create({
      data: {
        tenantId: tenantAId,
        entity: args.entity ?? "CUSTOMER",
        state: args.state ?? "PREVIEWED",
        storageKey: "import_0000000000000000000000",
        contentType: "text/csv",
        byteSize: 32,
        createdByMembershipId,
        artefactExpiresAt: new Date(Date.now() + 60_000),
        ...(args.counters === undefined
          ? {}
          : {
              createdCount: args.counters.createdCount ?? 0,
              failedCount: args.counters.failedCount ?? 0,
              suspectedDuplicateCount: args.counters.suspectedDuplicateCount ?? 0,
            }),
      },
    });
  }

  /** Seeds one stored verdict, the way the worker's preview writes them. */
  function seedOutcome(
    importId: string,
    rowNumber: number,
    status: "CREATE" | "FAILED",
    suspectedDuplicate = false,
    tenantId: string = tenantAId
  ): void {
    db.prisma.importRowOutcome.create({
      data: {
        tenantId,
        importId,
        rowNumber,
        status,
        reasonCode: status === "FAILED" ? "CUSTOMER_ROW_INVALID" : null,
        message:
          status === "FAILED" ? "The row does not satisfy the customer create contract." : null,
        suspectedDuplicate,
      },
    });
  }

  const server = () => supertest(harness.app.getHttpServer());

  it("enqueues one COMMIT job for a PREVIEWED import and answers 202 with the phase it was accepted into", async () => {
    const imported = seedImport({});

    const response = await server()
      .post(`/imports/${imported.id}/commit`)
      .set("Cookie", runnerCookie)
      .expect(202);

    // The whole body: an identifier and the phase, and nothing else can leak in.
    expect(response.body).toEqual({ importId: imported.id, state: "COMMITTING" });
    // ONE port, ONE queue, two job names: the commit is a second job NAME.
    expect(harness.producer.enqueuedCommits).toEqual([{ importJobId: imported.id }]);
    expect(harness.producer.enqueued).toEqual([]);

    // The trigger does NOT move the row: the worker's claim owns
    // `PREVIEWED -> COMMITTING`, and a trigger that moved it would make that claim
    // (pinned on PREVIEWED) skip every commit.
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("PREVIEWED");
  });

  it("writes no audit row: the transition it queues for is the worker's", async () => {
    const imported = seedImport({});

    await server().post(`/imports/${imported.id}/commit`).set("Cookie", runnerCookie).expect(202);

    const committing = [...db.tables.audits.values()].filter(
      (row) => row.action === "import.committing"
    );
    expect(committing).toEqual([]);
  });

  it("refuses every state that is not PREVIEWED with the aggregate's stable 409 and enqueues nothing", async () => {
    const states = [
      "UPLOADED",
      "PREVIEWING",
      "COMMITTING",
      "COMMITTED",
      "FAILED",
      "EXPIRED",
    ] as const;

    for (const state of states) {
      const imported = seedImport({ state });

      const response = await server()
        .post(`/imports/${imported.id}/commit`)
        .set("Cookie", runnerCookie)
        .expect(409);

      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((response.body as ErrorEnvelope).error.message).toBe(
        IMPORT_TRANSITION_CONFLICT_MESSAGE
      );
      // Work the state machine would certainly reject never reaches the queue.
      expect(harness.producer.enqueuedCommits).toEqual([]);
      expect(db.tables.importJobs.get(imported.id)?.state).toBe(state);
    }
  });

  it("queues a PATIENT commit: the entity no longer refuses a phase (IMP-004)", async () => {
    const imported = seedImport({ entity: "PATIENT" });

    const response = await server()
      .post(`/imports/${imported.id}/commit`)
      .set("Cookie", runnerCookie)
      .expect(202);

    // The same body a customer commit answers, byte for byte: the trigger is
    // parameterised by the ENTITY ON THE ROW, not by which entity this story wrote last.
    expect(response.body).toEqual({ importId: imported.id, state: "COMMITTING" });
    expect(harness.producer.enqueuedCommits).toEqual([{ importJobId: imported.id }]);
    // The trigger still moves nothing: the worker's claim owns `PREVIEWED -> COMMITTING`.
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("PREVIEWED");
  });

  it("answers a foreign import id with the byte-equivalent 404 and enqueues nothing", async () => {
    const foreign = seedImport({});

    const byOtherTenant = await server()
      .post(`/imports/${foreign.id}/commit`)
      .set("Cookie", tenantBrunnerCookie)
      .expect(404);
    const unknown = await server()
      .post("/imports/44444444-4444-4444-8444-444444444444/commit")
      .set("Cookie", tenantBrunnerCookie)
      .expect(404);

    const normalize = (body: ErrorEnvelope): ErrorEnvelope => ({
      error: { ...body.error, requestId: "normalized" },
    });
    expect(normalize(byOtherTenant.body as ErrorEnvelope)).toEqual(
      normalize(unknown.body as ErrorEnvelope)
    );
    expect((byOtherTenant.body as ErrorEnvelope).error.message).toBe(IMPORT_NOT_FOUND_MESSAGE);
    // Tenant B's runner holds `imports.run`; the id is simply not theirs.
    expect(harness.producer.enqueuedCommits).toEqual([]);
    expect(db.tables.importJobs.get(foreign.id)?.state).toBe("PREVIEWED");
  });

  it("refuses without imports.run, and the denial reaches no queue call", async () => {
    const imported = seedImport({});

    const response = await server()
      .post(`/imports/${imported.id}/commit`)
      .set("Cookie", readerCookie)
      .expect(403);

    expect((response.body as ErrorEnvelope).error.code).toBe("FORBIDDEN");
    expect(harness.producer.enqueuedCommits).toEqual([]);
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("PREVIEWED");
  });

  it("requires authentication and refuses a non-UUID id before reaching the service", async () => {
    const imported = seedImport({});

    await server().post(`/imports/${imported.id}/commit`).expect(401);
    await server().post("/imports/not-a-uuid/commit").set("Cookie", runnerCookie).expect(400);
    expect(harness.producer.enqueuedCommits).toEqual([]);
  });

  it("propagates a failed enqueue instead of accepting a commit nobody will run", async () => {
    const imported = seedImport({});
    harness.producer.scriptFailure(true);

    try {
      const response = await server()
        .post(`/imports/${imported.id}/commit`)
        .set("Cookie", runnerCookie)
        .expect(500);

      expect((response.body as ErrorEnvelope).error.code).toBe("INTERNAL");
    } finally {
      harness.producer.scriptFailure(false);
    }

    // The row is untouched, so the operator's retry is the same command.
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("PREVIEWED");
    expect(harness.producer.enqueuedCommits).toEqual([]);
  });

  it("is tenant-scoped: the payload carries the id ALONE", async () => {
    const mine = seedImport({});

    await server().post(`/imports/${mine.id}/commit`).set("Cookie", runnerCookie).expect(202);

    // The worker reads the tenant from the row — the only place in the import path
    // where a tenant is not derived from a request.
    expect(harness.producer.enqueuedCommits).toEqual([{ importJobId: mine.id }]);
    expect(harness.producer.enqueuedCommits[0]).not.toHaveProperty("tenantId");
    expect(tenantAId).not.toBe(tenantBId);
  });

  describe("GET /imports/:id/summary", () => {
    it("returns the totals and the STORED row outcomes, so a reload reads the same summary", async () => {
      const imported = seedImport({
        state: "COMMITTED",
        counters: { createdCount: 2, failedCount: 1, suspectedDuplicateCount: 1 },
      });
      seedOutcome(imported.id, 1, "CREATE", true);
      seedOutcome(imported.id, 2, "FAILED");
      seedOutcome(imported.id, 3, "CREATE");

      const first = await server()
        .get(`/imports/${imported.id}/summary`)
        .set("Cookie", readerCookie)
        .expect(200);

      // The whole body: totals, the page it answered, and the rows — and nothing
      // else can leak into it later without failing here.
      expect(first.body).toEqual({
        importId: imported.id,
        state: "COMMITTED",
        totals: { createdCount: 2, failedCount: 1, suspectedDuplicateCount: 1 },
        page: { limit: IMPORT_SUMMARY_LIMIT_DEFAULT, offset: 0 },
        rows: [
          {
            importId: imported.id,
            rowNumber: 1,
            status: "CREATE",
            reasonCode: null,
            message: null,
            suspectedDuplicate: true,
          },
          {
            importId: imported.id,
            rowNumber: 2,
            status: "FAILED",
            reasonCode: "CUSTOMER_ROW_INVALID",
            message: "The row does not satisfy the customer create contract.",
            suspectedDuplicate: false,
          },
          {
            importId: imported.id,
            rowNumber: 3,
            status: "CREATE",
            reasonCode: null,
            message: null,
            suspectedDuplicate: false,
          },
        ],
      } satisfies SummaryBody);

      // Nothing was cached and nothing was recomputed: a second request reads the
      // same stored outcomes, which is what "readable after a reload" means.
      const second = await server()
        .get(`/imports/${imported.id}/summary`)
        .set("Cookie", readerCookie)
        .expect(200);
      expect(second.body).toEqual(first.body);
    });

    it("echoes the page it answered and refuses to exceed the ceiling", async () => {
      const imported = seedImport({
        state: "COMMITTED",
        counters: { createdCount: 3, failedCount: 0, suspectedDuplicateCount: 0 },
      });
      for (const rowNumber of [1, 2, 3]) seedOutcome(imported.id, rowNumber, "CREATE");

      const page = await server()
        .get(`/imports/${imported.id}/summary?limit=2&offset=1`)
        .set("Cookie", readerCookie)
        .expect(200);

      const body = page.body as SummaryBody;
      expect(body.page).toEqual({ limit: 2, offset: 1 });
      // The TOTALS are always the whole import; only the rows are paged.
      expect(body.totals).toEqual({ createdCount: 3, failedCount: 0, suspectedDuplicateCount: 0 });
      // Rows come back in FILE order (`rowNumber` ascending), which is what makes a
      // page readable next to the file.
      expect(body.rows.map((row) => row.rowNumber)).toEqual([1, 2, 3]);
      // The SLICE itself is asserted against the repository's own call
      // (`imports.row-outcomes.test.ts`): the in-memory boundary this suite runs on
      // does not implement `take`/`skip`, so a slice assertion here would be
      // asserting the fake rather than the query.
    });

    it("REFUSES an oversized page rather than truncating it", async () => {
      const imported = seedImport({ state: "COMMITTED" });

      const response = await server()
        .get(`/imports/${imported.id}/summary?limit=${IMPORT_SUMMARY_LIMIT_MAX + 1}`)
        .set("Cookie", readerCookie)
        .expect(400);

      expect((response.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
      expect((response.body as ErrorEnvelope).error.message).toBe(
        IMPORT_SUMMARY_QUERY_INVALID_MESSAGE
      );
    });

    it("refuses an unknown query key and a non-uuid id", async () => {
      const imported = seedImport({ state: "COMMITTED" });

      await server()
        .get(`/imports/${imported.id}/summary?page=1`)
        .set("Cookie", readerCookie)
        .expect(400);
      await server().get("/imports/not-a-uuid/summary").set("Cookie", readerCookie).expect(400);
    });

    it("answers a foreign import id with the byte-equivalent 404 and lists no row", async () => {
      const foreign = seedImport({ state: "COMMITTED" });
      seedOutcome(foreign.id, 1, "CREATE");

      const byOtherTenant = await server()
        .get(`/imports/${foreign.id}/summary`)
        .set("Cookie", tenantBrunnerCookie)
        .expect(404);
      const unknown = await server()
        .get("/imports/44444444-4444-4444-8444-444444444444/summary")
        .set("Cookie", tenantBrunnerCookie)
        .expect(404);

      const normalize = (body: ErrorEnvelope): ErrorEnvelope => ({
        error: { ...body.error, requestId: "normalized" },
      });
      expect(normalize(byOtherTenant.body as ErrorEnvelope)).toEqual(
        normalize(unknown.body as ErrorEnvelope)
      );
      // The other tenant's row outcome is never read, let alone returned.
      expect(JSON.stringify(byOtherTenant.body)).not.toContain(foreign.id);
    });

    it("requires imports.read: imports.run alone is not enough", async () => {
      const imported = seedImport({ state: "COMMITTED" });

      const response = await server()
        .get(`/imports/${imported.id}/summary`)
        .set("Cookie", importOnlyCookie)
        .expect(403);

      expect((response.body as ErrorEnvelope).error.code).toBe("FORBIDDEN");
    });

    it("requires authentication", async () => {
      const imported = seedImport({ state: "COMMITTED" });

      await server().get(`/imports/${imported.id}/summary`).expect(401);
    });

    it("is readable while the import is still PREVIEWED: the outcomes exist before the commit", async () => {
      const imported = seedImport({ state: "PREVIEWED" });
      seedOutcome(imported.id, 1, "CREATE");

      const response = await server()
        .get(`/imports/${imported.id}/summary`)
        .set("Cookie", readerCookie)
        .expect(200);

      // The summary answers "what happened" in every state; a 409 here would refuse
      // the one question this surface exists to answer.
      expect((response.body as SummaryBody).state).toBe("PREVIEWED");
      expect((response.body as SummaryBody).rows).toHaveLength(1);
    });
  });
});
