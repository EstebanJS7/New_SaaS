import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import supertest from "supertest";
import { PrismaService } from "@newsaas/database";
import type { DomainError } from "@newsaas/shared";
import { AppModule } from "../src/app.module.js";
import { AUTH_CONFIG, readAuthConfig } from "../src/auth/auth.config.js";
import { SessionService } from "../src/auth/session.service.js";
import { STAFF_SESSION_COOKIE } from "../src/auth/session-cookie.js";
import { PORTAL_SESSION_COOKIE } from "../src/portal/portal-session-cookie.js";
import { PortalSessionService } from "../src/portal/portal-session.service.js";
import { AuditWriter } from "../src/audit/audit-writer.service.js";
import { createApiLogger } from "../src/common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../src/common/http/fastify-adapter.factory.js";
import { RequestContextService } from "../src/context/request-context.service.js";
import { PermissionResolver } from "../src/rbac/permission-resolver.service.js";
import {
  AppointmentService,
  type AppointmentPrisma,
} from "../src/scheduling/appointment.service.js";
import { TenantSettingsService } from "../src/settings/tenant-settings.service.js";
import {
  BRANDING_RESET_CLEANUP_PRODUCER,
  type CleanupProducer,
} from "../src/branding/branding-reset-cleanup.producer.js";

interface ErrorEnvelope {
  error: { code: string };
}

/** Allowlisted holder appointment projection returned by the portal writes. */
interface PortalAppointmentBody {
  id: string;
  patientId: string;
  status: string;
  startAt: string;
  endAt: string;
  version: number;
}

const NOT_FOUND_REQUEST_ID = "live-pg-not-found-proof";

/** Server-owned request id pinned on every clinical cross-tenant miss. */
const CLINICAL_NOT_FOUND_REQUEST_ID = "live-pg-clinical-not-found-proof";

interface CustomerDto {
  id: string;
  tenantId: string;
  kind: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  isActive: boolean;
}

interface AddressDto {
  id: string;
  tenantId: string;
  customerId: string;
  line1: string | null;
  isActive: boolean;
}

interface ContactDto {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "EMAIL" | "PHONE";
  value: string;
  isActive: boolean;
}

interface PatientDto {
  id: string;
  tenantId: string;
  name: string;
  speciesId: string;
  breedId: string | null;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  birthDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PatientGuardianDto {
  id: string;
  tenantId: string;
  patientId: string;
  customerId: string;
  isPrimary: boolean;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface SpeciesCatalogEntryDto {
  id: string;
  code: string;
  name: string;
  breeds: { id: string; code: string; name: string }[];
}

/** Allowlisted staff ClinicalEncounter DTO (EPIC-06 WU2A/WU3 contract). */
interface ClinicalEncounterDto {
  id: string;
  tenantId: string;
  patientId: string;
  status: "DRAFT" | "CLOSED";
  version: number;
  reasonForVisit: string | null;
  anamnesis: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  internalNotes: string | null;
  clientSummary: string | null;
  amendsEncounterId: string | null;
  amendmentReason: string | null;
  closedAt: string | null;
  closedByUserProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Exact allowlisted key set of the staff encounter response DTO. */
const CLINICAL_ENCOUNTER_DTO_KEYS = [
  "amendmentReason",
  "amendsEncounterId",
  "anamnesis",
  "clientSummary",
  "closedAt",
  "closedByUserProfileId",
  "createdAt",
  "diagnosis",
  "id",
  "internalNotes",
  "patientId",
  "reasonForVisit",
  "status",
  "tenantId",
  "treatmentPlan",
  "updatedAt",
  "version",
].sort();

/** Exact allowlisted key set of the Patient response DTO (WU3 contract). */
const PATIENT_DTO_KEYS = [
  "birthDate",
  "breedId",
  "createdAt",
  "id",
  "isActive",
  "name",
  "sex",
  "speciesId",
  "tenantId",
  "updatedAt",
].sort();

/**
 * Test-only recording fake for the branding reset cleanup producer. It fulfills
 * the production `CleanupProducer` port without constructing a BullMQ Queue or
 * an ioredis connection, so this suite boots with `REDIS_URL` unset while the
 * real Prisma/PostgreSQL setup and every other provider stay untouched.
 */
interface RecordingCleanupProducer extends CleanupProducer {
  readonly enqueued: string[];
}

function adminDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function createDatabase(baseUrl: string, name: string): void {
  execSync(`psql "${adminDatabaseUrl(baseUrl)}" -c "CREATE DATABASE ${name};"`, {
    stdio: "pipe",
    env: process.env,
  });
}

function dropDatabase(baseUrl: string, name: string): void {
  try {
    execSync(
      `psql "${adminDatabaseUrl(baseUrl)}" -c "DROP DATABASE IF EXISTS ${name} WITH (FORCE);"`,
      { stdio: "pipe", env: process.env }
    );
  } catch {
    // Best-effort cleanup; the test runner may have already torn the container down.
  }
}

function runDatabaseCommand(cwd: string, command: string, databaseUrl: string): void {
  execSync(command, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

function restoreDatabaseUrl(previousDatabaseUrl: string | undefined): void {
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }

  process.env.DATABASE_URL = previousDatabaseUrl;
}

/**
 * Deterministic synchronization barrier for concurrency tests.
 *
 * Polls `pg_stat_activity` until at least `expected` backends are blocked on a
 * lock, then returns. A test holds a row lock on the contended aggregate and
 * only releases it once this resolves, so every racing transaction is provably
 * parked at the same database boundary before any of them can commit — never a
 * timing-based sleep. Throws on timeout so an unproven overlap can never be
 * mistaken for a passing race.
 */
async function waitForLockWaiters(
  prisma: PrismaService,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await prisma.$queryRaw<{ blocked: number }[]>`
      SELECT count(*)::int AS blocked
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `;
    const blocked = rows[0]?.blocked ?? 0;
    if (blocked >= expected) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Concurrency barrier timed out: expected ${expected} blocked sessions, observed ${blocked}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Counts the backends currently blocked on the specific 64-bit PostgreSQL
 * advisory lock `lockKey` — the same key the scheduling service passes to
 * `pg_advisory_xact_lock(hashtextextended(key, 0))`.
 *
 * `pg_locks` exposes a 64-bit advisory lock as `classid` = high 32 bits,
 * `objid` = low 32 bits and `objsubid` = 1; `granted = false` selects waiters
 * (the holder is excluded). Matching on the reconstructed key — rather than
 * only `wait_event_type = 'Lock'` — keeps an unrelated lock waiter (a row lock,
 * or an advisory lock on another professional) from ever satisfying the
 * scheduling barrier.
 */
async function countAdvisoryLockWaiters(prisma: PrismaService, lockKey: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ blocked: number }[]>`
    SELECT count(*)::int AS blocked
    FROM pg_locks AS l
    JOIN pg_stat_activity AS a ON a.pid = l.pid
    CROSS JOIN (SELECT hashtextextended(${lockKey}, 0) AS key) AS wanted
    WHERE l.locktype = 'advisory'
      AND NOT l.granted
      AND l.objsubid = 1
      AND a.datname = current_database()
      AND l.classid::bigint = ((wanted.key >> 32) & 4294967295)
      AND l.objid::bigint = (wanted.key & 4294967295)
  `;
  return rows[0]?.blocked ?? 0;
}

/**
 * Key-scoped synchronization barrier for the scheduling concurrency probe.
 *
 * Polls `pg_locks` until at least `expected` backends are blocked on the
 * scheduling advisory lock key `lockKey`, then returns. Unlike the generic
 * `waitForLockWaiters`, an unrelated database lock waiter cannot satisfy it, so
 * the probe proves the two racing creates are parked on the SAME professional
 * advisory lock before release. Throws on timeout so an unproven overlap can
 * never be mistaken for a passing race.
 */
async function waitForAdvisoryLockWaiters(
  prisma: PrismaService,
  lockKey: string,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const blocked = await countAdvisoryLockWaiters(prisma, lockKey);
    if (blocked >= expected) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Scheduling advisory-lock barrier timed out: expected ${expected} waiters on the "${lockKey}" advisory lock key, observed ${blocked}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Resource-scoped waiter count for the owner-scoped booking-request cancel
 * race: how many backends are parked on the EXACT row identified by
 * `(relation, page, tuple)`.
 *
 * A row-lock waiter is NOT reported as a `pg_locks` entry scoped to the locked
 * relation: it holds a `tuple` lock on the exact `(relation, page, tuple)` it is
 * trying to lock, and then blocks — either on the holder's XID (first waiter:
 * `wait_event = 'transactionid'`, tuple lock GRANTED) or on the tuple lock the
 * first waiter now holds (second waiter: `wait_event = 'tuple'`, tuple lock NOT
 * granted). Counting every backend whose `wait_event_type = 'Lock'` AND that has
 * a `tuple` lock row on that exact tuple therefore names precisely the sessions
 * parked on THAT row, in BOTH positions. An unrelated lock waiter (a row lock
 * elsewhere, an advisory lock, a catalog lock) has no tuple lock on this tuple,
 * so the generic `waitForLockWaiters` over-count can never be satisfied by one.
 *
 * The barrier holder itself is excluded because `SELECT ... FOR UPDATE` registers
 * no heavyweight tuple lock, and a racer that already acquired the row lock is no
 * longer `wait_event_type = 'Lock'`.
 */
async function countBookingRowLockWaiters(
  prisma: PrismaService,
  relation: string,
  page: number,
  tuple: number
): Promise<number> {
  const rows = await prisma.$queryRaw<{ blocked: number }[]>`
    SELECT count(DISTINCT l.pid)::int AS blocked
    FROM pg_locks AS l
    JOIN pg_stat_activity AS a ON a.pid = l.pid
    WHERE a.datname = current_database()
      AND a.wait_event_type = 'Lock'
      AND l.locktype = 'tuple'
      AND l.relation = ${relation}::regclass
      AND l.page = ${page}
      AND l.tuple = ${tuple}
  `;
  return rows[0]?.blocked ?? 0;
}

/**
 * Resource-scoped barrier over {@link countBookingRowLockWaiters}. Throws on
 * timeout so a release can never happen before both cancellations are provably
 * parked on the contended row.
 */
async function waitForBookingRowLockWaiters(
  prisma: PrismaService,
  relation: string,
  page: number,
  tuple: number,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const blocked = await countBookingRowLockWaiters(prisma, relation, page, tuple);
    if (blocked >= expected) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Booking-row lock barrier timed out: expected ${expected} waiters on ${relation} (${page},${tuple}), observed ${blocked}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Physical `ctid` of one booking-request row, decomposed to the `page`/`tuple`
 * pair `pg_locks` reports for a tuple lock. Read while the barrier holds the row
 * lock, so the tuple cannot move under the racers.
 */
async function readBookingRowCtid(
  prisma: PrismaService,
  id: string
): Promise<{ page: number; tuple: number }> {
  const rows = await prisma.$queryRaw<{ page: number; tuple: number }[]>`
    SELECT
      (ctid::text::point)[0]::int AS page,
      (ctid::text::point)[1]::int AS tuple
    FROM portal_booking_request
    WHERE id = ${id}::uuid
  `;
  const ctid = rows[0];
  if (!ctid) {
    throw new Error(`Booking request ${id} vanished before the barrier could lock it`);
  }
  return ctid;
}

/**
 * Forces a provable overlap on the scheduling advisory lock: acquires `lockKey`
 * from a dedicated transaction, starts every racer, waits until `expectedWaiters`
 * backends are parked on THAT key (never an unrelated lock), then releases the
 * barrier and returns the racers' values once every one has settled. Used by the
 * EPIC-08 WU5 portal write races so the interleaving is decided by the database
 * boundary, not by timing, and an unproven overlap fails loudly instead of
 * passing as a sequential race.
 */
async function forceAdvisoryLockRace<T>(
  prisma: PrismaService,
  lockKey: string,
  expectedWaiters: number,
  startRacers: () => readonly Promise<T>[]
): Promise<T[]> {
  let releaseBarrier!: () => void;
  const barrierReleased = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  let signalBarrierReady!: () => void;
  const barrierReady = new Promise<void>((resolve) => {
    signalBarrierReady = resolve;
  });

  const barrierTransaction = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
      signalBarrierReady();
      await barrierReleased;
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
  await barrierReady;

  const racers = startRacers();
  try {
    await waitForAdvisoryLockWaiters(prisma, lockKey, expectedWaiters, 10_000);
  } finally {
    releaseBarrier();
    await barrierTransaction;
  }
  return Promise.all(racers);
}

/**
 * Explicit, human-typed rendering of the COMPLETE predicate both ACTIVE portal
 * partial unique indexes must store. Asserting exact normalized equality
 * against this constant — instead of a permissive substring/regex match —
 * proves the index ignores every non-ACTIVE status AND carries no additional
 * boolean clause masking a wider index than the migration declares.
 */
const ACTIVE_PORTAL_INDEX_PREDICATE = "status='ACTIVE'";

/**
 * Strips only parenthesis pairs enclosing the WHOLE expression, so an extra
 * top-level `(...) AND (...)` clause can never be flattened into the
 * single-term canonical predicate. Quoted string literals are skipped so their
 * content cannot affect nesting depth. Unbalanced input is left untouched.
 */
function stripEnclosingParentheses(value: string): string {
  let result = value;
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let enclosesWhole = true;
    for (let index = 1; index < result.length - 1; index += 1) {
      const char = result[index];
      if (char === "'") {
        // Skip the literal body, honouring doubled-quote escapes, so quoted
        // parentheses can never affect the nesting depth.
        let cursor = index + 1;
        while (cursor <= result.length - 2) {
          if (result[cursor] === "'") {
            if (result[cursor + 1] === "'") {
              cursor += 2;
              continue;
            }
            break;
          }
          cursor += 1;
        }
        index = Math.min(cursor, result.length - 2);
        continue;
      }
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth < 0) {
          enclosesWhole = false;
          break;
        }
      }
    }
    if (!enclosesWhole || depth !== 0) {
      break;
    }
    result = result.slice(1, -1).trim();
  }
  return result;
}

/**
 * Removes whitespace that sits OUTSIDE single-quoted string literals, so
 * spacing-only differences are tolerated while every literal is preserved
 * byte-for-byte. An extra boolean clause always contributes non-whitespace
 * tokens, so this step can never hide one.
 */
function stripFormattingWhitespace(value: string): string {
  let result = "";
  let inLiteral = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (inLiteral && value[index + 1] === "'") {
        result += "''";
        index += 1;
        continue;
      }
      inLiteral = !inLiteral;
      result += char;
      continue;
    }
    if (!inLiteral && /\s/.test(char)) {
      continue;
    }
    result += char;
  }
  return result;
}

