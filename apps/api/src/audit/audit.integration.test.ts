import { Controller, Get } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { DestinationStream } from "pino";
import { PrismaModule, PrismaService } from "@newsaas/database";
import { AuthModule } from "../auth/auth.module.js";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "../auth/auth.config.js";
import { CredentialService } from "../auth/credential.service.js";
import { CommonModule } from "../common/common.module.js";
import { createApiLogger } from "../common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../common/http/fastify-adapter.factory.js";

/**
 * Deliberately UNPROTECTED probe proving the guard chain still boots when
 * AuditModule composes into AuthModule.
 */
const PRIVATE_MARKER = "private-handler-reached";

@Controller("probe")
class ProbeController {
  @Get("private")
  privateRoute(): Record<string, boolean> {
    throw new Error(PRIVATE_MARKER);
  }
}

interface AuditRowShape {
  id: string;
  action: string;
  actorType: string;
  actorUserProfileId?: string;
  targetType?: string;
  targetId?: string;
  metadata: Record<string, unknown>;
  requestId?: string;
}

/**
 * In-memory Prisma boundary fake including the append-only audit delegate:
 * this suite is the END-TO-END wiring proof that login events reach the
 * AuditWriter over real HTTP (task 7.1).
 */
function makeFakeDatabase() {
  const profiles = new Map<string, { id: string; email: string; displayName: string }>();
  const credentials = new Map<string, string>(); // profileId -> password hash
  const sessions = new Map<string, unknown>(); // tokenHash -> row
  const audits = new Map<string, AuditRowShape>();
  let sequence = 0;

  const prisma = {
    userProfile: {
      findUnique: ({ where }: { where: { email: string } }) => {
        for (const profile of profiles.values()) {
          if (profile.email === where.email) {
            return {
              id: profile.id,
              displayName: profile.displayName,
              credential: credentials.has(profile.id)
                ? { passwordHash: credentials.get(profile.id) }
                : null,
            };
          }
        }
        return null;
      },
    },
    staffSession: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = { id: `row-${sequence}`, ...data };
        sessions.set(String(data.tokenHash), row);
        return row;
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        sessions.get(where.tokenHash) ?? null,
      update: ({ where, data }: { where: { id: string }; data: object }) => {
        const row = [...sessions.values()].find(
          (entry) => (entry as { id: string }).id === where.id
        );
        if (!row) throw new Error("P2025");
        Object.assign(row, data);
        return row;
      },
      deleteMany: ({ where }: { where: { tokenHash: string } }) => ({
        count: sessions.delete(where.tokenHash) ? 1 : 0,
      }),
    },
    auditLog: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row: AuditRowShape = {
          id: `audit-${sequence}`,
          action: data.action as string,
          actorType: data.actorType as string,
          actorUserProfileId: data.actorUserProfileId as string | undefined,
          targetType: data.targetType as string | undefined,
          targetId: data.targetId as string | undefined,
          metadata: (data.metadata ?? {}) as Record<string, unknown>,
          requestId: data.requestId as string | undefined,
        };
        audits.set(row.id, row);
        return row;
      },
    },
  };

  return { prisma, profiles, credentials, sessions, audits };
}

type FakeDatabase = ReturnType<typeof makeFakeDatabase>;

/**
 * Deterministic UUID profile ids: the AuditWriter validates actor/target
 * identifiers as UUIDs (real FKs are UUIDs), so fixtures use well-formed ones.
 */
const PROFILE_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
] as const;

const PROFILE_ID_1 = PROFILE_IDS[0];

async function seedStaff(
  db: FakeDatabase,
  email: string,
  password: string
): Promise<{ id: string; displayName: string }> {
  const profile = {
    id: PROFILE_IDS[db.profiles.size],
    email: email.toLowerCase(),
    displayName: `Staff ${db.profiles.size + 1}`,
  };
  db.profiles.set(profile.id, profile);
  const credentialsService = new CredentialService({
    ...readAuthConfig(process.env),
    argonMemoryCost: 19456,
    argonTimeCost: 2,
    argonParallelism: 1,
  });
  db.credentials.set(profile.id, await credentialsService.hash(password));
  return { id: profile.id, displayName: profile.displayName };
}

async function bootAuditAuthApp(db: FakeDatabase): Promise<{
  app: NestFastifyApplication;
}> {
  const stream: DestinationStream = {
    write(message: string): void {
      void message;
    },
  };
  const logger = createApiLogger({ stream, level: "info" });

  const moduleRef = await Test.createTestingModule({
    imports: [CommonModule, PrismaModule, AuthModule],
    controllers: [ProbeController],
  })
    .overrideProvider(PrismaService)
    .useValue(db.prisma)
    .overrideProvider(AUTH_CONFIG)
    .useValue({
      ...readAuthConfig(process.env),
      cookieSecure: false,
    } satisfies AuthConfig)
    .compile();

  // SAME factory as production main.ts — the CORS/security-header hook and
  // genReqId seam are identical to what ships.
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ loggerInstance: logger })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app };
}

