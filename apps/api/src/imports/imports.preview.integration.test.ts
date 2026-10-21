import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { PrismaModule, PrismaService } from "@newsaas/database";
import {
  IMPORT_PREVIEW_PRODUCER,
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
import { IMPORT_TRANSITION_CONFLICT_MESSAGE } from "./imports.repository.js";

/**
 * IMP-002 HTTP boundary suite for `POST /imports/:id/preview`.
 *
 * WHY THIS SUITE COMPOSES ITS OWN MODULE GRAPH rather than reusing
 * `bootTestApp`: the producer token has to be replaced with a RECORDING double for
 * "the route enqueued exactly one job" to be observable at all, and
 * `boot-test-app.ts` replaces a fixed set of tokens (the fiscal, branding and
 * notification producers) that this surface did not exist when it was written. The
 * graph below is the same guard chain in the same order as `AppModule` —
 * `AuthModule` → `TenancyModule` → `RbacModule` (design D1 wire order) — plus
 * `CommonModule` for the error envelope and `ImportsModule` itself, so both the
 * refusals and the acceptance run through the real guards, the real service and the
 * real repository over the in-memory boundary.
 *
 * What it proves, in the Story's words:
 *
 * - the trigger ENQUEUES one job for an `UPLOADED` import, and answers `202` with
 *   the id and the phase it was accepted into;
 * - it does NOT move the row: the transition is the worker's claim, and a trigger
 *   that moved it would make every preview skip itself;
 * - an import in any other state is refused with the aggregate's existing stable
 *   `409`, and nothing is enqueued;
 * - a foreign or unknown id is the byte-equivalent `404`;
 * - `imports.run` guards it, and a denial happens BEFORE any queue call.
 */

interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string };
}

interface RecordingProducer extends ImportPreviewProducer {
  readonly enqueued: ImportPreviewJob[];
  /** Makes the next enqueues reject, the way an unreachable Redis does. */
  scriptFailure(failing: boolean): void;
}

interface PreviewFixture {
  readonly app: NestFastifyApplication;
  readonly db: IsolationDatabase;
  readonly producer: RecordingProducer;
  close(): Promise<void>;
}