/**
 * Normalizes a PostgreSQL index predicate (`pg_get_expr(indpred, indrelid)`)
 * for exact-equality assertion against `ACTIVE_PORTAL_INDEX_PREDICATE`.
 *
 * PostgreSQL renders the stored `WHERE status = 'ACTIVE'` clause as
 * `(status = 'ACTIVE'::text)`: it adds one redundant fully-enclosing
 * parenthesis pair and an explicit, parser-added cast on the string literal.
 * Those two artifacts, plus whitespace, are the ONLY tolerated differences.
 * Any additional boolean term, column, literal or operator survives
 * normalization as a non-whitespace token, so it can never compare equal.
 *
 * The cast matcher is deliberately anchored to a single-token type name and is
 * applied BEFORE whitespace removal, so it stops at `text` and can never
 * swallow a following `AND <column> ...` term.
 */
function normalizeIndexPredicate(predicate: string): string {
  return stripFormattingWhitespace(
    stripEnclosingParentheses(predicate.trim()).replace(
      /(['](?:[^']|'')*['])\s*::\s*[a-z_][a-z0-9_]*(?:\s*\[\s*\])?/gi,
      "$1"
    )
  );
}

const livePgDatabaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

/**
 * Live PostgreSQL application-path isolation evidence (TD-006 EPIC-03/EPIC-04
 * scope). This suite boots the real AppModule against a disposable PostgreSQL
 * database, applies migrations and reference seeds, and proves that the NestJS
 * guard chain + request context + service query paths return byte-equivalent
 * 404 for cross-tenant Customer/Address/Contact mutations and that
 * tenant-relative TenantBranding mutations remain isolated per tenant.
 *
 * Skipped automatically when no PostgreSQL URL is configured (e.g. local unit
 * runs); the CI migrations job supplies DATABASE_URL_TEST.
 */
describe.skipIf(!livePgDatabaseUrl)("live-pg application-path isolation", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let serverUrl: string;
  let baseDatabaseUrl: string;
  let testDatabaseName: string;
  let testDatabaseUrl: string;
  let previousDatabaseUrl: string | undefined;

  let tenantAId: string;
  let tenantBId: string;
  let ownerACookie: string;
  let ownerBCookie: string;
  let customerAId: string;
  let addressAId: string;
  let contactAId: string;

  // EPIC-05 Patient/guardian live-PG state (global taxonomy, guardian
  // Customers, and the Patient created atomically in the create scenario).
  let dogSpeciesId: string;
  let dogBreedId: string | null;
  let guardianCustomerAId: string;
  let guardianCustomerA2Id: string;
  let guardianCustomerA3Id: string;
  let guardianCustomerBId: string;
  let atomicPatientAId: string;
  let atomicGuardianAId: string;

  // Recording fake installed via overrideProvider below. Referenced by the
  // token-identity regression pin, so it must be the exact injected instance.
  const cleanupProducer: RecordingCleanupProducer = {
    enqueued: [],
    enqueue: (intentId: string) => {
      cleanupProducer.enqueued.push(intentId);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    baseDatabaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "";
    if (!baseDatabaseUrl) {
      throw new Error(
        "DATABASE_URL_TEST or DATABASE_URL is required to provision a disposable isolation database"
      );
    }

    testDatabaseName = `newsaas_isolation_${randomUUID().replace(/-/g, "_")}`;
    testDatabaseUrl = baseDatabaseUrl.replace(/\/[^/]*$/, `/${testDatabaseName}`);

    createDatabase(baseDatabaseUrl, testDatabaseName);

    const databasePackage = new URL("../../../packages/database", import.meta.url).pathname;
    runDatabaseCommand(databasePackage, "pnpm db:deploy", testDatabaseUrl);
    runDatabaseCommand(databasePackage, "pnpm db:seed", testDatabaseUrl);

    // PrismaService reads DATABASE_URL when AppModule constructs its client.
    // Point it at the disposable database only for this application boot.
    process.env.DATABASE_URL = testDatabaseUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_CONFIG)
      .useValue({
        ...readAuthConfig(process.env),
        cookieSecure: false,
      })
      .overrideProvider(BRANDING_RESET_CLEANUP_PRODUCER)
      .useValue(cleanupProducer)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter({
        loggerInstance: createApiLogger({ level: "error" }),
      })
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, "127.0.0.1");
    serverUrl = await app.getUrl();

    prisma = app.get(PrismaService);

    const tenantA = await prisma.tenant.create({ data: { slug: "live-a", name: "Tenant A" } });
    const tenantB = await prisma.tenant.create({ data: { slug: "live-b", name: "Tenant B" } });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const ownerRole = await prisma.role.findUnique({ where: { code: "OWNER" } });
    if (!ownerRole) {
      throw new Error("Reference seed did not create OWNER role");
    }

    const ownerA = await prisma.userProfile.create({
      data: { email: "owner-a@live.test", displayName: "Owner A", status: "active" },
    });
    const ownerB = await prisma.userProfile.create({
      data: { email: "owner-b@live.test", displayName: "Owner B", status: "active" },
    });

    await prisma.tenantMembership.create({
      data: {
        tenantId: tenantA.id,
        userProfileId: ownerA.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
    });
    await prisma.tenantMembership.create({
      data: {
        tenantId: tenantB.id,
        userProfileId: ownerB.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
      },
    });

    const sessionService = app.get(SessionService);
    const sessionA = await sessionService.issue(ownerA.id);
    const sessionB = await sessionService.issue(ownerB.id);
    ownerACookie = `${STAFF_SESSION_COOKIE}=${sessionA.token}`;
    ownerBCookie = `${STAFF_SESSION_COOKIE}=${sessionB.token}`;

    const featureCode = await prisma.featureCode.upsert({
      where: { code: "custom_branding" },
      create: { code: "custom_branding" },
      update: {},
    });
    await prisma.tenantEntitlement.upsert({
      where: {
        tenantId_featureCodeId: { tenantId: tenantA.id, featureCodeId: featureCode.id },
      },
      create: { tenantId: tenantA.id, featureCodeId: featureCode.id },
      update: {},
    });
    await prisma.tenantEntitlement.upsert({
      where: {
        tenantId_featureCodeId: { tenantId: tenantB.id, featureCodeId: featureCode.id },
      },
      create: { tenantId: tenantB.id, featureCodeId: featureCode.id },
      update: {},
    });

    // --- EPIC-05 setup: veterinary entitlement, global taxonomy, guardians ---
    // The `veterinary` grant is explicit: plan mappings never grant access, so
    // both tenants must hold a direct tenant_entitlement row.
    const veterinaryFeature = await prisma.featureCode.upsert({
      where: { code: "veterinary" },
      create: { code: "veterinary" },
      update: {},
    });
    for (const tenantId of [tenantA.id, tenantB.id]) {
      await prisma.tenantEntitlement.upsert({
        where: {
          tenantId_featureCodeId: { tenantId, featureCodeId: veterinaryFeature.id },
        },
        create: { tenantId, featureCodeId: veterinaryFeature.id },
        update: {},
      });
    }

    // Global seeded taxonomy: shared by every tenant and never tenant-filtered.
    const dogSpecies = await prisma.species.findUnique({ where: { code: "dog" } });
    if (!dogSpecies) {
      throw new Error("Reference seed did not create the global dog Species");
    }
    dogSpeciesId = dogSpecies.id;
    const mixedBreed = await prisma.breed.findUnique({
      where: { speciesId_code: { speciesId: dogSpecies.id, code: "mixed" } },
    });
    dogBreedId = mixedBreed?.id ?? null;

    // Guardian Customers live in Core and are referenced by id only.
    const guardianCustomerA = await prisma.customer.create({
      data: {
        tenantId: tenantA.id,
        kind: "INDIVIDUAL",
        displayName: "Guardian Customer A",
        firstName: "Guardian",
        lastName: "A",
      },
    });
    guardianCustomerAId = guardianCustomerA.id;
    guardianCustomerA2Id = (
      await prisma.customer.create({
        data: {
          tenantId: tenantA.id,
          kind: "INDIVIDUAL",
          displayName: "Guardian Customer A2",
          firstName: "Guardian",
          lastName: "A2",
        },
      })
    ).id;
    guardianCustomerA3Id = (
      await prisma.customer.create({
        data: {
          tenantId: tenantA.id,
          kind: "INDIVIDUAL",
          displayName: "Guardian Customer A3",
          firstName: "Guardian",
          lastName: "A3",
        },
      })
    ).id;
    guardianCustomerBId = (
      await prisma.customer.create({
        data: {
          tenantId: tenantB.id,
          kind: "INDIVIDUAL",
          displayName: "Guardian Customer B",
          firstName: "Guardian",
          lastName: "B",
        },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    restoreDatabaseUrl(previousDatabaseUrl);
    dropDatabase(baseDatabaseUrl, testDatabaseName);
  }, 30_000);

  it("injects the test-only branding reset cleanup producer", () => {
    // Token-identity pin: the suite must resolve the recording fake, proving the
    // Redis-backed producer factory never ran during AppModule compilation.
    expect(app.get(BRANDING_RESET_CLEANUP_PRODUCER)).toBe(cleanupProducer);
  });

  it("creates tenant A customer/address/contact over real HTTP", async () => {
    const customerResponse = await supertest(serverUrl)
      .post("/customers")
      .set("Cookie", ownerACookie)
      .send({ kind: "INDIVIDUAL", displayName: "Live Customer A" })
      .expect(201);
    const customer = customerResponse.body as CustomerDto;
    customerAId = customer.id;
    expect(customer.tenantId).toBe(tenantAId);

    const addressResponse = await supertest(serverUrl)
      .post(`/customers/${customerAId}/addresses`)
      .set("Cookie", ownerACookie)
      .send({ line1: "Live Address 123" })
      .expect(201);
    const address = addressResponse.body as AddressDto;
    addressAId = address.id;
    expect(address.tenantId).toBe(tenantAId);
    expect(address.customerId).toBe(customerAId);

    const contactResponse = await supertest(serverUrl)
      .post(`/customers/${customerAId}/contacts`)
      .set("Cookie", ownerACookie)
      .send({ kind: "EMAIL", value: "live@example.test" })
      .expect(201);
    const contact = contactResponse.body as ContactDto;
    contactAId = contact.id;
    expect(contact.tenantId).toBe(tenantAId);
    expect(contact.customerId).toBe(customerAId);
  });

  it("returns byte-equivalent 404 for cross-tenant customer mutations and does not mutate tenant A", async () => {
    const before = await prisma.customer.findUnique({ where: { id: customerAId } });
    expect(before).toBeTruthy();
    expect(before?.isActive).toBe(true);

    const cases = [
      {
        label: "PUT /customers/:id",
        request: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ displayName: "Tampered" }),
        missingRequest: () =>
          supertest(serverUrl)
            .put(`/customers/${randomUUID()}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ displayName: "Tampered" }),
      },
      {
        label: "POST /customers/:id/deactivate",
        request: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
        missingRequest: () =>
          supertest(serverUrl)
            .post(`/customers/${randomUUID()}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request().expect(404);
      const missingResponse = await scenario.missingRequest().expect(404);
      const body = response.body as ErrorEnvelope;
      expect(body.error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customer.findUnique({ where: { id: customerAId } });
    expect(after?.displayName).toBe("Live Customer A");
    expect(after?.isActive).toBe(true);
  });

  it("returns byte-equivalent 404 for cross-tenant address mutations and does not mutate tenant A", async () => {
    const before = await prisma.customerAddress.findUnique({ where: { id: addressAId } });
    expect(before?.isActive).toBe(true);

    const cases = [
      {
        label: "PUT address",
        request: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/addresses/${addressAId}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ line1: "Tampered" }),
        missingRequest: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/addresses/${randomUUID()}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ line1: "Tampered" }),
      },
      {
        label: "POST address/deactivate",
        request: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/addresses/${addressAId}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
        missingRequest: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/addresses/${randomUUID()}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request().expect(404);
      const missingResponse = await scenario.missingRequest().expect(404);
      expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customerAddress.findUnique({ where: { id: addressAId } });
    expect(after?.line1).toBe("Live Address 123");
    expect(after?.isActive).toBe(true);
  });

  it("returns byte-equivalent 404 for cross-tenant contact mutations and does not mutate tenant A", async () => {
    const before = await prisma.customerContact.findUnique({ where: { id: contactAId } });
    expect(before?.isActive).toBe(true);

    const cases = [
      {
        label: "PUT contact",
        request: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/contacts/${contactAId}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ value: "tampered@example.test" }),
        missingRequest: () =>
          supertest(serverUrl)
            .put(`/customers/${customerAId}/contacts/${randomUUID()}`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({ value: "tampered@example.test" }),
      },
      {
        label: "POST contact/deactivate",
        request: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/contacts/${contactAId}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
        missingRequest: () =>
          supertest(serverUrl)
            .post(`/customers/${customerAId}/contacts/${randomUUID()}/deactivate`)
            .set("Cookie", ownerBCookie)
            .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
            .send({}),
      },
    ];

    for (const scenario of cases) {
      const response = await scenario.request().expect(404);
      const missingResponse = await scenario.missingRequest().expect(404);
      expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
      expect(response.text, scenario.label).toBe(missingResponse.text);
    }

    const after = await prisma.customerContact.findUnique({ where: { id: contactAId } });
    expect(after?.value).toBe("live@example.test");
    expect(after?.isActive).toBe(true);
  });

  it("tenant-relative authorized branding mutation succeeds for each tenant without affecting the other", async () => {
    const aResponse = await supertest(serverUrl)
      .put("/branding/current")
      .set("Cookie", ownerACookie)
      .send({ overrides: { schemaVersion: 1, primary: "#0ea5e9" } })
      .expect(200);
    const aBrand = aResponse.body as {
      source: string;
      brand: { theme: { colors: { primary: string } } };
    };
    expect(aBrand.source).toBe("tenant");
    expect(aBrand.brand.theme.colors.primary).toBe("#0ea5e9");

    const bResponse = await supertest(serverUrl)
      .put("/branding/current")
      .set("Cookie", ownerBCookie)
      .send({ overrides: { schemaVersion: 1, primary: "#ef4444" } })
      .expect(200);
    const bBrand = bResponse.body as {
      source: string;
      brand: { theme: { colors: { primary: string } } };
    };
    expect(bBrand.source).toBe("tenant");
    expect(bBrand.brand.theme.colors.primary).toBe("#ef4444");

    const aRow = await prisma.tenantBranding.findUnique({ where: { tenantId: tenantAId } });
    const bRow = await prisma.tenantBranding.findUnique({ where: { tenantId: tenantBId } });
    expect((aRow?.overrides as Record<string, unknown>).primary).toBe("#0ea5e9");
    expect((bRow?.overrides as Record<string, unknown>).primary).toBe("#ef4444");
  });

  /**
   * EPIC-05 Patient application-path evidence (H1 hardening, task 5.1).
   *
   * Proves over real HTTP + real PostgreSQL that atomic Patient create/activate,
   * the global catalog, byte-equivalent cross-tenant masking, and the
   * exactly-one-active-primary invariant hold at the application boundary — the
   * gap the in-memory harness (TD-006) cannot close.
   */
  describe("EPIC-05 patient application-path isolation", () => {
    const countActivePrimaries = (patientId: string): Promise<number> =>
      prisma.patientGuardian.count({
        where: { patientId, isPrimary: true, isActive: true },
      });

    const createActivePatient = async (name: string): Promise<PatientDto> => {
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name,
          speciesId: dogSpeciesId,
          breedId: dogBreedId,
          sex: "FEMALE",
          primaryGuardianCustomerId: guardianCustomerAId,
        })
        .expect(201);
      return response.body as PatientDto;
    };

    it("serves the same global Species/Breed catalog to every entitled tenant", async () => {
      const aResponse = await supertest(serverUrl)
        .get("/patients/catalog")
        .set("Cookie", ownerACookie)
        .expect(200);
      const bResponse = await supertest(serverUrl)
        .get("/patients/catalog")
        .set("Cookie", ownerBCookie)
        .expect(200);

      // Identical bytes: the taxonomy is global and never tenant-filtered.
      expect(aResponse.text).toBe(bResponse.text);

      const catalog = aResponse.body as SpeciesCatalogEntryDto[];
      const dog = catalog.find((entry) => entry.id === dogSpeciesId);
      expect(dog?.code).toBe("dog");
      expect(dog?.breeds.map((breed) => breed.code)).toEqual(
        expect.arrayContaining(["mixed", "labrador_retriever"])
      );
      // No tenant-private data is joined into the shared catalog DTO.
      expect(aResponse.text).not.toContain(tenantAId);
      expect(aResponse.text).not.toContain(tenantBId);
    });

    it("atomically creates an active Patient with exactly one primary guardian and co-committed audit", async () => {
      const requestId = "live-pg-patient-atomic-create";
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({
          name: "Live Atomic Patient",
          speciesId: dogSpeciesId,
          breedId: dogBreedId,
          sex: "FEMALE",
          primaryGuardianCustomerId: guardianCustomerAId,
        })
        .expect(201);

      const patient = response.body as PatientDto;
      atomicPatientAId = patient.id;
      expect(patient.tenantId).toBe(tenantAId);
      expect(patient.isActive).toBe(true);

      // Allowlisted DTO: no Prisma internals and no primaryGuardianCustomerId.
      expect(Object.keys(patient).sort()).toEqual(PATIENT_DTO_KEYS);
      expect(
        (patient as unknown as Record<string, unknown>).primaryGuardianCustomerId
      ).toBeUndefined();

      const guardians = await prisma.patientGuardian.findMany({
        where: { tenantId: tenantAId, patientId: patient.id },
      });
      expect(guardians).toHaveLength(1);
      atomicGuardianAId = guardians[0].id;
      expect(guardians[0].customerId).toBe(guardianCustomerAId);
      expect(guardians[0].isPrimary).toBe(true);
      expect(guardians[0].isActive).toBe(true);

      // The Patient row and its primary link committed in one transaction, and
      // both audit rows share the server-owned request id.
      const auditRows = await prisma.auditLog.findMany({
        where: { requestId, tenantId: tenantAId },
      });
      expect(auditRows.map((row) => row.action).sort()).toEqual([
        "patient.created",
        "patient_guardian.created",
      ]);
      expect(auditRows.every((row) => row.targetId !== null)).toBe(true);
    });

    it("rejects an active Patient create without a primary guardian and persists nothing", async () => {
      const before = await prisma.patient.count({ where: { tenantId: tenantAId } });
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({ name: "No Guardian", speciesId: dogSpeciesId, sex: "UNKNOWN" })
        .expect(400);
      expect((response.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
      const after = await prisma.patient.count({ where: { tenantId: tenantAId } });
      expect(after).toBe(before);
    });

    it("activates an inactive Patient by establishing exactly one primary guardian", async () => {
      const created = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name: "Live Inactive To Activate",
          speciesId: dogSpeciesId,
          sex: "MALE",
          isActive: false,
        })
        .expect(201);
      const patient = created.body as PatientDto;
      expect(patient.isActive).toBe(false);
      expect(await countActivePrimaries(patient.id)).toBe(0);

      const activated = await supertest(serverUrl)
        .put(`/patients/${patient.id}`)
        .set("Cookie", ownerACookie)
        .send({ isActive: true, primaryGuardianCustomerId: guardianCustomerAId })
        .expect(200);
      expect((activated.body as PatientDto).isActive).toBe(true);
      expect(await countActivePrimaries(patient.id)).toBe(1);
    });

    it("returns 409 when activating without a primary guardian and keeps the Patient inactive", async () => {
      const created = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name: "Live Inactive No Guardian",
          speciesId: dogSpeciesId,
          sex: "UNKNOWN",
          isActive: false,
        })
        .expect(201);
      const patient = created.body as PatientDto;

      const response = await supertest(serverUrl)
        .put(`/patients/${patient.id}`)
        .set("Cookie", ownerACookie)
        .send({ isActive: true })
        .expect(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");

      const row = await prisma.patient.findUnique({ where: { id: patient.id } });
      expect(row?.isActive).toBe(false);
      expect(await countActivePrimaries(patient.id)).toBe(0);
    });

    it("swaps the primary guardian in one transaction and keeps exactly one", async () => {
      const patient = await createActivePatient("Live Primary Swap");
      const linked = await supertest(serverUrl)
        .post(`/patients/${patient.id}/guardians`)
        .set("Cookie", ownerACookie)
        .send({ customerId: guardianCustomerA2Id, isPrimary: false })
        .expect(201);
      const secondary = linked.body as PatientGuardianDto;

      await supertest(serverUrl)
        .post(`/patients/${patient.id}/guardians/${secondary.id}/primary`)
        .set("Cookie", ownerACookie)
        .expect(201);

      const primaries = await prisma.patientGuardian.findMany({
        where: { patientId: patient.id, isPrimary: true, isActive: true },
      });
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(secondary.id);
      expect(primaries[0].customerId).toBe(guardianCustomerA2Id);
    });

    it("masks cross-tenant Patient mutations as byte-equivalent 404 and leaves tenant A unchanged", async () => {
      const before = await prisma.patient.findUnique({ where: { id: atomicPatientAId } });
      expect(before?.isActive).toBe(true);

      const cases = [
        {
          label: "GET patient",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
        },
        {
          label: "PUT patient",
          request: () =>
            supertest(serverUrl)
              .put(`/patients/${atomicPatientAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({ name: "Tampered" }),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/patients/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({ name: "Tampered" }),
        },
        {
          label: "POST patient/deactivate",
          request: () =>
            supertest(serverUrl)
              .post(`/patients/${atomicPatientAId}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/patients/${randomUUID()}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(tenantAId);
      }

      const after = await prisma.patient.findUnique({ where: { id: atomicPatientAId } });
      expect(after?.name).toBe(before?.name);
      expect(after?.isActive).toBe(true);
    });

    it("rejects a cross-tenant guardian Customer with 404 and persists nothing", async () => {
      const before = await prisma.patient.count({ where: { tenantId: tenantAId } });
      const response = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
        .send({
          name: "Cross Tenant Guardian",
          speciesId: dogSpeciesId,
          sex: "UNKNOWN",
          primaryGuardianCustomerId: guardianCustomerBId,
        })
        .expect(404);
      expect((response.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect(response.text).not.toContain(guardianCustomerBId);
      const after = await prisma.patient.count({ where: { tenantId: tenantAId } });
      expect(after).toBe(before);
    });

    it("masks cross-tenant guardian reads and promotion as byte-equivalent 404", async () => {
      const cases = [
        {
          label: "GET guardian list",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}/guardians`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${randomUUID()}/guardians`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
        },
        {
          label: "GET guardian",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}/guardians/${atomicGuardianAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${atomicPatientAId}/guardians/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID),
        },
        {
          label: "POST guardian/primary",
          request: () =>
            supertest(serverUrl)
              .post(`/patients/${atomicPatientAId}/guardians/${atomicGuardianAId}/primary`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/patients/${atomicPatientAId}/guardians/${randomUUID()}/primary`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", NOT_FOUND_REQUEST_ID)
              .send({}),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(atomicPatientAId);
        expect(response.text, scenario.label).not.toContain(atomicGuardianAId);
      }
    });

    it("forces an overlapping primary-promotion race at the demote boundary and keeps exactly one primary", async () => {
      const patient = await createActivePatient("Live Concurrency Primary");
      const second = (
        await supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians`)
          .set("Cookie", ownerACookie)
          .send({ customerId: guardianCustomerA2Id, isPrimary: false })
          .expect(201)
      ).body as PatientGuardianDto;
      const third = (
        await supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians`)
          .set("Cookie", ownerACookie)
          .send({ customerId: guardianCustomerA3Id, isPrimary: false })
          .expect(201)
      ).body as PatientGuardianDto;

      const currentPrimary = await prisma.patientGuardian.findFirst({
        where: { tenantId: tenantAId, patientId: patient.id, isPrimary: true, isActive: true },
      });
      if (!currentPrimary) {
        throw new Error("Expected the freshly created Patient to have an active primary guardian");
      }

      // Deterministic overlap mechanism: hold an exclusive row lock on the
      // current primary guardian from a dedicated transaction, then start both
      // promotions. Each promotion must run `demoteActivePrimary` BEFORE it can
      // promote its own target, so both ride the same contended UPDATE and park
      // there until this barrier is released. `waitForLockWaiters` proves both
      // are actually blocked at that boundary before release; there is no
      // sleep-based timing assumption and no dependence on the event-loop
      // scheduling of `Promise.all`.
      let releaseBarrier!: () => void;
      const barrierReleased = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let signalBarrierReady!: () => void;
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });

      const barrierTransaction = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "patient_guardian"
            WHERE "id" = ${currentPrimary.id}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );

      await barrierReady;

      // `.then` both dispatches the HTTP request and returns a promise for its
      // response, so BOTH promotions are already in flight before the barrier
      // wait below; they are awaited only after the overlap is proven.
      const promotions = [
        supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians/${second.id}/primary`)
          .set("Cookie", ownerACookie),
        supertest(serverUrl)
          .post(`/patients/${patient.id}/guardians/${third.id}/primary`)
          .set("Cookie", ownerACookie),
      ].map((request) => request.then((response) => response));

      try {
        await waitForLockWaiters(prisma, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      // With a proven overlap on the same demote row, the partial unique index
      // admits exactly one promotion: the other transaction's promotion UPDATE
      // raises Prisma P2002 on `patient_guardian_primary_active_key`.
      const results = await Promise.all(promotions);
      const successes = results.filter((result) => result.status >= 200 && result.status < 300);
      const failures = results.filter((result) => result.status >= 300);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // Truthful current error surface: the P2002 loser is mapped by the global
      // filter to 500 INTERNAL, not 409 CONFLICT. Mapping this race to CONFLICT
      // is TD-011; this assertion pins the observed behavior until then.
      expect(failures[0].status).toBe(500);
      expect((failures[0].body as ErrorEnvelope).error.code).toBe("INTERNAL");

      const winnerIndex = results.findIndex(
        (result) => result.status >= 200 && result.status < 300
      );
      const winnerGuardianId = winnerIndex === 0 ? second.id : third.id;

      // The invariant survives the race: exactly one active primary, and it is
      // the winner's guardian — never the loser's, never zero, never two.
      const primaries = await prisma.patientGuardian.findMany({
        where: { patientId: patient.id, isPrimary: true, isActive: true },
      });
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(winnerGuardianId);
    }, 20_000);
  });

  /**
   * EPIC-06 clinical application-path evidence (WU5, task 5.1).
   *
   * Closes the TD-006 gap the in-memory WU3 harness cannot: over real HTTP and
   * real PostgreSQL this proves the clinical migration's DB-level invariants at
   * the encounter level (CLOSED immutability, encounter no hard delete), the
   * tenant-scoped aggregate path, byte-equivalent cross-tenant 404 for foreign
   * Patient anchors and foreign encounter/record UUIDs, negative cross-tenant
   * amendment behavior (no amendment row, no audit row, own and foreign
   * originals untouched), and that two parallel autosaves of one DRAFT produce
   * exactly one success and one 409 CONFLICT. The five subdomain no-delete
   * triggers are pinned statically by the WU1 schema migration test, not
   * live-executed here.
   */
  describe("EPIC-06 clinical application-path isolation", () => {
    let clinicalPatientAId: string;
    let clinicalPatientBId: string;
    let clinicalDraftAId: string;
    let clinicalClosedAId: string;
    let clinicalClosedBId: string;
    let clinicalVaccinationBId: string;

    const createEncounter = async (
      cookie: string,
      patientId: string,
      body: Record<string, unknown> = {}
    ): Promise<ClinicalEncounterDto> => {
      const response = await supertest(serverUrl)
        .post(`/patients/${patientId}/clinical/encounters`)
        .set("Cookie", cookie)
        .send(body)
        .expect(201);
      return response.body as ClinicalEncounterDto;
    };

    const closeEncounter = async (
      cookie: string,
      patientId: string,
      id: string,
      version: number
    ): Promise<ClinicalEncounterDto> => {
      const response = await supertest(serverUrl)
        .post(`/patients/${patientId}/clinical/encounters/${id}/close`)
        .set("Cookie", cookie)
        .send({ version })
        .expect(201);
      return response.body as ClinicalEncounterDto;
    };

    beforeAll(async () => {
      const patientA = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerACookie)
        .send({
          name: "Live Clinical Patient A",
          speciesId: dogSpeciesId,
          breedId: dogBreedId,
          sex: "FEMALE",
          primaryGuardianCustomerId: guardianCustomerAId,
        })
        .expect(201);
      clinicalPatientAId = (patientA.body as PatientDto).id;

      const patientB = await supertest(serverUrl)
        .post("/patients")
        .set("Cookie", ownerBCookie)
        .send({
          name: "Live Clinical Patient B",
          speciesId: dogSpeciesId,
          breedId: dogBreedId,
          sex: "MALE",
          primaryGuardianCustomerId: guardianCustomerBId,
        })
        .expect(201);
      clinicalPatientBId = (patientB.body as PatientDto).id;

      // Draft kept at version 1 for the autosave evidence.
      clinicalDraftAId = (
        await createEncounter(ownerACookie, clinicalPatientAId, {
          reasonForVisit: "Live checkup",
          internalNotes: "Staff-only note",
          clientSummary: "Client-safe summary",
        })
      ).id;

      // Closed tenant A encounter: immutability + positive/negative amendment.
      const toCloseA = await createEncounter(ownerACookie, clinicalPatientAId, {
        reasonForVisit: "Close me",
      });
      await closeEncounter(ownerACookie, clinicalPatientAId, toCloseA.id, toCloseA.version);
      clinicalClosedAId = toCloseA.id;

      // Closed tenant B encounter: foreign aggregate UUID target.
      const toCloseB = await createEncounter(ownerBCookie, clinicalPatientBId, {
        reasonForVisit: "Tenant B close",
      });
      await closeEncounter(ownerBCookie, clinicalPatientBId, toCloseB.id, toCloseB.version);
      clinicalClosedBId = toCloseB.id;

      // Tenant B specialized record: foreign record UUID target.
      const vaccinationB = await supertest(serverUrl)
        .post(`/patients/${clinicalPatientBId}/clinical/vaccinations`)
        .set("Cookie", ownerBCookie)
        .send({ vaccine: "Rabies", administeredAt: new Date().toISOString() })
        .expect(201);
      clinicalVaccinationBId = (vaccinationB.body as { id: string }).id;
    }, 60_000);

    it("returns the allowlisted staff encounter DTO and advances the version on autosave", async () => {
      const list = await supertest(serverUrl)
        .get(`/patients/${clinicalPatientAId}/clinical/encounters`)
        .set("Cookie", ownerACookie)
        .expect(200);
      const draft = (list.body as ClinicalEncounterDto[]).find(
        (encounter) => encounter.id === clinicalDraftAId
      );
      expect(draft).toBeTruthy();
      expect(Object.keys(draft!).sort()).toEqual(CLINICAL_ENCOUNTER_DTO_KEYS);

      const requestId = "live-pg-clinical-autosave";
      const autosaved = await supertest(serverUrl)
        .put(`/patients/${clinicalPatientAId}/clinical/encounters/${clinicalDraftAId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({ version: 1, diagnosis: "Live diagnosis" })
        .expect(200);
      const body = autosaved.body as ClinicalEncounterDto;
      expect(body.version).toBe(2);
      expect(body.diagnosis).toBe("Live diagnosis");
      // The staff DTO carries the CONFIDENTIAL staff-only note (WU3 strips it
      // only from client-safe projections, which the Portal does not consume).
      expect(body.internalNotes).toBe("Staff-only note");

      const audit = await prisma.auditLog.findMany({ where: { requestId, tenantId: tenantAId } });
      expect(audit.map((row) => row.action)).toEqual(["clinical_encounter.updated"]);
      expect(audit[0].targetId).toBe(clinicalDraftAId);
    });

    it("enforces CLOSED immutability and no hard delete at the live database trigger", async () => {
      const before = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalClosedAId },
      });
      expect(before?.status).toBe("CLOSED");

      await expect(
        prisma.$executeRaw`UPDATE "clinical_encounter" SET "diagnosis" = 'tampered' WHERE "id" = ${clinicalClosedAId}::uuid`
      ).rejects.toThrow(/immutable/);

      await expect(
        prisma.$executeRaw`DELETE FROM "clinical_encounter" WHERE "id" = ${clinicalClosedAId}::uuid`
      ).rejects.toThrow(/cannot be hard-deleted/);

      const after = await prisma.clinicalEncounter.findUnique({ where: { id: clinicalClosedAId } });
      expect(after).toEqual(before);
    });

    it("creates a linked audited amendment and leaves the original closed encounter unchanged", async () => {
      const originalBefore = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalClosedAId },
      });
      const requestId = "live-pg-clinical-amendment";
      const amended = await supertest(serverUrl)
        .post(`/patients/${clinicalPatientAId}/clinical/encounters/${clinicalClosedAId}/amendments`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({ reason: "Corrected dosage", content: { diagnosis: "Amended diagnosis" } })
        .expect(201);
      const amendment = amended.body as ClinicalEncounterDto;

      expect(amendment.status).toBe("CLOSED");
      expect(amendment.amendsEncounterId).toBe(clinicalClosedAId);
      expect(amendment.amendmentReason).toBe("Corrected dosage");
      expect(amendment.diagnosis).toBe("Amended diagnosis");
      // Unspecified content is copied from the original, never dropped.
      expect(amendment.reasonForVisit).toBe(originalBefore?.reasonForVisit);

      const originalAfter = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalClosedAId },
      });
      expect(originalAfter).toEqual(originalBefore);

      const audit = await prisma.auditLog.findMany({ where: { requestId, tenantId: tenantAId } });
      expect(audit.map((row) => row.action)).toEqual(["clinical_encounter.amended"]);
      expect(audit[0].targetId).toBe(amendment.id);
    });

    it("masks a cross-tenant Patient anchor as byte-equivalent 404 and persists nothing", async () => {
      const encountersBefore = await prisma.clinicalEncounter.count({
        where: { tenantId: tenantAId },
      });
      const draftBefore = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalDraftAId },
      });

      const cases = [
        {
          label: "GET encounters",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${clinicalPatientAId}/clinical/encounters`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${randomUUID()}/clinical/encounters`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID),
        },
        {
          label: "POST encounter",
          request: () =>
            supertest(serverUrl)
              .post(`/patients/${clinicalPatientAId}/clinical/encounters`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ reasonForVisit: "Tampered" }),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/patients/${randomUUID()}/clinical/encounters`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ reasonForVisit: "Tampered" }),
        },
        {
          label: "GET vaccinations",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${clinicalPatientAId}/clinical/vaccinations`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${randomUUID()}/clinical/vaccinations`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(clinicalPatientAId);
      }

      // Nothing persisted for tenant A and no audit row was appended.
      expect(await prisma.clinicalEncounter.count({ where: { tenantId: tenantAId } })).toBe(
        encountersBefore
      );
      expect(
        await prisma.clinicalEncounter.findUnique({ where: { id: clinicalDraftAId } })
      ).toEqual(draftBefore);
      expect(
        await prisma.auditLog.findMany({
          where: { requestId: CLINICAL_NOT_FOUND_REQUEST_ID, tenantId: tenantAId },
        })
      ).toHaveLength(0);
    });

    it("masks a cross-tenant encounter UUID as byte-equivalent 404 through the caller's own Patient", async () => {
      const foreignBefore = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalClosedBId },
      });

      const cases = [
        {
          label: "GET foreign encounter",
          request: () =>
            supertest(serverUrl)
              .get(`/patients/${clinicalPatientAId}/clinical/encounters/${clinicalClosedBId}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/patients/${clinicalPatientAId}/clinical/encounters/${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID),
        },
        {
          label: "PUT foreign autosave",
          request: () =>
            supertest(serverUrl)
              .put(`/patients/${clinicalPatientAId}/clinical/encounters/${clinicalClosedBId}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ version: 1, diagnosis: "Tampered" }),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/patients/${clinicalPatientAId}/clinical/encounters/${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ version: 1, diagnosis: "Tampered" }),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(clinicalClosedBId);
      }

      expect(
        await prisma.clinicalEncounter.findUnique({ where: { id: clinicalClosedBId } })
      ).toEqual(foreignBefore);
      expect(
        await prisma.auditLog.findMany({
          where: { requestId: CLINICAL_NOT_FOUND_REQUEST_ID, tenantId: tenantAId },
        })
      ).toHaveLength(0);
    });

    it("rejects a cross-tenant amendment with 404 and appends no amendment or audit row", async () => {
      const originalBefore = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalClosedAId },
      });
      const foreignBefore = await prisma.clinicalEncounter.findUnique({
        where: { id: clinicalClosedBId },
      });
      expect(foreignBefore).not.toBeNull();
      expect(foreignBefore?.status).toBe("CLOSED");
      const foreignEncounterCountBefore = await prisma.clinicalEncounter.count({
        where: { tenantId: tenantBId },
      });
      const amendmentsBefore = await prisma.clinicalEncounter.count({
        where: { tenantId: tenantBId, amendsEncounterId: clinicalClosedBId },
      });

      const cases = [
        {
          label: "amend foreign encounter via own Patient",
          request: () =>
            supertest(serverUrl)
              .post(
                `/patients/${clinicalPatientAId}/clinical/encounters/${clinicalClosedBId}/amendments`
              )
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ reason: "Tampered cross-tenant" }),
          missingRequest: () =>
            supertest(serverUrl)
              .post(
                `/patients/${clinicalPatientAId}/clinical/encounters/${randomUUID()}/amendments`
              )
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ reason: "Tampered cross-tenant" }),
        },
        {
          label: "amend through a foreign Patient anchor",
          request: () =>
            supertest(serverUrl)
              .post(
                `/patients/${clinicalPatientBId}/clinical/encounters/${clinicalClosedAId}/amendments`
              )
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ reason: "Tampered cross-tenant" }),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/patients/${randomUUID()}/clinical/encounters/${clinicalClosedAId}/amendments`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
              .send({ reason: "Tampered cross-tenant" }),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(response.text, scenario.label).toBe(missingResponse.text);
      }

      // Exact before/after DB assertions: no amendment row was inserted for the
      // foreign original (tenant B), neither the foreign original nor the own
      // original (tenant A) was mutated, no other tenant B encounter was
      // created, and no audit row was appended for either tenant.
      expect(
        await prisma.clinicalEncounter.count({
          where: { tenantId: tenantBId, amendsEncounterId: clinicalClosedBId },
        })
      ).toBe(amendmentsBefore);
      expect(
        await prisma.clinicalEncounter.count({ where: { amendsEncounterId: clinicalClosedBId } })
      ).toBe(0);
      expect(
        await prisma.clinicalEncounter.findUnique({ where: { id: clinicalClosedBId } })
      ).toEqual(foreignBefore);
      expect(await prisma.clinicalEncounter.count({ where: { tenantId: tenantBId } })).toBe(
        foreignEncounterCountBefore
      );
      expect(
        await prisma.clinicalEncounter.findUnique({ where: { id: clinicalClosedAId } })
      ).toEqual(originalBefore);
      expect(
        await prisma.auditLog.findMany({
          where: { requestId: CLINICAL_NOT_FOUND_REQUEST_ID, tenantId: tenantBId },
        })
      ).toHaveLength(0);
      expect(
        await prisma.auditLog.findMany({ where: { requestId: CLINICAL_NOT_FOUND_REQUEST_ID } })
      ).toHaveLength(0);
    });

    it("masks a cross-tenant specialized-record update as byte-equivalent 404 and persists nothing", async () => {
      const foreignBefore = await prisma.clinicalVaccination.findUnique({
        where: { id: clinicalVaccinationBId },
      });

      const response = await supertest(serverUrl)
        .put(`/patients/${clinicalPatientAId}/clinical/vaccinations/${clinicalVaccinationBId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
        .send({ vaccine: "Tampered" })
        .expect(404);
      const missingResponse = await supertest(serverUrl)
        .put(`/patients/${clinicalPatientAId}/clinical/vaccinations/${randomUUID()}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", CLINICAL_NOT_FOUND_REQUEST_ID)
        .send({ vaccine: "Tampered" })
        .expect(404);

      expect((response.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect(response.text).toBe(missingResponse.text);
      expect(response.text).not.toContain(clinicalVaccinationBId);
      expect(
        await prisma.clinicalVaccination.findUnique({ where: { id: clinicalVaccinationBId } })
      ).toEqual(foreignBefore);
    });

    it("serializes parallel autosaves into one success and one 409 CONFLICT", async () => {
      const created = await createEncounter(ownerACookie, clinicalPatientAId, {
        reasonForVisit: "Concurrent autosave",
      });
      expect(created.version).toBe(1);
      const requestId = "live-pg-clinical-concurrent-autosave";

      // Deterministic overlap: hold a row lock on the DRAFT encounter, then
      // start both autosaves. Each runs `updateMany(status=DRAFT, version=1)`,
      // so both park on the same contended row; `waitForLockWaiters` proves
      // both are actually blocked before either can commit.
      let releaseBarrier!: () => void;
      const barrierReleased = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let signalBarrierReady!: () => void;
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });

      const barrierTransaction = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "clinical_encounter"
            WHERE "id" = ${created.id}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );

      await barrierReady;

      const autosaves = [
        supertest(serverUrl)
          .put(`/patients/${clinicalPatientAId}/clinical/encounters/${created.id}`)
          .set("Cookie", ownerACookie)
          .set("X-Request-Id", requestId)
          .send({ version: 1, diagnosis: "Writer one" }),
        supertest(serverUrl)
          .put(`/patients/${clinicalPatientAId}/clinical/encounters/${created.id}`)
          .set("Cookie", ownerACookie)
          .set("X-Request-Id", requestId)
          .send({ version: 1, diagnosis: "Writer two" }),
      ].map((request) => request.then((response) => response));

      try {
        await waitForLockWaiters(prisma, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const results = await Promise.all(autosaves);
      const successes = results.filter((result) => result.status >= 200 && result.status < 300);
      const conflicts = results.filter((result) => result.status === 409);
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect((conflicts[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");

      // The version advanced exactly once, the winner's content is the stored
      // one, and exactly one co-committed audit row exists.
      const stored = await prisma.clinicalEncounter.findUnique({ where: { id: created.id } });
      expect(stored?.version).toBe(2);
      expect(["Writer one", "Writer two"]).toContain(stored?.diagnosis);
      const audit = await prisma.auditLog.findMany({
        where: { requestId, tenantId: tenantAId, action: "clinical_encounter.updated" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].targetId).toBe(created.id);
    }, 20_000);
  });

  /**
   * EPIC-07 scheduling WU2 concurrency evidence (task 2.5, executed by WU5 5.1).
   *
   * Proves at the SERVICE boundary over real PostgreSQL that two concurrent
   * overlapping creates for the same professional cannot both persist: the
   * `pg_advisory_xact_lock` serializes them, so one commits and the other
   * observes the committed row and returns 409 CONFLICT. A deterministic barrier
   * holds the same advisory lock first, and `waitForAdvisoryLockWaiters` proves
   * both creates are parked on that exact lock key before release (never a
   * timing assumption, and never an unrelated lock waiter). WU3 routes do not
   * exist yet, so the service is constructed from the booted app's providers
   * rather than over HTTP; the durable HTTP-level race stays WU5-owned.
   */
  describe("EPIC-07 scheduling application-path concurrency", () => {
    let scheduleBranchId: string;
    let schedulePatientId: string;
    let scheduleProfessionalMembershipId: string;
    let actingMembershipId: string;
    let actingRoleId: string;
    let actingUserProfileId: string;
    let scheduleContext: RequestContextService;
    let scheduleService: AppointmentService;

    beforeAll(async () => {
      const ownerProfile = await prisma.userProfile.findUnique({
        where: { email: "owner-a@live.test" },
      });
      if (!ownerProfile) {
        throw new Error("Reference setup did not create owner A's profile");
      }
      actingUserProfileId = ownerProfile.id;

      // Acting context is OWNER: `scheduling.appointment.manage` is required to
      // create, and VETERINARIAN holds only read/transition.
      const ownerMembership = await prisma.tenantMembership.findFirst({
        where: { tenantId: tenantAId, userProfileId: ownerProfile.id },
      });
      if (!ownerMembership) {
        throw new Error("Reference setup did not create owner A's membership");
      }
      actingMembershipId = ownerMembership.id;
      actingRoleId = ownerMembership.roleId;

      // Created inactive: the deferred `patient_exactly_one_primary_guardian`
      // trigger (Decision #2210) rejects an ACTIVE Patient with zero active
      // primary guardians. Scheduling only needs an in-tenant Patient anchor
      // (existence, not activity), so an inactive Patient is the minimal,
      // faithful fixture and keeps this race setup free of guardian plumbing.
      const patient = await prisma.patient.create({
        data: {
          tenantId: tenantAId,
          name: "Live Schedule Patient",
          speciesId: dogSpeciesId,
          sex: "UNKNOWN",
          isActive: false,
        },
      });
      schedulePatientId = patient.id;

      const branch = await prisma.branch.create({
        data: { tenantId: tenantAId, name: "Live Schedule Branch" },
      });
      scheduleBranchId = branch.id;

      const veterinarianRole = await prisma.role.findUnique({ where: { code: "VETERINARIAN" } });
      if (!veterinarianRole) {
        throw new Error("Reference seed did not create the VETERINARIAN role");
      }
      const veterinarianProfile = await prisma.userProfile.create({
        data: {
          email: "vet-schedule-live@live.test",
          displayName: "Schedule Vet",
          status: "active",
        },
      });
      const professional = await prisma.tenantMembership.create({
        data: {
          tenantId: tenantAId,
          userProfileId: veterinarianProfile.id,
          roleId: veterinarianRole.id,
          status: "ACTIVE",
        },
      });
      scheduleProfessionalMembershipId = professional.id;

      scheduleContext = app.get(RequestContextService);
      scheduleService = new AppointmentService(
        // The generated client's overloaded `$transaction` is structurally
        // compatible with the narrow boundary contract; the cast is the same
        // seam the service uses for its DI token.
        prisma as unknown as AppointmentPrisma,
        scheduleContext,
        app.get(PermissionResolver),
        app.get(AuditWriter),
        app.get(TenantSettingsService)
      );
    }, 60_000);

    it("serializes two concurrent overlapping creates into one success and one 409 CONFLICT", async () => {
      const runCreate = (startAt: string, endAt: string): Promise<unknown> =>
        scheduleContext.run(`req-${randomUUID()}`, () => {
          scheduleContext.setUserProfileId(actingUserProfileId);
          scheduleContext.setTenantMembership({
            tenantId: tenantAId,
            membershipId: actingMembershipId,
            roleId: actingRoleId,
            roleCode: "OWNER",
          });
          return scheduleService.createAppointment({
            branchId: scheduleBranchId,
            patientId: schedulePatientId,
            professionalMembershipId: scheduleProfessionalMembershipId,
            startAt,
            endAt,
          });
        });

      // Deterministic barrier: hold the SAME professional advisory lock from a
      // dedicated transaction, then start both creates. Each create blocks at
      // its own `pg_advisory_xact_lock`; `waitForAdvisoryLockWaiters` proves
      // both waiters are parked on that exact advisory lock key before the
      // barrier is released.
      let releaseBarrier!: () => void;
      const barrierReleased = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let signalBarrierReady!: () => void;
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });

      const lockKey = `${tenantAId}:${scheduleProfessionalMembershipId}`;
      const barrierTransaction = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );

      await barrierReady;

      const creates = [
        runCreate("2026-09-14T12:00:00.000Z", "2026-09-14T12:30:00.000Z"),
        runCreate("2026-09-14T12:15:00.000Z", "2026-09-14T12:45:00.000Z"),
      ];

      try {
        await waitForAdvisoryLockWaiters(prisma, lockKey, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const results = await Promise.allSettled(creates);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as DomainError).code).toBe("CONFLICT");

      // Exactly one appointment persisted and exactly one co-committed audit row.
      const persisted = await prisma.appointment.count({
        where: {
          tenantId: tenantAId,
          professionalMembershipId: scheduleProfessionalMembershipId,
        },
      });
      expect(persisted).toBe(1);

      const audit = await prisma.auditLog.findMany({
        where: { tenantId: tenantAId, targetType: "appointment", action: "appointment.created" },
      });
      expect(audit).toHaveLength(1);
    }, 20_000);

    /**
     * Focused proof for the key-scoped barrier: a database lock waiter that is
     * NOT waiting on the scheduling advisory lock must not satisfy it.
     *
     * The test contends an UNRELATED advisory key (same 64-bit advisory class,
     * different key) until a waiter is provably blocked, then asserts the
     * scheduling-keyed barrier still reports zero matching waiters and times out.
     * The pre-correction generic `waitForLockWaiters` (`wait_event_type =
     * 'Lock'`) would have counted that unrelated waiter and released the race
     * prematurely.
     */
    it("counts only waiters on the scheduling advisory lock key, not unrelated lock waiters", async () => {
      const scheduleKey = `${tenantAId}:${scheduleProfessionalMembershipId}`;
      const unrelatedKey = `${tenantAId}:unrelated-${randomUUID()}`;

      let releaseUnrelated!: () => void;
      const unrelatedReleased = new Promise<void>((resolve) => {
        releaseUnrelated = resolve;
      });
      let signalUnrelatedReady!: () => void;
      const unrelatedReady = new Promise<void>((resolve) => {
        signalUnrelatedReady = resolve;
      });

      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${unrelatedKey}, 0))::text`;
          signalUnrelatedReady();
          await unrelatedReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await unrelatedReady;

      const unrelatedWaiter = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${unrelatedKey}, 0))::text`;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );

      try {
        // An unrelated advisory waiter is provably blocked...
        await waitForLockWaiters(prisma, 1, 10_000);
        // ...yet it must not count as a waiter on the scheduling key.
        expect(await countAdvisoryLockWaiters(prisma, scheduleKey)).toBe(0);
        await expect(waitForAdvisoryLockWaiters(prisma, scheduleKey, 1, 1_000)).rejects.toThrow(
          /Scheduling advisory-lock barrier timed out/
        );
      } finally {
        releaseUnrelated();
        await holder;
        await unrelatedWaiter;
      }
    }, 30_000);
  });

  /**
   * EPIC-08 WU2 portal identity application-path evidence.
   *
   * Proves against real PostgreSQL what the in-memory harness cannot: the
   * partial unique ACTIVE holder indexes rejecting a second holder (409) and a
   * colliding canonical login email (409), the catalog-exact
   * `customer_portal_access_active_contact_email_key` shape — UNIQUE on
   * `(tenant_id, lower(contact_email))` WHERE `status = 'ACTIVE'` — plus a
   * service-bypassing direct insert the database rejects, its partial predicate
   * freeing the email after revocation, byte-equivalent cross-tenant 404 on
   * provisioning AND revocation (the foreign holder/session left untouched), the
   * `portal` entitlement gate (403) even for a directly-seeded holder,
   * cross-cookie isolation (401 both directions), and revocation persisting
   * `portal_session.revoked_at` while rejecting replays with 401.
   */
  describe("EPIC-08 portal identity application-path isolation", () => {
    let portalCustomerAId: string;
    let portalCustomerA2Id: string;
    let portalAccessAId = "";
    let livePortalCookie = "";
    const LIVE_PORTAL_EMAIL = "live-portal-holder@portal.test";
    const LIVE_PORTAL_PASSWORD = "live-portal-password";

    beforeAll(async () => {
      // Tenant A holds the explicit `portal` grant; tenant B intentionally does
      // NOT, so the guard's entitlement gate can be proven for real.
      const portalFeature = await prisma.featureCode.upsert({
        where: { code: "portal" },
        create: { code: "portal" },
        update: {},
      });
      await prisma.tenantEntitlement.upsert({
        where: {
          tenantId_featureCodeId: { tenantId: tenantAId, featureCodeId: portalFeature.id },
        },
        create: { tenantId: tenantAId, featureCodeId: portalFeature.id },
        update: {},
      });

      const customer = await prisma.customer.create({
        data: { tenantId: tenantAId, kind: "INDIVIDUAL", displayName: "Live Portal Customer" },
      });
      portalCustomerAId = customer.id;
      const secondCustomer = await prisma.customer.create({
        data: { tenantId: tenantAId, kind: "INDIVIDUAL", displayName: "Live Portal Customer A2" },
      });
      portalCustomerA2Id = secondCustomer.id;
    }, 60_000);

    it("provisions a holder and rejects a second one with 409 at the partial unique index", async () => {
      const requestId = "live-pg-portal-provision";
      const created = await supertest(serverUrl)
        .post(`/customers/${portalCustomerAId}/portal-access`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({ email: LIVE_PORTAL_EMAIL, password: LIVE_PORTAL_PASSWORD })
        .expect(201);
      const body = created.body as {
        id: string;
        tenantId: string;
        customerId: string;
        status: string;
      };
      expect(body.tenantId).toBe(tenantAId);
      expect(body.customerId).toBe(portalCustomerAId);
      expect(body.status).toBe("ACTIVE");
      portalAccessAId = body.id;

      const holderCount = (): Promise<number> =>
        prisma.customerPortalAccess.count({
          where: { tenantId: tenantAId, customerId: portalCustomerAId },
        });
      expect(await holderCount()).toBe(1);
      const credential = await prisma.portalCredential.findUnique({
        where: { portalAccessId: body.id },
      });
      expect(credential?.passwordHash).toBeDefined();

      const audit = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audit.map((row) => row.action)).toEqual(["portal_access.provisioned"]);
      expect(audit[0]?.actorType).toBe("STAFF");

      const second = await supertest(serverUrl)
        .post(`/customers/${portalCustomerAId}/portal-access`)
        .set("Cookie", ownerACookie)
        .send({ email: "second-live@portal.test", password: LIVE_PORTAL_PASSWORD })
        .expect(409);
      expect((second.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect(await holderCount()).toBe(1);
    });

    it("rejects a second same-Customer ACTIVE holder at the per-Customer partial unique index (service bypassed)", async () => {
      // Pin the catalog-level shape exactly, mirroring the canonical-email key:
      // UNIQUE validity, both raw key columns, and the ACTIVE predicate.
      const indexRows = await prisma.$queryRaw<
        { is_unique: boolean; key_1: string; key_2: string; predicate: string }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'customer_portal_access_active_customer_key'
      `;
      expect(indexRows).toHaveLength(1);
      const index = indexRows[0];
      expect(index.is_unique).toBe(true);
      expect(index.key_1).toBe("tenant_id");
      expect(index.key_2).toBe("customer_id");
      expect(normalizeIndexPredicate(index.predicate)).toBe(ACTIVE_PORTAL_INDEX_PREDICATE);

      // The API provisioned exactly one ACTIVE holder for this Customer (first
      // test); the service pre-check is what returns that 409. Bypass the
      // service entirely and let the DATABASE reject the same tenant/Customer
      // duplicate on its own.
      const activeHolderCount = (): Promise<number> =>
        prisma.customerPortalAccess.count({
          where: { tenantId: tenantAId, customerId: portalCustomerAId, status: "ACTIVE" },
        });
      expect(await activeHolderCount()).toBe(1);

      // A DIFFERENT contactEmail removes the canonical-email key from play, so
      // the per-Customer key is the only unique index left that can fire.
      const rejection = await prisma.customerPortalAccess
        .create({
          data: {
            tenantId: tenantAId,
            customerId: portalCustomerAId,
            contactEmail: "second-holder-live@portal.test",
            status: "ACTIVE",
          },
        })
        .then(
          () => null,
          (error: unknown) => error as { code?: string; meta?: { target?: unknown } }
        );

      // Prisma reports the violated partial index by its key columns, which
      // names `customer_portal_access_active_customer_key` and not the
      // canonical-email key.
      expect(rejection?.code).toBe("P2002");
      expect(rejection?.meta?.target).toEqual(["tenant_id", "customer_id"]);
      expect(await activeHolderCount()).toBe(1);
    });

    it("rejects a second Customer claiming the same canonical login email at the ACTIVE partial unique index", async () => {
      // Assert the catalog-level shape exactly — UNIQUE validity, both key
      // entries including the lower() EXPRESSION, and the ACTIVE predicate —
      // instead of loose substrings of the rendered indexdef. A raw-column key
      // would let case-variants through, so the expression is load-bearing.
      const indexRows = await prisma.$queryRaw<
        { is_unique: boolean; key_1: string; key_2: string; predicate: string }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'customer_portal_access_active_contact_email_key'
      `;
      expect(indexRows).toHaveLength(1);
      const index = indexRows[0];
      expect(index.is_unique).toBe(true);
      expect(index.key_1).toBe("tenant_id");
      expect(index.key_2).toBe("lower(contact_email)");
      expect(normalizeIndexPredicate(index.predicate)).toBe(ACTIVE_PORTAL_INDEX_PREDICATE);

      const response = await supertest(serverUrl)
        .post(`/customers/${portalCustomerA2Id}/portal-access`)
        .set("Cookie", ownerACookie)
        .send({ email: LIVE_PORTAL_EMAIL.toUpperCase(), password: LIVE_PORTAL_PASSWORD })
        .expect(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      const holderCount = (): Promise<number> =>
        prisma.customerPortalAccess.count({
          where: { tenantId: tenantAId, customerId: portalCustomerA2Id },
        });
      expect(await holderCount()).toBe(0);

      // Bypass the service pre-check entirely: insert through the data layer
      // with a CASE-VARIANT of the ACTIVE canonical email on a DIFFERENT
      // Customer. customerA2 holds zero ACTIVE rows (asserted just above), so
      // the per-Customer key cannot be what fires; a raw-column key would admit
      // the variant. The P2002 is therefore the database — not the service —
      // enforcing lower(contact_email).
      await expect(
        prisma.customerPortalAccess.create({
          data: {
            tenantId: tenantAId,
            customerId: portalCustomerA2Id,
            contactEmail: LIVE_PORTAL_EMAIL.toUpperCase(),
            status: "ACTIVE",
          },
        })
      ).rejects.toMatchObject({ code: "P2002" });
      expect(await holderCount()).toBe(0);
    });

    it("masks a cross-tenant provisioning Customer as a byte-equivalent 404 to an unknown Customer", async () => {
      const requestId = "live-pg-portal-cross-tenant";
      const before = await prisma.customerPortalAccess.count({ where: { tenantId: tenantBId } });
      const crossTenant = await supertest(serverUrl)
        .post(`/customers/${guardianCustomerBId}/portal-access`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({ email: "cross-live@portal.test", password: LIVE_PORTAL_PASSWORD })
        .expect(404);
      // Identical tenant context, body and server-pinned request id as a truly
      // unknown Customer: the responses must be byte-identical, so a foreign
      // tenant UUID is indistinguishable from a non-existent one.
      const unknownCustomer = await supertest(serverUrl)
        .post(`/customers/${randomUUID()}/portal-access`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({ email: "cross-live@portal.test", password: LIVE_PORTAL_PASSWORD })
        .expect(404);

      expect((crossTenant.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect(crossTenant.text).toBe(unknownCustomer.text);
      expect(crossTenant.text).not.toContain(guardianCustomerBId);
      expect(crossTenant.text).not.toContain(tenantBId);
      expect(await prisma.customerPortalAccess.count({ where: { tenantId: tenantBId } })).toBe(
        before
      );
    });

    it("masks a cross-tenant revoke as a byte-equivalent 404 and leaves the foreign holder/session untouched", async () => {
      // A foreign tenant's live holder + session. Tenant B is deliberately
      // unentitled, so both rows are seeded directly: the point is that tenant
      // A's revoke must never reach them.
      const foreignCustomer = await prisma.customer.create({
        data: {
          tenantId: tenantBId,
          kind: "INDIVIDUAL",
          displayName: "Cross-tenant Revoke Customer",
        },
      });
      const foreignHolder = await prisma.customerPortalAccess.create({
        data: {
          tenantId: tenantBId,
          customerId: foreignCustomer.id,
          contactEmail: "cross-revoke-foreign@portal.test",
          status: "ACTIVE",
        },
      });
      const { token } = await app.get(PortalSessionService).issue(foreignHolder.id);

      const holderBefore = await prisma.customerPortalAccess.findUnique({
        where: { id: foreignHolder.id },
      });
      const sessionsBefore = await prisma.portalSession.findMany({
        where: { portalAccessId: foreignHolder.id },
      });
      expect(holderBefore?.status).toBe("ACTIVE");
      expect(sessionsBefore).toHaveLength(1);
      expect(sessionsBefore[0]?.revokedAt).toBeNull();

      const requestId = "live-pg-portal-cross-tenant-revoke";
      const crossTenant = await supertest(serverUrl)
        .post(`/customers/${foreignCustomer.id}/portal-access/revoke`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .expect(404);
      // Identical tenant context, body and server-pinned request id as a truly
      // unknown Customer: the responses must be byte-identical, so a foreign
      // tenant UUID is indistinguishable from a non-existent one.
      const unknownCustomer = await supertest(serverUrl)
        .post(`/customers/${randomUUID()}/portal-access/revoke`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .expect(404);

      expect((crossTenant.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect(crossTenant.text).toBe(unknownCustomer.text);
      expect(crossTenant.text).not.toContain(foreignCustomer.id);
      expect(crossTenant.text).not.toContain(tenantBId);

      // The foreign holder and its live session are byte-for-byte unchanged: no
      // status flip, no revokedAt stamp, no bumped updatedAt.
      expect(
        await prisma.customerPortalAccess.findUnique({ where: { id: foreignHolder.id } })
      ).toEqual(holderBefore);
      expect(
        await prisma.portalSession.findMany({ where: { portalAccessId: foreignHolder.id } })
      ).toEqual(sessionsBefore);
      // The token still resolves — the session sweep never crossed tenants.
      expect(await app.get(PortalSessionService).resolve(token)).not.toBeNull();
      // Nothing co-committed: no audit row under tenant A's request id.
      expect(await prisma.auditLog.findMany({ where: { requestId } })).toHaveLength(0);
    });

    it("returns 403 FEATURE_NOT_ENTITLED for a holder in an unentitled tenant", async () => {
      // Seeded directly (provisioning and login both require the entitlement),
      // so this isolates the PortalAuthGuard's entitlement gate.
      const holderB = await prisma.customerPortalAccess.create({
        data: {
          tenantId: tenantBId,
          customerId: guardianCustomerBId,
          contactEmail: "unentitled-live@portal.test",
          status: "ACTIVE",
        },
      });
      const { token } = await app.get(PortalSessionService).issue(holderB.id);

      const response = await supertest(serverUrl)
        .get("/portal/me")
        .set("Cookie", `${PORTAL_SESSION_COOKIE}=${token}`)
        .expect(403);
      expect((response.body as ErrorEnvelope).error.code).toBe("FEATURE_NOT_ENTITLED");
    });

    it("separates the staff and portal cookies, then authenticates a holder", async () => {
      const login = await supertest(serverUrl)
        .post("/portal/login")
        .send({
          tenantSlug: "live-a",
          email: LIVE_PORTAL_EMAIL,
          password: LIVE_PORTAL_PASSWORD,
        })
        .expect(200);
      const setCookie = login.headers["set-cookie"] as unknown as string[];
      livePortalCookie = setCookie
        .find((cookie) => cookie.startsWith(`${PORTAL_SESSION_COOKIE}=`))!
        .split(";")[0]!;
      // The portal login never sets a staff cookie.
      expect(setCookie.some((cookie) => cookie.startsWith(`${STAFF_SESSION_COOKIE}=`))).toBe(false);

      await supertest(serverUrl).get("/portal/me").set("Cookie", livePortalCookie).expect(200);
      // Each chain rejects the other cookie, and anonymous is 401.
      await supertest(serverUrl).get("/portal/me").set("Cookie", ownerACookie).expect(401);
      await supertest(serverUrl).get("/memberships").set("Cookie", livePortalCookie).expect(401);
      await supertest(serverUrl).get("/portal/me").expect(401);
    });

    it("persists portal_session.revoked_at on revocation and rejects replays with 401", async () => {
      const requestId = "live-pg-portal-revoke";
      // Snapshot the holder's live session row: the evidence must show the SAME
      // row is retained and stamped, not merely that a later request 401s.
      const sessionsBefore = await prisma.portalSession.findMany({
        where: { portalAccessId: portalAccessAId },
      });
      expect(sessionsBefore).toHaveLength(1);
      expect(sessionsBefore[0]?.revokedAt).toBeNull();

      await supertest(serverUrl)
        .post(`/customers/${portalCustomerAId}/portal-access/revoke`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .expect(201);

      const sessionsAfter = await prisma.portalSession.findMany({
        where: { portalAccessId: portalAccessAId },
      });
      expect(sessionsAfter).toHaveLength(1);
      expect(sessionsAfter[0]?.id).toBe(sessionsBefore[0]?.id);
      expect(sessionsAfter[0]?.revokedAt).toBeInstanceOf(Date);

      await supertest(serverUrl).get("/portal/me").set("Cookie", livePortalCookie).expect(401);

      const audit = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audit.map((row) => row.action)).toEqual(["portal_access.revoked"]);
      expect(audit[0]?.actorType).toBe("STAFF");
    });

    it("frees the canonical login email after revocation (partial index ignores REVOKED)", async () => {
      const created = await supertest(serverUrl)
        .post(`/customers/${portalCustomerA2Id}/portal-access`)
        .set("Cookie", ownerACookie)
        .send({ email: LIVE_PORTAL_EMAIL, password: LIVE_PORTAL_PASSWORD })
        .expect(201);
      const body = created.body as { customerId: string; status: string };
      expect(body.customerId).toBe(portalCustomerA2Id);
      expect(body.status).toBe("ACTIVE");
    });
  });

  /**
   * EPIC-08 WU5 task 5.1 — portal WRITE concurrency and isolation against a
   * REAL PostgreSQL (the TD-006 gap).
   *
   * Every guarantee on the DEC-007 A2d surface rested on the synchronous
   * in-memory boundary fake, which cannot interleave transactions. Each race
   * below is forced by a deterministic database barrier — the scheduling
   * advisory lock for the approval/reschedule paths and a `SELECT ... FOR
   * UPDATE` row lock for the owner-scoped cancel — and the barrier releases
   * only once PostgreSQL proves every racer is parked at that same boundary.
   * A sequential-looking result therefore cannot masquerade as a race.
   */
  describe("EPIC-08 WU5 portal write concurrency and isolation", () => {
    let holderCookie: string;
    let holderCustomerId: string;
    let holderPatientId: string;
    let otherCustomerId: string;
    let otherPatientId: string;
    let foreignCustomerId: string;
    let foreignPatientId: string;
    let foreignBranchId: string;
    let foreignProfessionalMembershipId: string;
    let revokedPatientId: string;
    let revokedLinkId: string;
    let branchId: string;
    let approvalProfessionalMembershipId: string;
    let rescheduleProfessionalMembershipId: string;

    beforeAll(async () => {
      // Tenant A holds the explicit `portal` grant; the holder below must clear
      // the guard's entitlement gate for real.
      const portalFeature = await prisma.featureCode.upsert({
        where: { code: "portal" },
        create: { code: "portal" },
        update: {},
      });
      await prisma.tenantEntitlement.upsert({
        where: {
          tenantId_featureCodeId: { tenantId: tenantAId, featureCodeId: portalFeature.id },
        },
        create: { tenantId: tenantAId, featureCodeId: portalFeature.id },
        update: {},
      });

      const createCustomer = (tenantId: string, displayName: string): Promise<{ id: string }> =>
        prisma.customer.create({ data: { tenantId, kind: "INDIVIDUAL", displayName } });
      holderCustomerId = (await createCustomer(tenantAId, "WU5 Holder Customer")).id;
      otherCustomerId = (await createCustomer(tenantAId, "WU5 Other Customer")).id;
      foreignCustomerId = (await createCustomer(tenantBId, "WU5 Foreign Customer")).id;

      // Inactive Patients are the minimal anchor (scheduling resolves existence,
      // not activity) and keep this fixture free of the exactly-one-primary
      // guardian trigger.
      const createPatient = (tenantId: string, name: string): Promise<{ id: string }> =>
        prisma.patient.create({
          data: { tenantId, name, speciesId: dogSpeciesId, sex: "UNKNOWN", isActive: false },
        });
      holderPatientId = (await createPatient(tenantAId, "WU5 Holder Patient")).id;
      otherPatientId = (await createPatient(tenantAId, "WU5 Other Patient")).id;
      foreignPatientId = (await createPatient(tenantBId, "WU5 Foreign Patient")).id;
      revokedPatientId = (await createPatient(tenantAId, "WU5 Revoked Patient")).id;

      const linkGuardian = (tenantId: string, patientId: string, customerId: string) =>
        prisma.patientGuardian.create({
          data: { tenantId, patientId, customerId, isPrimary: true, isActive: true, position: 0 },
        });
      await linkGuardian(tenantAId, holderPatientId, holderCustomerId);
      await linkGuardian(tenantAId, otherPatientId, otherCustomerId);
      await linkGuardian(tenantBId, foreignPatientId, foreignCustomerId);
      const revokedLink = await linkGuardian(tenantAId, revokedPatientId, holderCustomerId);
      revokedLinkId = revokedLink.id;

      branchId = (await prisma.branch.create({ data: { tenantId: tenantAId, name: "WU5 Branch" } }))
        .id;
      foreignBranchId = (
        await prisma.branch.create({ data: { tenantId: tenantBId, name: "WU5 Foreign Branch" } })
      ).id;

      const veterinarianRole = await prisma.role.findUnique({ where: { code: "VETERINARIAN" } });
      if (!veterinarianRole) {
        throw new Error("Reference seed did not create the VETERINARIAN role");
      }
      const createVeterinarian = async (tenantId: string, email: string): Promise<string> => {
        const profile = await prisma.userProfile.create({
          data: { email, displayName: email, status: "active" },
        });
        const membership = await prisma.tenantMembership.create({
          data: {
            tenantId,
            userProfileId: profile.id,
            roleId: veterinarianRole.id,
            status: "ACTIVE",
          },
        });
        return membership.id;
      };
      approvalProfessionalMembershipId = await createVeterinarian(
        tenantAId,
        "wu5-vet-approval@live.test"
      );
      rescheduleProfessionalMembershipId = await createVeterinarian(
        tenantAId,
        "wu5-vet-reschedule@live.test"
      );
      foreignProfessionalMembershipId = await createVeterinarian(
        tenantBId,
        "wu5-vet-foreign@live.test"
      );

      const access = await prisma.customerPortalAccess.create({
        data: {
          tenantId: tenantAId,
          customerId: holderCustomerId,
          contactEmail: "wu5-holder@portal.test",
          status: "ACTIVE",
        },
      });
      const { token } = await app.get(PortalSessionService).issue(access.id);
      holderCookie = `${PORTAL_SESSION_COOKIE}=${token}`;
    }, 60_000);

    /**
     * Byte-equivalence probe for a portal write: the FOREIGN reference and a
     * truly unknown UUID must return the SAME 404 payload (one shared inbound
     * request id pins the echoed correlation), and no foreign identifier may
     * leak into either body.
     */
    async function expectPortalWrite404(testCase: {
      method: "POST" | "PUT";
      path: (id: string) => string;
      foreignId: string;
      body?: Record<string, unknown>;
      forbidden: readonly string[];
    }): Promise<void> {
      const requestId = `wu5-isolation-${randomUUID()}`;
      const probe = (id: string) => {
        const request =
          testCase.method === "POST"
            ? supertest(serverUrl).post(testCase.path(id))
            : supertest(serverUrl).put(testCase.path(id));
        request.set("Cookie", holderCookie).set("X-Request-Id", requestId);
        return testCase.body === undefined ? request : request.send(testCase.body);
      };
      const [missing, foreign] = await Promise.all([
        probe(randomUUID()),
        probe(testCase.foreignId),
      ]);

      expect(missing.status).toBe(404);
      expect(foreign.status).toBe(404);
      expect((foreign.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect(missing.text).toBe(foreign.text);
      const serialized = `${missing.text}${foreign.text}`;
      for (const identifier of testCase.forbidden) {
        expect(serialized).not.toContain(identifier);
      }
    }

    it("serializes two concurrent approvals of ONE pending request into a single PORTAL appointment", async () => {
      const request = await prisma.portalBookingRequest.create({
        data: {
          tenantId: tenantAId,
          customerId: holderCustomerId,
          patientId: holderPatientId,
          status: "PENDING",
          startAt: new Date("2030-01-07T13:00:00.000Z"),
          endAt: new Date("2030-01-07T13:30:00.000Z"),
        },
      });

      const approve = (requestId: string) =>
        supertest(serverUrl)
          .post(`/booking-requests/${request.id}/approve`)
          .set("Cookie", ownerACookie)
          .set("X-Request-Id", requestId)
          .send({ branchId, professionalMembershipId: approvalProfessionalMembershipId })
          .then((response) => ({
            status: response.status,
            body: response.body as PortalAppointmentBody & { error?: { code?: string } },
          }));

      // Same professional + slot: both approvals must acquire the SAME
      // `pg_advisory_xact_lock` key, so the barrier proves the overlap.
      const responses = await forceAdvisoryLockRace(
        prisma,
        `${tenantAId}:${approvalProfessionalMembershipId}`,
        2,
        () => [approve(`wu5-approve-a-${randomUUID()}`), approve(`wu5-approve-b-${randomUUID()}`)]
      );

      // A losing approval must never surface an unmapped INTERNAL.
      expect(responses.filter((response) => response.status >= 500)).toEqual([]);

      const appointments = await prisma.appointment.findMany({
        where: { tenantId: tenantAId, portalBookingRequestId: request.id },
      });
      expect(appointments).toHaveLength(1);
      expect(appointments[0]?.source).toBe("PORTAL");
      const winnerId = appointments[0].id;

      const stored = await prisma.portalBookingRequest.findUnique({ where: { id: request.id } });
      expect(stored?.status).toBe("APPROVED");

      const audit = await prisma.auditLog.findMany({
        where: {
          tenantId: tenantAId,
          action: "portal_booking.approved",
          targetType: "portal_booking_request",
          targetId: request.id,
        },
      });
      expect(audit).toHaveLength(1);

      const successes = responses.filter((response) => response.status === 201);
      const conflicts = responses.filter((response) => response.status === 409);
      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(successes.length + conflicts.length).toBe(2);
      for (const success of successes) {
        expect(success.body.id).toBe(winnerId);
      }
      for (const conflict of conflicts) {
        expect(conflict.body.error?.code).toBe("CONFLICT");
      }
      // The observed WU5 5.1 outcome: both callers return the winner's
      // appointment (idempotent recovery), never a 500 and not a bare 409.
      expect(responses.map((response) => response.status).sort()).toEqual([201, 201]);
      console.info(
        `[WU5 5.1] concurrent approvals -> ${JSON.stringify(responses.map((r) => r.status))}`
      );
    }, 30_000);

    it("admits exactly ONE of two concurrent same-version reschedules (no lost update)", async () => {
      const appointment = await prisma.appointment.create({
        data: {
          tenantId: tenantAId,
          branchId,
          patientId: holderPatientId,
          professionalMembershipId: rescheduleProfessionalMembershipId,
          status: "SCHEDULED",
          version: 1,
          startAt: new Date("2030-02-04T09:00:00.000Z"),
          endAt: new Date("2030-02-04T09:30:00.000Z"),
        },
      });

      const slotA = { startAt: "2030-02-04T10:00:00.000Z", endAt: "2030-02-04T10:30:00.000Z" };
      const slotB = { startAt: "2030-02-04T11:00:00.000Z", endAt: "2030-02-04T11:30:00.000Z" };
      const reschedule = (slot: { startAt: string; endAt: string }) =>
        supertest(serverUrl)
          .put(`/portal/appointments/${appointment.id}`)
          .set("Cookie", holderCookie)
          .set("X-Request-Id", `wu5-reschedule-${randomUUID()}`)
          .send({ ...slot, version: 1 })
          .then((response) => ({
            status: response.status,
            body: response.body as PortalAppointmentBody & { error?: { code?: string } },
          }));

      const responses = await forceAdvisoryLockRace(
        prisma,
        `${tenantAId}:${rescheduleProfessionalMembershipId}`,
        2,
        () => [reschedule(slotA), reschedule(slotB)]
      );

      const successes = responses.filter((response) => response.status === 200);
      const conflicts = responses.filter((response) => response.status === 409);
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.body.error?.code).toBe("CONFLICT");

      const winner = successes[0];
      const stored = await prisma.appointment.findUnique({ where: { id: appointment.id } });
      expect(stored?.version).toBe(2);
      expect(stored?.startAt.toISOString()).toBe(winner.body.startAt);
      expect(stored?.endAt.toISOString()).toBe(winner.body.endAt);
      // No lost update: the stored slot is EXACTLY the winner's requested slot,
      // and the compare-and-set advanced the version a single time.
      expect([slotA.startAt, slotB.startAt]).toContain(stored?.startAt.toISOString());

      const audit = await prisma.auditLog.findMany({
        where: { tenantId: tenantAId, action: "appointment.rescheduled", targetId: appointment.id },
      });
      expect(audit).toHaveLength(1);
    }, 30_000);

    it("lets exactly ONE of two concurrent holder cancels win the PENDING compare-and-set", async () => {
      const request = await prisma.portalBookingRequest.create({
        data: {
          tenantId: tenantAId,
          customerId: holderCustomerId,
          patientId: holderPatientId,
          status: "PENDING",
          startAt: new Date("2030-03-11T09:00:00.000Z"),
          endAt: new Date("2030-03-11T09:30:00.000Z"),
        },
      });

      // Deterministic RESOURCE-SCOPED barrier: a dedicated transaction holds the
      // request row's write lock, so both cancels block on the SAME
      // `... WHERE status = 'PENDING'` UPDATE before either can commit. The
      // poller counts only backends holding a granted tuple lock on EXACTLY this
      // row's `(relation, page, tuple)` — never any generic lock waiter.
      let releaseBarrier!: () => void;
      const barrierReleased = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let signalBarrierReady!: () => void;
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });
      const barrierTransaction = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM portal_booking_request WHERE id = ${request.id}::uuid FOR UPDATE`;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;
      // The row lock is held now, so the ctid cannot move under the racers.
      const ctid = await readBookingRowCtid(prisma, request.id);

      const cancel = () =>
        supertest(serverUrl)
          .post(`/portal/bookings/${request.id}/cancel`)
          .set("Cookie", holderCookie)
          .set("X-Request-Id", `wu5-cancel-${randomUUID()}`)
          .then((response) => ({
            status: response.status,
            body: response.body as { status?: string; error?: { code?: string } },
          }));
      const cancels = [cancel(), cancel()];
      try {
        await waitForBookingRowLockWaiters(
          prisma,
          "portal_booking_request",
          ctid.page,
          ctid.tuple,
          2,
          10_000
        );
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }
      const responses = await Promise.all(cancels);

      const successes = responses.filter((response) => response.status === 200);
      const conflicts = responses.filter((response) => response.status === 409);
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.body.error?.code).toBe("CONFLICT");
      expect(successes[0]?.body.status).toBe("CANCELLED");

      const stored = await prisma.portalBookingRequest.findUnique({ where: { id: request.id } });
      expect(stored?.status).toBe("CANCELLED");

      const audit = await prisma.auditLog.findMany({
        where: {
          tenantId: tenantAId,
          action: "portal_booking.cancelled",
          targetId: request.id,
        },
      });
      expect(audit).toHaveLength(1);
    }, 30_000);

    it("masks a same-tenant other-Customer AND a cross-tenant appointment as byte-equivalent 404 on BOTH writes", async () => {
      const sameTenantAppointment = await prisma.appointment.create({
        data: {
          tenantId: tenantAId,
          branchId,
          patientId: otherPatientId,
          professionalMembershipId: rescheduleProfessionalMembershipId,
          status: "SCHEDULED",
          version: 1,
          startAt: new Date("2030-04-08T09:00:00.000Z"),
          endAt: new Date("2030-04-08T09:30:00.000Z"),
        },
      });
      const crossTenantAppointment = await prisma.appointment.create({
        data: {
          tenantId: tenantBId,
          branchId: foreignBranchId,
          patientId: foreignPatientId,
          professionalMembershipId: foreignProfessionalMembershipId,
          status: "SCHEDULED",
          version: 1,
          startAt: new Date("2030-04-08T09:00:00.000Z"),
          endAt: new Date("2030-04-08T09:30:00.000Z"),
        },
      });
      const sameTenantBefore = await prisma.appointment.findUnique({
        where: { id: sameTenantAppointment.id },
      });
      const crossTenantBefore = await prisma.appointment.findUnique({
        where: { id: crossTenantAppointment.id },
      });

      const moveBody = {
        startAt: "2030-04-08T11:00:00.000Z",
        endAt: "2030-04-08T11:30:00.000Z",
        version: 1,
      };
      const cases = [
        {
          method: "POST" as const,
          path: (id: string) => `/portal/appointments/${id}/cancel`,
          foreignId: sameTenantAppointment.id,
          forbidden: [sameTenantAppointment.id, otherPatientId],
        },
        {
          method: "PUT" as const,
          path: (id: string) => `/portal/appointments/${id}`,
          foreignId: sameTenantAppointment.id,
          body: moveBody,
          forbidden: [sameTenantAppointment.id, otherPatientId],
        },
        {
          method: "POST" as const,
          path: (id: string) => `/portal/appointments/${id}/cancel`,
          foreignId: crossTenantAppointment.id,
          forbidden: [crossTenantAppointment.id, foreignPatientId, tenantBId],
        },
        {
          method: "PUT" as const,
          path: (id: string) => `/portal/appointments/${id}`,
          foreignId: crossTenantAppointment.id,
          body: moveBody,
          forbidden: [crossTenantAppointment.id, foreignPatientId, tenantBId],
        },
      ];
      for (const testCase of cases) {
        await expectPortalWrite404(testCase);
      }

      // Neither foreign row was mutated by the denied writes.
      expect(
        await prisma.appointment.findUnique({ where: { id: sameTenantAppointment.id } })
      ).toEqual(sameTenantBefore);
      expect(
        await prisma.appointment.findUnique({ where: { id: crossTenantAppointment.id } })
      ).toEqual(crossTenantBefore);
    }, 30_000);

    it("stops an appointment from being actionable once the guardian link is revoked (cancel and move -> 404)", async () => {
      const revokedAppointment = await prisma.appointment.create({
        data: {
          tenantId: tenantAId,
          branchId,
          patientId: revokedPatientId,
          professionalMembershipId: rescheduleProfessionalMembershipId,
          status: "SCHEDULED",
          version: 1,
          startAt: new Date("2030-05-06T09:00:00.000Z"),
          endAt: new Date("2030-05-06T09:30:00.000Z"),
        },
      });
      const before = await prisma.appointment.findUnique({ where: { id: revokedAppointment.id } });

      const { count } = await prisma.patientGuardian.updateMany({
        where: { id: revokedLinkId, tenantId: tenantAId },
        data: { isActive: false },
      });
      expect(count).toBe(1);

      await expectPortalWrite404({
        method: "POST",
        path: (id) => `/portal/appointments/${id}/cancel`,
        foreignId: revokedAppointment.id,
        forbidden: [revokedAppointment.id, revokedPatientId],
      });
      await expectPortalWrite404({
        method: "PUT",
        path: (id) => `/portal/appointments/${id}`,
        foreignId: revokedAppointment.id,
        body: {
          startAt: "2030-05-06T11:00:00.000Z",
          endAt: "2030-05-06T11:30:00.000Z",
          version: 1,
        },
        forbidden: [revokedAppointment.id, revokedPatientId],
      });

      expect(await prisma.appointment.findUnique({ where: { id: revokedAppointment.id } })).toEqual(
        before
      );
    }, 30_000);
  });
});
