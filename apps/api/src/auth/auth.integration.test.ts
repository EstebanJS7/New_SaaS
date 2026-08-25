import { Controller, Get } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { DestinationStream } from "pino";
import { PrismaModule, PrismaService } from "@newsaas/database";
import { HealthModule } from "../health/health.module.js";
import { AuthModule } from "./auth.module.js";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "./auth.config.js";
import { CredentialService } from "./credential.service.js";
import { STAFF_SESSION_COOKIE } from "./session-cookie.js";
import { CommonModule } from "../common/common.module.js";
import { createApiLogger } from "../common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../common/http/fastify-adapter.factory.js";

interface ErrorEnvelopeBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

/**
 * Deliberately UNPROTECTED probe: reaching this handler proves the global
 * guard let a valid session through; its marker failure proves the inverse.
 */
const PRIVATE_MARKER = "private-handler-reached";

@Controller("probe")
class ProbeController {
  @Get("private")
  privateRoute(): Record<string, boolean> {
    throw new Error(PRIVATE_MARKER);
  }
}

interface SessionRowShape {
  id: string;
  userProfileId: string;
  tokenHash: string;
}

/** In-memory Prisma boundary fake (PrismaClient is a Proxy — no instanceof). */
function makeFakeDatabase() {
  const profiles = new Map<string, { id: string; email: string; displayName: string }>();
  const credentials = new Map<string, string>(); // profileId -> password hash
  const sessions = new Map<string, SessionRowShape>(); // tokenHash -> row
  let sequence = 0;

  const prisma = {
    userProfile: {
      // Sync bodies (eslint require-await): awaiting plain values keeps the
      // runtime contract identical to the real async delegates.
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
        const row = {
          id: `row-${sequence}`,
          userProfileId: data.userProfileId as string,
          tokenHash: data.tokenHash as string,
          // Full temporal shape: expiry decisions read these fields.
          lastSeenAt: data.lastSeenAt as Date,
          idleExpiresAt: data.idleExpiresAt as Date,
          absoluteExpiresAt: data.absoluteExpiresAt as Date,
          revokedAt: null,
        };
        sessions.set(row.tokenHash, row);
        return row;
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        sessions.get(where.tokenHash) ?? null,
      update: ({ where, data }: { where: { id: string }; data: Partial<SessionRowShape> }) => {
        const row = [...sessions.values()].find((entry) => entry.id === where.id);
        if (!row) throw new Error("P2025");
        Object.assign(row, data);
        return row;
      },
      deleteMany: ({ where }: { where: { tokenHash: string } }) => ({
        count: sessions.delete(where.tokenHash) ? 1 : 0,
      }),
    },
  };

  return { prisma, profiles, credentials, sessions };
}

type FakeDatabase = ReturnType<typeof makeFakeDatabase>;

async function seedStaff(
  db: FakeDatabase,
  email: string,
  password: string
): Promise<{ id: string; displayName: string }> {
  const profile = {
    id: `profile-${db.profiles.size + 1}`,
    email: email.toLowerCase(),
    displayName: `Staff ${db.profiles.size + 1}`,
  };
  db.profiles.set(profile.id, profile);
  const credentials = new CredentialService({
    ...readAuthConfig(process.env),
    argonMemoryCost: 19456,
    argonTimeCost: 2,
    argonParallelism: 1,
  });
  db.credentials.set(profile.id, await credentials.hash(password));
  return { id: profile.id, displayName: profile.displayName };
}

interface BootOptions {
  authConfig?: Partial<AuthConfig>;
}

async function bootAuthApp(
  db: FakeDatabase,
  options: BootOptions = {}
): Promise<{ app: NestFastifyApplication; logLines: () => string[] }> {
  const captured: string[] = [];
  const stream: DestinationStream = {
    write(message: string): void {
      captured.push(message);
    },
  };
  const logger = createApiLogger({ stream, level: "info" });

  const moduleRef = await Test.createTestingModule({
    imports: [CommonModule, PrismaModule, HealthModule, AuthModule],
    controllers: [ProbeController],
  })
    .overrideProvider(PrismaService)
    .useValue(db.prisma)
    .overrideProvider(AUTH_CONFIG)
    .useValue({ ...readAuthConfig(process.env), ...(options.authConfig ?? {}) })
    .compile();

  // SAME factory as production main.ts: genReqId stashing, request-id echo
  // hook and the cookie plugin all come from the shared seam.
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ loggerInstance: logger })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, logLines: (): string[] => captured };
}