async function bootPreviewHarness(): Promise<PreviewFixture> {
  const db = createIsolationDatabase();

  let failing = false;
  const producer: RecordingProducer = {
    enqueued: [],
    enqueue: (job: ImportPreviewJob) => {
      if (failing) return Promise.reject(new Error("redis unreachable"));
      producer.enqueued.push(job);
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
      // `@Global`, exactly as `AppModule` composes it: ImportsService injects the
      // abstract port and never a driver of its own.
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

describe("POST /imports/:id/preview", () => {
  let harness: PreviewFixture;
  let db: IsolationDatabase;
  let tenantAId: string;
  let tenantBId: string;
  let runnerCookie: string;
  let readerCookie: string;
  let tenantBrunnerCookie: string;
  let createdByMembershipId: string;

  beforeAll(async () => {
    harness = await bootPreviewHarness();
    db = harness.db;

    const tenantA = db.prisma.tenant.create({ data: { slug: "preview-a", name: "Preview A" } });
    const tenantB = db.prisma.tenant.create({ data: { slug: "preview-b", name: "Preview B" } });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const runnerRole = seedRoleWithKeys(db, "PREVIEW_RUNNER", "Preview Runner", [
      "imports.run",
      "imports.read",
    ]);
    const readerRole = seedRoleWithKeys(db, "PREVIEW_READER", "Preview Reader", ["imports.read"]);

    const runnerProfile = db.prisma.userProfile.create({
      data: { email: "preview-runner@test.test", displayName: "Runner", status: "active" },
    });
    const readerProfile = db.prisma.userProfile.create({
      data: { email: "preview-reader@test.test", displayName: "Reader", status: "active" },
    });
    const tenantBRunnerProfile = db.prisma.userProfile.create({
      data: { email: "preview-b@test.test", displayName: "Runner B", status: "active" },
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
        tenantId: tenantB.id,
        userProfileId: tenantBRunnerProfile.id,
        roleId: runnerRole.role.id,
        status: "ACTIVE",
      },
    });

    runnerCookie = insertLiveStaffSession(db, runnerProfile.id).cookie;
    readerCookie = insertLiveStaffSession(db, readerProfile.id).cookie;
    tenantBrunnerCookie = insertLiveStaffSession(db, tenantBRunnerProfile.id).cookie;
  });

  afterAll(async () => {
    await harness?.close();
  });

  // One harness for the file (booting a module graph is the expensive part), so
  // every case starts with an empty queue recording.
  beforeEach(() => {
    harness.producer.enqueued.length = 0;
  });

  /** Seeds one import job directly, so a test can start it in ANY state. */
  function seedImport(state: "UPLOADED" | "PREVIEWING" | "PREVIEWED" | "FAILED" = "UPLOADED"): {
    id: string;
  } {
    return db.prisma.importJob.create({
      data: {
        tenantId: tenantAId,
        entity: "CUSTOMER",
        state,
        storageKey: "import_0000000000000000000000",
        contentType: "text/csv",
        byteSize: 32,
        createdByMembershipId,
        artefactExpiresAt: new Date(Date.now() + 60_000),
      },
    });
  }

  const server = () => supertest(harness.app.getHttpServer());

  it("enqueues one job for an UPLOADED import and answers 202 with the phase it was accepted into", async () => {
    const imported = seedImport("UPLOADED");

    const response = await server()
      .post(`/imports/${imported.id}/preview`)
      .set("Cookie", runnerCookie)
      .expect(202);

    // The whole body, not a subset: the trigger returns an identifier and the
    // phase, and nothing else can leak into it later without failing here.
    expect(response.body).toEqual({ importId: imported.id, state: "PREVIEWING" });
    expect(harness.producer.enqueued).toEqual([{ importJobId: imported.id }]);

    // The trigger does NOT perform the transition: the worker's claim owns
    // `UPLOADED -> PREVIEWING`, and a trigger that moved the row first would make
    // that claim (pinned on UPLOADED) skip every preview.
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("UPLOADED");
  });

  it("writes no audit row: the transition it queues for is the worker's", async () => {
    const imported = seedImport("UPLOADED");

    await server().post(`/imports/${imported.id}/preview`).set("Cookie", runnerCookie).expect(202);

    const previewing = [...db.tables.audits.values()].filter(
      (row) => row.action === "import.previewing"
    );
    expect(previewing).toEqual([]);
  });

  it("refuses an import that is not UPLOADED with the aggregate's stable 409 and enqueues nothing", async () => {
    const previewed = seedImport("PREVIEWED");

    const response = await server()
      .post(`/imports/${previewed.id}/preview`)
      .set("Cookie", runnerCookie)
      .expect(409);

    expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
    expect((response.body as ErrorEnvelope).error.message).toBe(IMPORT_TRANSITION_CONFLICT_MESSAGE);
    // Work the state machine would certainly reject never reaches the queue.
    expect(harness.producer.enqueued).toEqual([]);
    expect(db.tables.importJobs.get(previewed.id)?.state).toBe("PREVIEWED");
  });

  it("answers a foreign import id with the byte-equivalent 404 and enqueues nothing", async () => {
    const foreign = seedImport("UPLOADED");

    const byOtherTenant = await server()
      .post(`/imports/${foreign.id}/preview`)
      .set("Cookie", tenantBrunnerCookie)
      .expect(404);
    const unknown = await server()
      .post("/imports/44444444-4444-4444-8444-444444444444/preview")
      .set("Cookie", tenantBrunnerCookie)
      .expect(404);

    const normalize = (body: ErrorEnvelope): ErrorEnvelope => ({
      error: { ...body.error, requestId: "normalized" },
    });
    expect(normalize(byOtherTenant.body as ErrorEnvelope)).toEqual(
      normalize(unknown.body as ErrorEnvelope)
    );
    // Tenant B's runner holds `imports.run`; the id is simply not theirs.
    expect(harness.producer.enqueued).toEqual([]);
    expect(db.tables.importJobs.get(foreign.id)?.state).toBe("UPLOADED");
  });

  it("refuses without imports.run, and the denial reaches no queue call", async () => {
    const imported = seedImport("UPLOADED");

    const response = await server()
      .post(`/imports/${imported.id}/preview`)
      .set("Cookie", readerCookie)
      .expect(403);

    expect((response.body as ErrorEnvelope).error.code).toBe("FORBIDDEN");
    expect(harness.producer.enqueued).toEqual([]);
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("UPLOADED");
  });

  it("requires authentication", async () => {
    const imported = seedImport("UPLOADED");

    await server().post(`/imports/${imported.id}/preview`).expect(401);
    expect(harness.producer.enqueued).toEqual([]);
  });

  it("refuses a non-UUID id as a 400 before reaching the service", async () => {
    await server().post("/imports/not-a-uuid/preview").set("Cookie", runnerCookie).expect(400);
    expect(harness.producer.enqueued).toEqual([]);
  });

  it("propagates a failed enqueue instead of accepting an import nobody will preview", async () => {
    const imported = seedImport("UPLOADED");
    harness.producer.scriptFailure(true);

    try {
      const response = await server()
        .post(`/imports/${imported.id}/preview`)
        .set("Cookie", runnerCookie)
        .expect(500);

      expect((response.body as ErrorEnvelope).error.code).toBe("INTERNAL");
    } finally {
      harness.producer.scriptFailure(false);
    }

    // The row is untouched, so the operator's retry is the same command.
    expect(db.tables.importJobs.get(imported.id)?.state).toBe("UPLOADED");
    expect(harness.producer.enqueued).toEqual([]);
  });

  it("is tenant-scoped: the same id enqueues for its own tenant only", async () => {
    const mine = seedImport("UPLOADED");

    await server().post(`/imports/${mine.id}/preview`).set("Cookie", runnerCookie).expect(202);

    // The payload carries the id ALONE — the worker reads the tenant from the row,
    // which is the only place in the import path where a tenant is not derived
    // from a request.
    expect(harness.producer.enqueued).toEqual([{ importJobId: mine.id }]);
    expect(harness.producer.enqueued[0]).not.toHaveProperty("tenantId");
    expect(tenantAId).not.toBe(tenantBId);
  });
});