const loginWith = (
  app: NestFastifyApplication,
  requestId: string,
  payload: Record<string, unknown>
): supertest.Test =>
  supertest(app.getHttpServer()).post("/auth/login").set("X-Request-Id", requestId).send(payload);

describe("audit wiring over real HTTP (design D9 end-to-end)", () => {
  let app: NestFastifyApplication;
  let db: FakeDatabase;

  beforeAll(async () => {
    db = makeFakeDatabase();
    await seedStaff(db, "audited@clinic.test", "correct-password");
    // Separate identities so rate-limit budget never bleeds across cases:
    // - untouched@ proves the guard chain after other tests ran;
    // - flooded@ gets exhausted exactly here.
    await seedStaff(db, "untouched@clinic.test", "another-password");
    await seedStaff(db, "flooded@clinic.test", "flood-password");
    ({ app } = await bootAuditAuthApp(db));
  });

  afterAll(async () => {
    await app.close();
  });

  it("a successful login appends auth.login_succeeded correlated to the request", async () => {
    await loginWith(app, "audit-success-flow", {
      email: "audited@clinic.test",
      password: "correct-password",
    }).expect(200);

    const rows = [...db.audits.values()].filter((row) => row.action === "auth.login_succeeded");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorType).toBe("STAFF");
    expect(row.actorUserProfileId).toBe(PROFILE_ID_1);
    expect(row.targetType).toBe("user_profile");
    expect(row.targetId).toBe(PROFILE_ID_1);
    // Server-derived correlation: the inbound X-Request-Id rides on the row.
    expect(row.requestId).toBe("audit-success-flow");
    // Sanitized metadata only.
    expect(row.metadata).toEqual({ email: "audited@clinic.test" });
    expect(JSON.stringify(row)).not.toContain("correct-password");
  });

  it("a failed login appends auth.login_failed without leaking which factor failed", async () => {
    await loginWith(app, "audit-failure-flow", {
      email: "audited@clinic.test",
      password: "wrong-password",
    }).expect(401);

    // Known email ⇒ attributed STAFF failure.
    const knownRows = [...db.audits.values()].filter((row) => row.action === "auth.login_failed");
    expect(knownRows).toHaveLength(1);
    expect(knownRows[0].actorType).toBe("STAFF");
    expect(knownRows[0].targetId).toBe(PROFILE_ID_1);
    expect(knownRows[0].requestId).toBe("audit-failure-flow");

    // Unknown email ⇒ unattributed SYSTEM failure, byte-identical client 401.
    await loginWith(app, "audit-unknown-flow", {
      email: "ghost@clinic.test",
      password: "whatever",
    }).expect(401);
    const allFailed = [...db.audits.values()].filter((row) => row.action === "auth.login_failed");
    expect(allFailed).toHaveLength(2);
    expect(allFailed[1].actorType).toBe("SYSTEM");
    expect(allFailed[1].actorUserProfileId).toBeUndefined();
  });

  it("rate-limited attempts append NOTHING (audit-table flood defense)", async () => {
    // Exhaust the budget for one identity/source (fresh account: exactly ten
    // failures trip the limiter, the eleventh is blocked pre-verification).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await loginWith(app, `flood-${attempt}`, {
        email: "flooded@clinic.test",
        password: "wrong-password",
      }).expect(401);
    }

    const failuresSoFar = [...db.audits.values()].filter(
      (row) => row.action === "auth.login_failed" && row.metadata.email === "flooded@clinic.test"
    ).length;
    expect(failuresSoFar).toBe(10);

    // Blocked BEFORE credential work AND before any audit append.
    await loginWith(app, "blocked-attempt", {
      email: "flooded@clinic.test",
      password: "right-or-wrong-does-not-matter",
    }).expect(429);

    const failuresAfterBlock = [...db.audits.values()].filter(
      (row) => row.action === "auth.login_failed" && row.metadata.email === "flooded@clinic.test"
    ).length;
    expect(failuresAfterBlock).toBe(failuresSoFar);
    expect([...db.audits.values()].some((row) => row.requestId === "blocked-attempt")).toBe(false);
  });

  it("keeps the session surface intact while auditing (guard chain still guards)", async () => {
    await supertest(app.getHttpServer()).get("/probe/private").expect(401);
    const established = await loginWith(app, "me-after-audit", {
      email: "untouched@clinic.test",
      password: "another-password",
    }).expect(200);
    expect((established.body as { user: { id: string } }).user.id).toBe(PROFILE_IDS[1]);

    const cookieHeader = (established.headers["set-cookie"] as unknown as string[])
      .map((entry) => entry.split(";")[0])
      .join("; ");
    const me = await supertest(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookieHeader)
      .set("X-Request-Id", "me-correlation")
      .expect(200);
    // Guard-derived identity still flows server-side alongside auditing.
    expect(me.body).toMatchObject({
      user: { id: PROFILE_IDS[1] },
      requestId: "me-correlation",
    });
  });
});