const login = (app: NestFastifyApplication, payload: Record<string, unknown>): supertest.Test =>
  supertest(app.getHttpServer())
    .post("/auth/login")
    .set("X-Request-Id", "auth-flow-correlation")
    .send(payload);

describe("Auth surface (real Fastify adapter)", () => {
  let app: NestFastifyApplication;
  let db: FakeDatabase;

  beforeAll(async () => {
    db = makeFakeDatabase();
    await seedStaff(db, "owner@clinic.test", "correct-password");
    // Plain-HTTP harness: explicitly opts OUT of the D4 secure-by-default
    // posture (default mapping itself is proven in auth.config.test.ts).
    ({ app } = await bootAuthApp(db, { authConfig: { cookieSecure: false } }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /auth/login establishes a server-side session and sets a hardened cookie", async () => {
    const response = await login(app, {
      email: "owner@clinic.test",
      password: "correct-password",
    }).expect(200);

    // A session row now exists server-side (spec scenario).
    expect(db.sessions.size).toBe(1);
    const [storedRow] = [...db.sessions.values()];
    expect(storedRow.tokenHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex at rest

    // Minimal identity body — no credential material anywhere.
    const body = response.body as { user: { id: string; displayName: string } };
    expect(body.user).toEqual({ id: "profile-1", displayName: "Staff 1" });
    expect(JSON.stringify(response.body)).not.toContain("correct-password");

    // Cookie flags (transport baseline): HttpOnly + SameSite=Lax + Path=/.
    // Secure is OFF here only because this harness explicitly opted out to
    // run plain HTTP (see beforeAll); the ON posture is covered below and by
    // the readAuthConfig unit tests.
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const sessionCookie = setCookie.find((entry) => entry.startsWith(`${STAFF_SESSION_COOKIE}=`));
    expect(sessionCookie).toBeDefined();
    const attributes = new Set(
      String(sessionCookie)
        .split(";")
        .map((part) => part.trim())
    );
    expect(attributes.has("HttpOnly")).toBe(true);
    expect(attributes.has("SameSite=Lax")).toBe(true);
    expect(attributes.has("Path=/")).toBe(true);
    expect([...attributes].some((attribute) => attribute.toLowerCase() === "secure")).toBe(false);
  });

  it("rejects a wrong password with a uniform 401 envelope and NO session", async () => {
    const sessionsBefore = db.sessions.size;

    const wrongPassword = await login(app, {
      email: "owner@clinic.test",
      password: "wrong-password",
    }).expect(401);
    const wrongBody = wrongPassword.body as ErrorEnvelopeBody;
    expect(wrongBody.error.code).toBe("UNAUTHENTICATED");
    expect(wrongBody.error.requestId).toBe("auth-flow-correlation");

    // Unknown email must be byte-indistinguishable from wrong password...
    const unknownEmail = await login(app, {
      email: "nobody@clinic.test",
      password: "wrong-password",
    }).expect(401);
    const unknownBody = unknownEmail.body as ErrorEnvelopeBody;
    expect(unknownBody.error.code).toBe(wrongBody.error.code);
    expect(unknownBody.error.message).toBe(wrongBody.error.message);
    expect(unknownEmail.text).toBe(wrongPassword.text);

    // ...and both paths pay the same argon2 verification cost (>15ms rules out
    // an early-return enumeration oracle on any realistic machine).
    const startedAt = Date.now();
    await login(app, { email: "ghost@clinic.test", password: "whatever" }).expect(401);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);

    expect(db.sessions.size).toBe(sessionsBefore);
  });

  it("validates the login body with zod before any credential work", async () => {
    const response = await supertest(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "not-an-email", password: "" })
      .expect(400);

    const body = response.body as ErrorEnvelopeBody;
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("blocks GET /probe/private BEFORE the handler without a valid session", async () => {
    const anonymous = await supertest(app.getHttpServer()).get("/probe/private").expect(401);
    expect((anonymous.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");

    // A forged cookie value is just an unknown token: same rejection.
    const forged = await supertest(app.getHttpServer())
      .get("/probe/private")
      .set("Cookie", `${STAFF_SESSION_COOKIE}=forged-token-value`)
      .expect(401);
    expect((forged.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
  });

  it("GET /auth/me returns SERVER-derived identity and ignores client hints", async () => {
    const established = await login(app, {
      email: "owner@clinic.test",
      password: "correct-password",
    }).expect(200);
    const cookieHeader = (established.headers["set-cookie"] as unknown as string[])
      .map((entry) => entry.split(";")[0])
      .join("; ");

    const probe = await supertest(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", cookieHeader)
      .set("X-Request-Id", "context-probe-id")
      // Client-sent identity fields MUST be ignored (server-derived only).
      .query({ userId: "forged-user", userProfileId: "forged-profile" })
      .set("x-user-profile-id", "forged-profile-header")
      .expect(200);

    const body = probe.body as { user: { id: string }; requestId: string };
    expect(body.user.id).toBe("profile-1");
    // ALS wiring proof end to end: context carries the request-id seam's id.
    expect(probe.headers["x-request-id"]).toBe("context-probe-id");
    expect(body.requestId).toBe("context-probe-id");
  });

  it("logout revokes the server-side session so replaying the cookie fails", async () => {
    const established = await login(app, {
      email: "owner@clinic.test",
      password: "correct-password",
    }).expect(200);
    const rawCookie = (established.headers["set-cookie"] as unknown as string[])
      .find((entry) => entry.startsWith(`${STAFF_SESSION_COOKIE}=`))!
      .split(";")[0];
    expect(rawCookie).toBeDefined();
    const tokenValue = rawCookie.split("=")[1];
    const tokenHash = (await import("node:crypto"))
      .createHash("sha256")
      .update(tokenValue, "utf8")
      .digest("hex");
    expect(db.sessions.has(tokenHash)).toBe(true);
    const sessionsBeforeLogout = db.sessions.size;

    const logoutResponse = await supertest(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", rawCookie)
      .set("X-Request-Id", "logout-correlation")
      .expect(204);

    // Row hard-deleted server-side (design D4); other sessions untouched.
    expect(db.sessions.has(tokenHash)).toBe(false);
    expect(db.sessions.size).toBe(sessionsBeforeLogout - 1);

    // Cleared cookie keeps the hardened flags.
    const cleared = (logoutResponse.headers["set-cookie"] as unknown as string[]).find((entry) =>
      entry.startsWith(`${STAFF_SESSION_COOKIE}=`)
    )!;
    expect(cleared.split(";").map((part) => part.trim())).toEqual(
      expect.arrayContaining([`${STAFF_SESSION_COOKIE}=`, "Max-Age=0", "HttpOnly"])
    );

    // Replay of the revoked cookie is rejected with the envelope (spec).
    const replay = await supertest(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", rawCookie)
      .expect(401);
    expect((replay.body as ErrorEnvelopeBody).error.code).toBe("UNAUTHENTICATED");
  });

  it("keeps /health/live public while auth routes stay guarded", async () => {
    // Sanity: the @Public opt-out does not accidentally open everything.
    await supertest(app.getHttpServer()).get("/health/live").expect(200);
    await supertest(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("never logs passwords, hashes or session tokens during auth flows", async () => {
    const scanDb = makeFakeDatabase();
    await seedStaff(scanDb, "log-scan@clinic.test", "super-secret-passphrase");
    const { app: seededApp, logLines } = await bootAuthApp(scanDb);
    try {
      // Unknown-email AND wrong-password paths execute before the success.
      await login(seededApp, { email: "ghost@nowhere.test", password: "whatever" }).expect(401);
      await login(seededApp, {
        email: "log-scan@clinic.test",
        password: "not-the-password",
      }).expect(401);
      const success = await login(seededApp, {
        email: "log-scan@clinic.test",
        password: "super-secret-passphrase",
      }).expect(200);
      const issuedToken = (success.headers["set-cookie"] as unknown as string[])[0]
        .split(";")[0]
        .split("=")[1];

      const serialized = JSON.stringify(logLines());
      expect(serialized).not.toContain("super-secret-passphrase"); // plaintext pw
      expect(serialized).not.toContain("$argon2id$"); // hash material
      expect(serialized).not.toContain(issuedToken); // bearer token
    } finally {
      await seededApp.close();
    }
  });

  it("returns NOT_FOUND envelopes for absent recovery routes (deferred feature)", async () => {
    const forgot = await supertest(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: "owner@clinic.test" })
      .expect(404);
    expect((forgot.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");

    const reset = await supertest(app.getHttpServer())
      .post("/auth/password-reset")
      .send({ token: "anything", password: "new" })
      .expect(404);
    expect((reset.body as ErrorEnvelopeBody).error.code).toBe("NOT_FOUND");
  });
});

describe("Login rate limiting (real adapter)", () => {
  it("returns RATE_LIMITED envelopes once the threshold trips, per key", async () => {
    const db = makeFakeDatabase();
    await seedStaff(db, "targeted@clinic.test", "right-password");
    await seedStaff(db, "bystander@clinic.test", "right-password");
    const { app } = await bootAuthApp(db);

    // Nine verified failures for (targeted, this IP): still allowed.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await login(app, { email: "targeted@clinic.test", password: "nope" }).expect(401);
    }

    // A DIFFERENT email from the same IP is unaffected by the near-full budget.
    await login(app, { email: "bystander@clinic.test", password: "wrong" }).expect(401);

    // Tenth failure exhausts the budget; further attempts get 429 envelopes
    // WITHOUT any credential verification (even the right password fails shut).
    await login(app, { email: "targeted@clinic.test", password: "nope" }).expect(401);
    const blockedWrong = await login(app, {
      email: "targeted@clinic.test",
      password: "still-wrong",
    }).expect(429);
    expect((blockedWrong.body as ErrorEnvelopeBody).error.code).toBe("RATE_LIMITED");
    const blockedRight = await login(app, {
      email: "targeted@clinic.test",
      password: "right-password",
    }).expect(429);
    expect((blockedRight.body as ErrorEnvelopeBody).error.code).toBe("RATE_LIMITED");

    await app.close();
  });

  it("resets the budget after a successful login (success-after-failures)", async () => {
    const db = makeFakeDatabase();
    await seedStaff(db, "resettable@clinic.test", "good-password");
    const { app } = await bootAuthApp(db);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await login(app, { email: "resettable@clinic.test", password: "bad" }).expect(401);
    }

    // Success clears the recorded failures entirely.
    await login(app, { email: "resettable@clinic.test", password: "good-password" }).expect(200);

    // Fresh budget: six more failures are still allowed afterwards.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await login(app, { email: "resettable@clinic.test", password: "bad" }).expect(401);
    }
    await app.close();
  });

  it("sets the Secure flag when the environment posture requires it", async () => {
    const db = makeFakeDatabase();
    await seedStaff(db, "secure@clinic.test", "pw-123456");
    const { app } = await bootAuthApp(db, { authConfig: { cookieSecure: true } });

    const response = await login(app, {
      email: "secure@clinic.test",
      password: "pw-123456",
    }).expect(200);
    const sessionCookie = (response.headers["set-cookie"] as unknown as string[]).find((entry) =>
      entry.startsWith(`${STAFF_SESSION_COOKIE}=`)
    )!;
    expect(
      sessionCookie
        .split(";")
        .map((part) => part.trim().toLowerCase())
        .includes("secure")
    ).toBe(true);

    await app.close();
  });
});
