import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import supertest from "supertest";
import { PrismaService } from "@newsaas/database";
import type { Prisma } from "@newsaas/database";
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
import { stockSerializationLockKey } from "../src/inventory/inventory.repository.js";
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

/** Server-owned request id pinned on every catalog cross-tenant miss. */
const CATALOG_NOT_FOUND_REQUEST_ID = "live-pg-catalog-not-found-proof";

/** Server-owned request id pinned on every inventory cross-tenant miss. */
const INVENTORY_NOT_FOUND_REQUEST_ID = "live-pg-inventory-not-found-proof";

/** Server-owned request id pinned on every supplier cross-tenant miss. */
const SUPPLIER_NOT_FOUND_REQUEST_ID = "live-pg-supplier-not-found-proof";

/**
 * Exact stable `409` wire message for a duplicate PRESENT `taxId` inside one
 * tenant, mirrored as a literal so the live suite asserts the byte-exact body
 * the application emits rather than importing the production constant.
 */
const SUPPLIER_TAX_ID_CONFLICT_MESSAGE =
  "A supplier with this tax identifier already exists in this tenant.";

/** Server-owned request id pinned on every purchase cross-tenant miss. */
const PURCHASE_NOT_FOUND_REQUEST_ID = "live-pg-purchase-not-found-proof";

/** Server-owned request id pinned on every receiving cross-tenant miss. */
const RECEIVE_NOT_FOUND_REQUEST_ID = "live-pg-receive-not-found-proof";

/**
 * Stable `409` wire message for an edit or cancel against a non-DRAFT
 * purchase, mirrored as a literal so the live suite asserts the byte-exact body
 * the application emits rather than importing the production constant.
 */
const PURCHASE_NOT_EDITABLE_MESSAGE = "Only a draft purchase can be changed.";

/** Stable `404` wire message shared by every purchase verb. */
const PURCHASE_NOT_FOUND_MESSAGE = "Purchase was not found.";

/** Server-owned request id pinned on every sale cross-tenant miss. */
const SALE_NOT_FOUND_REQUEST_ID = "live-pg-sale-not-found-proof";

/** Server-owned request id pinned on every completion cross-tenant miss. */
const COMPLETION_NOT_FOUND_REQUEST_ID = "live-pg-completion-not-found-proof";

/** Stable `404` wire message shared by every sale verb. */
const SALE_NOT_FOUND_MESSAGE = "Sale was not found.";

/**
 * Stable `409` wire message for an edit or cancel against a non-DRAFT sale,
 * mirrored as a literal so the live suite asserts the byte-exact body the
 * application emits rather than importing the production constant.
 */
const SALE_NOT_EDITABLE_MESSAGE = "Only a draft sale can be changed.";

/**
 * Stable `400` wire message for an item whose informational
 * `referencePriceCurrency` differs from the sale currency (DEC-022), mirrored
 * as a literal so the live suite asserts the byte-exact body.
 */
const SALE_CURRENCY_MISMATCH_MESSAGE =
  "The sale line item currency does not match the sale currency.";

/**
 * The reused inventory `409` wire messages for the two receive-time line
 * gates, mirrored as literals so the live suite asserts the byte-exact bodies
 * the application emits rather than importing the production constants.
 */
const STOCK_ITEM_INACTIVE_MESSAGE = "The catalog item is inactive.";
const STOCK_ITEM_NOT_TRACKED_MESSAGE = "The catalog item does not track stock.";

/**
 * Fixed reason recorded on every `PURCHASE` ledger movement of a receive: the
 * ledger column is `TEXT NOT NULL` and the receive command takes no caller
 * reason, so this literal is the value.
 */
const PURCHASE_RECEIVE_MOVEMENT_REASON = "Purchase received";

/**
 * Fixed reason recorded on every `SALE` ledger movement of a completion: the
 * ledger column is `TEXT NOT NULL` and the completion command takes no caller
 * reason, so this literal is the value.
 */
const SALE_COMPLETION_MOVEMENT_REASON = "Sale completed";

/** Server-owned request id pinned on every cash cross-tenant miss. */
const CASH_NOT_FOUND_REQUEST_ID = "live-pg-cash-not-found-proof";

/**
 * The two stable `404` wire messages behind the cash aggregates, mirrored as
 * literals so the live suite asserts the byte-exact bodies the application
 * emits rather than importing the production constants. The register message
 * is the one `POST /cash/sessions` renders for a foreign or unknown register.
 */
const CASH_REGISTER_NOT_FOUND_MESSAGE = "Cash register was not found.";
const CASH_SESSION_NOT_FOUND_MESSAGE = "Cash session was not found.";

/**
 * Stable `409` wire message for a register create whose tenant-scoped name
 * already exists, mirrored as a literal so the live suite asserts the
 * byte-exact body the application emits for the real unique index.
 */
const CASH_REGISTER_NAME_CONFLICT_MESSAGE =
  "A cash register with this name already exists in this tenant.";

/**
 * Stable `409` wire message for a session open against a register that already
 * has an `OPEN` session, mirrored as a literal so the live suite asserts the
 * byte-exact body the application emits when the partial unique index rejects a
 * concurrent second open.
 */
const CASH_SESSION_ALREADY_OPEN_MESSAGE = "This cash register already has an open session.";

/**
 * The two stable `409` wire messages behind the completion's CASH-session
 * resolution (DEC-020, resolution 4 of 2026-09-29), mirrored as literals so the
 * live suite asserts the byte-exact bodies the application emits for the real
 * `cash_session` rows. They are DIFFERENT messages, so the absence of a session
 * and the ambiguity of several are separable over the wire.
 */
const SALE_CASH_SESSION_REQUIRED_MESSAGE = "A cash payment requires an open cash session.";
const SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE = "More than one cash session is open for this tenant.";

/**
 * Stable `409` wire message for the same idempotency key used with a DIFFERENT
 * request body (DEC-024), mirrored as a literal so the live suite asserts the
 * byte-exact body the application emits for the real replay key.
 */
const SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE =
  "The idempotency key was already used for a different request.";

/**
 * Exact normalized rendering of the one-OPEN-session partial index predicate
 * `status = 'OPEN'`, declared as raw SQL in the migration because Prisma cannot
 * express partial indexes. `normalizeIndexPredicate` strips the parser-added
 * enclosing parenthesis pair, the parser-added enum cast and formatting
 * whitespace, so the stored `(status = 'OPEN'::cash_session_status)` becomes
 * this token string; a plain composite unique index (no predicate) normalizes
 * to the empty string and can never compare equal. Asserting exact equality
 * therefore proves the index is PARTIAL and carries no additional boolean term.
 */
const CASH_ONE_OPEN_INDEX_PREDICATE = "status='OPEN'";

/**
 * Exact normalized rendering of the EPIC-13 CASH-002 exclusive CHECK
 * `cash_movement_direction_required`: a direction is REQUIRED for an
 * `ADJUSTMENT` and FORBIDDEN for every other kind. `normalizeIndexPredicate`
 * strips the parser-added `::text` casts and formatting whitespace, so the
 * stored CHECK
 * `CHECK (((((type)::text = 'ADJUSTMENT'::text) AND (direction IS NOT NULL)) OR
 * (((type)::text <> 'ADJUSTMENT'::text) AND (direction IS NULL))))`
 * becomes this token string. Asserting exact equality — never a substring
 * match — proves BOTH halves of the disjunction survive, so no row can satisfy
 * both and no row can fall outside the constraint.
 */
const CASH_MOVEMENT_DIRECTION_REQUIRED_PREDICATE =
  "CHECK(((((type)::text='ADJUSTMENT')AND(directionISNOTNULL))OR(((type)::text<>'ADJUSTMENT')AND(directionISNULL))))";

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

interface SupplierDto {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Allowlisted purchase line projection (EPIC-11 PUR-001 contract). */
interface PurchaseLineDto {
  id: string;
  catalogItemId: string;
  quantity: string;
  unitCost: string | null;
}

/** Allowlisted purchase response projection (EPIC-11 PUR-001 contract). */
interface PurchaseDto {
  id: string;
  tenantId: string;
  supplierId: string;
  status: "DRAFT" | "RECEIVED" | "CANCELLED";
  lines: PurchaseLineDto[];
  createdAt: string;
  updatedAt: string;
}

/** Allowlisted sale line projection (EPIC-12 POS-001 contract). */
interface SaleLineDto {
  id: string;
  catalogItemId: string;
  rateCode: string;
  unitPrice: string;
  quantity: string;
  lineTotal: string;
  taxableBase: string;
  taxAmount: string;
}

/** Allowlisted sale response projection (EPIC-12 POS-001 contract). */
interface SaleDto {
  id: string;
  tenantId: string;
  customerId: string | null;
  currency: string;
  status: "DRAFT" | "COMPLETED" | "CANCELLED";
  lines: SaleLineDto[];
  total: string;
  createdAt: string;
  updatedAt: string;
}

/** Payment method literals pinned by the `payment_method` enum (PRD §19). */
type SalePaymentMethodDto = "CASH" | "CARD" | "BANK_TRANSFER" | "QR" | "CHECK" | "OTHER";

/** Allowlisted payment projection (EPIC-12 POS-003 contract). */
interface SalePaymentDto {
  id: string;
  method: SalePaymentMethodDto;
  amount: string;
}

/**
 * Allowlisted completed-sale projection (EPIC-12 POS-003 contract): the sale
 * projection plus its payments and the replay discriminant. A fresh completion
 * and an identical replay carry the same shape and differ only by `replay` and
 * the HTTP status (`201` versus `200`).
 */
interface CompletedSaleDto extends SaleDto {
  payments: SalePaymentDto[];
  replay: boolean;
}

/** Allowlisted cash register projection (EPIC-12 POS-002 contract). */
interface CashRegisterDto {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Allowlisted cash session projection (EPIC-12 POS-002 contract, extended by
 * the EPIC-13 CASH-003 close command). The three close-result amounts are
 * `null` for every `OPEN` session and carry the server-derived close figures at
 * `Decimal(14, 2)` scale once the session is `CLOSED` (DEC-031).
 */
interface CashSessionDto {
  id: string;
  registerId: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openedByMembershipId: string;
  openingAmount: string;
  expectedAmount: string | null;
  countedAmount: string | null;
  differenceAmount: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Allowlisted cash movement projection (EPIC-13 CASH-002 contract). */
interface CashMovementDto {
  id: string;
  registerId: string;
  sessionId: string;
  type: "REFUND" | "INCOME" | "EXPENSE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT";
  direction: "INCREASE" | "DECREASE" | null;
  amount: string;
  reason: string | null;
  createdAt: string;
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

/** Allowlisted staff CatalogItem DTO (EPIC-09 WU2 contract). */
interface CatalogItemDto {
  id: string;
  tenantId: string;
  kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
  name: string;
  taxRateId: string;
  taxRate: { code: string; name: string; rate: string };
  referencePriceAmount: string | null;
  referencePriceCurrency: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One row of the GLOBAL seeded tax-rate list (EPIC-09 WU2 contract). */
interface TaxRateDto {
  id: string;
  code: string;
  name: string;
  rate: string;
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

/** Allowlisted staff StockMovement DTO (EPIC-10 W2 contract). */
interface StockMovementDto {
  id: string;
  tenantId: string;
  catalogItemId: string;
  type: "ADJUSTMENT";
  quantity: string;
  reason: string;
  reversesMovementId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Allowlisted staff StockBalance DTO (EPIC-10 W2 contract). */
interface StockBalanceDto {
  id: string;
  tenantId: string;
  catalogItemId: string;
  item: { name: string; kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY" };
  quantity: string;
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

/** Exact allowlisted key set of the staff catalog item response DTO. */
const CATALOG_ITEM_DTO_KEYS = [
  "createdAt",
  "id",
  "isActive",
  "kind",
  "name",
  "referencePriceAmount",
  "referencePriceCurrency",
  "taxRate",
  "taxRateId",
  "tenantId",
  "tracksStock",
  "updatedAt",
].sort();

/** Exact allowlisted key set of one stock-movement response DTO. */
const STOCK_MOVEMENT_DTO_KEYS = [
  "catalogItemId",
  "createdAt",
  "id",
  "quantity",
  "reason",
  "reversesMovementId",
  "tenantId",
  "type",
  "updatedAt",
].sort();

/** Exact allowlisted key set of one stock-balance response DTO. */
const STOCK_BALANCE_DTO_KEYS = [
  "catalogItemId",
  "createdAt",
  "id",
  "item",
  "quantity",
  "tenantId",
  "updatedAt",
].sort();

/** Exact allowlisted key set of the nested balance item projection. */
const STOCK_ITEM_PROJECTION_KEYS = ["kind", "name"].sort();

/** Exact allowlisted key set of one row of the GLOBAL rate list. */
const TAX_RATE_DTO_KEYS = ["code", "id", "name", "rate"].sort();

/** Exact allowlisted key set of the supplier response DTO (EPIC-11 contract). */
const SUPPLIER_DTO_KEYS = [
  "address",
  "createdAt",
  "email",
  "id",
  "isActive",
  "legalName",
  "name",
  "phone",
  "taxId",
  "tenantId",
  "updatedAt",
].sort();

/** Exact allowlisted key set of the purchase response DTO (EPIC-11 contract). */
const PURCHASE_DTO_KEYS = [
  "createdAt",
  "id",
  "lines",
  "status",
  "supplierId",
  "tenantId",
  "updatedAt",
].sort();

/** Exact allowlisted key set of one purchase line projection. */
const PURCHASE_LINE_DTO_KEYS = ["catalogItemId", "id", "quantity", "unitCost"].sort();

/** Exact allowlisted key set of the sale response DTO (EPIC-12 contract). */
const SALE_DTO_KEYS = [
  "createdAt",
  "currency",
  "customerId",
  "id",
  "lines",
  "status",
  "tenantId",
  "total",
  "updatedAt",
].sort();

/** Exact allowlisted key set of one sale line projection. */
const SALE_LINE_DTO_KEYS = [
  "catalogItemId",
  "id",
  "lineTotal",
  "quantity",
  "rateCode",
  "taxAmount",
  "taxableBase",
  "unitPrice",
].sort();

/** Exact allowlisted key set of the completed-sale response DTO (POS-003). */
const COMPLETED_SALE_DTO_KEYS = [...SALE_DTO_KEYS, "payments", "replay"].sort();

/** Exact allowlisted key set of one payment projection. */
const SALE_PAYMENT_DTO_KEYS = ["amount", "id", "method"].sort();

/** Exact allowlisted key set of the cash register response DTO. */
const CASH_REGISTER_DTO_KEYS = ["createdAt", "id", "isActive", "name", "updatedAt"].sort();

/**
 * Exact allowlisted key set of the cash session response DTO. Carries the three
 * EPIC-13 CASH-003 close-result amounts (DEC-031): they are ALWAYS present on
 * the projection and are `null` while the session is `OPEN`, so the key set is
 * identical before and after a close.
 */
const CASH_SESSION_DTO_KEYS = [
  "countedAmount",
  "createdAt",
  "differenceAmount",
  "expectedAmount",
  "id",
  "openedAt",
  "openedByMembershipId",
  "openingAmount",
  "registerId",
  "status",
  "updatedAt",
].sort();

/**
 * Exact allowlisted key set of the cash movement response DTO (EPIC-13
 * CASH-002). Deliberately has NO `tenantId`: the caller's tenant is already the
 * request's own identity and the row is never addressed across a boundary.
 */
const CASH_MOVEMENT_DTO_KEYS = [
  "amount",
  "createdAt",
  "direction",
  "id",
  "reason",
  "registerId",
  "sessionId",
  "type",
].sort();

/**
 * The three GLOBAL platform-seeded rates (PRD §15): stable `code`, display
 * `name` and the exact `Decimal(5,2)` literal. Seed-owned, never migration- or
 * tenant-owned — the live suite asserts these against the real rows.
 */
const SEEDED_TAX_RATES = [
  { code: "EXEMPT", name: "Exempt", rate: "0.00" },
  { code: "IVA_5", name: "IVA 5%", rate: "5.00" },
  { code: "IVA_10", name: "IVA 10%", rate: "10.00" },
] as const;

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
 * Resource-scoped waiter count for the row-lock concurrency races (the
 * owner-scoped booking-request cancel race and the EPIC-09 catalog
 * deactivation race): how many backends are parked on the EXACT row identified
 * by `(relation, page, tuple)`.
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
async function countRowLockWaiters(
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
 * Resource-scoped barrier over {@link countRowLockWaiters}. Throws on timeout
 * so a release can never happen before every racer is provably parked on the
 * contended row.
 */
async function waitForRowLockWaiters(
  prisma: PrismaService,
  relation: string,
  page: number,
  tuple: number,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const blocked = await countRowLockWaiters(prisma, relation, page, tuple);
    if (blocked >= expected) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Row-lock barrier timed out: expected ${expected} waiters on ${relation} (${page},${tuple}), observed ${blocked}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Physical `ctid` of one `relation` row, decomposed to the `page`/`tuple` pair
 * `pg_locks` reports for a tuple lock. Read while the barrier holds the row
 * lock, so the tuple cannot move under the racers.
 *
 * `relation` is a caller-supplied table NAME, which a bind parameter cannot
 * carry, so the raw-unsafe form is used with an identifier-quoted literal (every
 * call site passes a hardcoded table name, never a request-derived one).
 */
async function readRowCtid(
  prisma: PrismaService,
  relation: string,
  id: string
): Promise<{ page: number; tuple: number }> {
  const rows = await prisma.$queryRawUnsafe<{ page: number; tuple: number }[]>(
    `SELECT
       (ctid::text::point)[0]::int AS page,
       (ctid::text::point)[1]::int AS tuple
     FROM "${relation}"
     WHERE id = $1::uuid`,
    id
  );
  const ctid = rows[0];
  if (!ctid) {
    throw new Error(`${relation} row ${id} vanished before the barrier could lock it`);
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
/**
 * Counts the backends parked on a TABLE-level lock request for `relation`.
 *
 * A blocked INSERT shows up as an UNGRANTED `relation` lock on the table it
 * wants to write, so matching `(locktype, relation)` — instead of the generic
 * `wait_event_type = 'Lock'` — names exactly the writers parked on THAT table's
 * lock. An unrelated row lock or advisory waiter has no relation lock on this
 * table, so it can never satisfy the barrier below.
 */
async function countRelationLockWaiters(prisma: PrismaService, relation: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ blocked: number }[]>`
    SELECT count(DISTINCT l.pid)::int AS blocked
    FROM pg_locks AS l
    JOIN pg_stat_activity AS a ON a.pid = l.pid
    WHERE a.datname = current_database()
      AND NOT l.granted
      AND l.locktype = 'relation'
      AND l.relation = ${relation}::regclass
  `;
  return rows[0]?.blocked ?? 0;
}

/**
 * Relation-scoped barrier over {@link countRelationLockWaiters}. Throws on
 * timeout so a concurrency interleaving is decided by a PROVEN database
 * boundary rather than by wall-clock luck, and an unproven overlap can never
 * be mistaken for a passing case.
 */
async function waitForRelationLockWaiters(
  prisma: PrismaService,
  relation: string,
  expected: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const blocked = await countRelationLockWaiters(prisma, relation);
    if (blocked >= expected) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Relation-lock barrier timed out: expected ${expected} writers blocked on ${relation}, observed ${blocked}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const ACTIVE_PORTAL_INDEX_PREDICATE = "status='ACTIVE'";

/**
 * Exact normalized rendering of the WU1 partial index predicate
 * `tax_id IS NOT NULL`. `normalizeIndexPredicate` strips the parser-added
 * enclosing parenthesis pair and formatting whitespace, so the stored
 * `(tax_id IS NOT NULL)` becomes this token string; a plain composite unique
 * index (no predicate) normalizes to the empty string and can never compare
 * equal. Asserting exact equality therefore proves the index is PARTIAL and
 * carries no additional boolean term beyond the one declared.
 */
const SUPPLIER_TAX_ID_INDEX_PREDICATE = "tax_idISNOTNULL";

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
      const ctid = await readRowCtid(prisma, "portal_booking_request", request.id);

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
        await waitForRowLockWaiters(
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

  /**
   * EPIC-09 catalog application-path evidence (WU5, task 5.1).
   *
   * Closes the live-database gap the in-memory WU2 harness cannot: over real
   * HTTP and real PostgreSQL this proves the catalog item's create/read/update/
   * deactivate path with its allowlisted INTERNAL DTO and exactly one
   * co-committed `catalog_item.*` audit row per accepted mutation (and no
   * durable event — the public schema has no event/outbox/queue/job table), the
   * byte-equivalent cross-tenant 404 on read, update and deactivate, the real
   * GLOBAL rate seed behind the required rate (an unknown rate id persists
   * nothing, a bypassed unknown `tax_rate_id` fails the RESTRICT foreign key,
   * and the three seeded rows are served identically to both tenants), and the
   * two physical guarantees the migration claims but the API cannot show: the
   * BEFORE DELETE trigger rejecting a hard delete, and the amount/currency pair
   * CHECK.
   *
   * CONCURRENCY CHOICE: this aggregate has NO version/optimistic-lock column, no
   * unique business key and no cross-row cardinality rule, so it has no
   * compare-and-set invariant to race: concurrent updates are last-write-wins
   * (the documented CAT-003 limitation) and asserting an invented winner would
   * be theater. The concurrency invariant this aggregate DOES have is the one
   * WU2 claims outright — the item change and its audit row are ONE atomic unit
   * — so no concurrent reader may ever observe the renamed item while its audit
   * row is still absent. That interleaving is forced deterministically below
   * with an `audit_log` table-lock barrier, and the case would fail if the audit
   * append ever moved outside the item transaction.
   *
   * LIVE FINDING: PostgreSQL stores the rate and reference-price columns at
   * their declared DECIMAL scale (`0.00`, `10.00`, `150000.00`), while Prisma's
   * `Decimal` projection normalizes trailing zeros on read, so the live DTO
   * carries `"10"` / `"150000"` where the in-memory harness returns the seed
   * text verbatim (which is what the WU2 unit assertions pin). The value is
   * exact and no arithmetic is performed on it, so the assertions below compare
   * CANONICAL decimal forms and pin the raw `::text` column read next to them
   * instead of assuming either padding convention.
   */
  describe("EPIC-09 catalog application-path isolation", () => {
    let exemptRateId: string;
    let iva5RateId: string;
    let iva10RateId: string;
    let catalogItemAId: string;

    beforeAll(async () => {
      // The rate rows are SEED-owned rather than migration-owned, so their
      // presence proves the reference seed really ran against this database.
      const rates = await prisma.taxRate.findMany({ orderBy: { code: "asc" } });
      const rateIdsByCode = new Map(rates.map((rate) => [rate.code, rate.id]));
      const requireRate = (code: string): string => {
        const id = rateIdsByCode.get(code);
        if (!id) {
          throw new Error(`Reference seed did not create the global ${code} tax rate`);
        }
        return id;
      };
      exemptRateId = requireRate("EXEMPT");
      iva5RateId = requireRate("IVA_5");
      iva10RateId = requireRate("IVA_10");
    }, 30_000);

    it("creates a catalog item over real HTTP and reads it back through the allowlisted DTO with one co-committed audit row and no event", async () => {
      const createRequestId = "live-pg-catalog-create";
      const itemsBefore = await prisma.catalogItem.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count({ where: { tenantId: tenantAId } });

      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", createRequestId)
        .send({
          kind: "MEDICATION",
          name: "Live Propofol 1%",
          taxRateId: iva10RateId,
          referencePriceAmount: "150000.00",
          referencePriceCurrency: "PYG",
        })
        .expect(201);

      const body = created.body as CatalogItemDto;
      catalogItemAId = body.id;
      // Allowlisted INTERNAL DTO: exact key set, no Prisma column name leaks.
      expect(Object.keys(body).sort()).toEqual(CATALOG_ITEM_DTO_KEYS);
      expect(Object.keys(body.taxRate).sort()).toEqual(["code", "name", "rate"]);
      expect(body.tenantId).toBe(tenantAId);
      expect(body.kind).toBe("MEDICATION");
      expect(body.name).toBe("Live Propofol 1%");
      expect(body.isActive).toBe(true);
      expect(body.taxRateId).toBe(iva10RateId);
      // Fixed-scale (2 decimals) at the API boundary: the column holds "10.00",
      // Prisma trims it to "10" on read, and the DTO pads it back to the stored
      // scale — the SAME exact string the in-memory boundary reports, so the
      // value is canonical rather than environment-dependent.
      expect(body.taxRate).toEqual({ code: "IVA_10", name: "IVA 10%", rate: "10.00" });
      // The pair is stored at the declared DECIMAL(14,2) scale and the DTO
      // reports the column text EXACTLY, so no padding divergence is tolerated.
      const rawPrice = await prisma.$queryRaw<{ amount: string }[]>`
        SELECT "reference_price_amount"::text AS amount
        FROM "catalog_item" WHERE "id" = ${body.id}::uuid
      `;
      expect(rawPrice).toEqual([{ amount: "150000.00" }]);
      expect(body.referencePriceAmount).toBe(rawPrice[0].amount);
      expect(body.referencePriceCurrency).toBe("PYG");
      expect(created.text).not.toContain("reference_price_amount");
      expect(created.text).not.toContain("is_active");

      // Read back through the SAME allowlisted projection: byte-identical.
      const readBack = await supertest(serverUrl)
        .get(`/catalog/${body.id}`)
        .set("Cookie", ownerACookie)
        .expect(200);
      expect(readBack.text).toBe(created.text);

      // Exactly one co-committed audit row, carrying stable ids and field NAMES.
      const audit = await prisma.auditLog.findMany({ where: { requestId: createRequestId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "catalog_item.created",
        targetType: "catalog_item",
        targetId: body.id,
        tenantId: tenantAId,
      });
      const metadata = audit[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual([
        "kind",
        "name",
        "taxRateId",
        "referencePriceAmount",
        "referencePriceCurrency",
      ]);
      const serializedMetadata = JSON.stringify(metadata);
      expect(serializedMetadata).not.toContain("Live Propofol");
      expect(serializedMetadata).not.toContain("150000");
      expect(serializedMetadata).not.toContain("PYG");

      // The mutation's complete durable side effect is the item row plus that
      // ONE audit row. No catalog event can be durably emitted, because the
      // public schema carries no event/outbox/queue/job table at all.
      expect(await prisma.catalogItem.count({ where: { tenantId: tenantAId } })).toBe(
        itemsBefore + 1
      );
      expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } })).toBe(
        auditsBefore + 1
      );
      const eventTables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND (tablename LIKE '%event%' OR tablename LIKE '%outbox%'
               OR tablename LIKE '%queue%' OR tablename LIKE '%job%')
      `;
      expect(eventTables).toEqual([]);
    }, 30_000);

    it("updates and deactivates the live item, each co-committing exactly one audit row and emitting no event", async () => {
      const updateRequestId = "live-pg-catalog-update";
      const updated = await supertest(serverUrl)
        .put(`/catalog/${catalogItemAId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", updateRequestId)
        .send({ kind: "PRODUCT", name: "Live Propofol 1% (edited)" })
        .expect(200);
      const updatedBody = updated.body as CatalogItemDto;
      expect(Object.keys(updatedBody).sort()).toEqual(CATALOG_ITEM_DTO_KEYS);
      expect(updatedBody.id).toBe(catalogItemAId);
      expect(updatedBody.kind).toBe("PRODUCT");
      expect(updatedBody.name).toBe("Live Propofol 1% (edited)");
      // An omitted taxRateId leaves the selected GLOBAL rate untouched.
      expect(updatedBody.taxRateId).toBe(iva10RateId);
      expect(updatedBody.isActive).toBe(true);

      const updateAudit = await prisma.auditLog.findMany({ where: { requestId: updateRequestId } });
      expect(updateAudit).toHaveLength(1);
      expect(updateAudit[0]).toMatchObject({
        action: "catalog_item.updated",
        targetType: "catalog_item",
        targetId: catalogItemAId,
        tenantId: tenantAId,
      });
      expect((updateAudit[0].metadata as { changedFields: string[] }).changedFields).toEqual([
        "kind",
        "name",
      ]);

      const deactivateRequestId = "live-pg-catalog-deactivate";
      const deactivated = await supertest(serverUrl)
        .post(`/catalog/${catalogItemAId}/deactivate`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", deactivateRequestId)
        .expect(201);
      expect((deactivated.body as CatalogItemDto).isActive).toBe(false);
      // Deactivation is a state change, never a removal.
      expect(await prisma.catalogItem.count({ where: { id: catalogItemAId } })).toBe(1);

      const deactivateAudit = await prisma.auditLog.findMany({
        where: { requestId: deactivateRequestId },
      });
      expect(deactivateAudit).toHaveLength(1);
      expect(deactivateAudit[0]).toMatchObject({
        action: "catalog_item.deactivated",
        targetType: "catalog_item",
        targetId: catalogItemAId,
      });
      expect((deactivateAudit[0].metadata as { changedFields: string[] }).changedFields).toEqual([
        "isActive",
      ]);

      // A repeat deactivation still co-commits exactly ONE audit row, now with
      // an EMPTY diff because no field actually changed (idempotency pinned).
      const repeatRequestId = "live-pg-catalog-deactivate-repeat";
      const repeated = await supertest(serverUrl)
        .post(`/catalog/${catalogItemAId}/deactivate`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", repeatRequestId)
        .expect(201);
      expect((repeated.body as CatalogItemDto).isActive).toBe(false);
      const repeatAudit = await prisma.auditLog.findMany({ where: { requestId: repeatRequestId } });
      expect(repeatAudit).toHaveLength(1);
      expect((repeatAudit[0].metadata as { changedFields: string[] }).changedFields).toEqual([]);
    }, 30_000);

    it("masks tenant A's item as a byte-equivalent 404 to an unknown UUID on read, update and deactivate, leaving A untouched", async () => {
      const rowBefore = await prisma.catalogItem.findUnique({ where: { id: catalogItemAId } });
      const targetAuditsBefore = await prisma.auditLog.count({
        where: { targetId: catalogItemAId },
      });

      const cases = [
        {
          label: "GET /catalog/:id",
          request: () =>
            supertest(serverUrl)
              .get(`/catalog/${catalogItemAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CATALOG_NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/catalog/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CATALOG_NOT_FOUND_REQUEST_ID),
        },
        {
          label: "PUT /catalog/:id",
          request: () =>
            supertest(serverUrl)
              .put(`/catalog/${catalogItemAId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CATALOG_NOT_FOUND_REQUEST_ID)
              .send({ name: "Tampered by tenant B" }),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/catalog/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CATALOG_NOT_FOUND_REQUEST_ID)
              .send({ name: "Tampered by tenant B" }),
        },
        {
          label: "POST /catalog/:id/deactivate",
          request: () =>
            supertest(serverUrl)
              .post(`/catalog/${catalogItemAId}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CATALOG_NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/catalog/${randomUUID()}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", CATALOG_NOT_FOUND_REQUEST_ID),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
        // non-existent one, body and echoed correlation alike.
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(catalogItemAId);
        expect(response.text, scenario.label).not.toContain(tenantAId);
      }

      // Tenant A's row and audit trail are exactly as tenant A's own writes
      // left them: the masked cross-tenant attempts persisted nothing.
      expect(await prisma.catalogItem.findUnique({ where: { id: catalogItemAId } })).toEqual(
        rowBefore
      );
      expect(await prisma.auditLog.count({ where: { targetId: catalogItemAId } })).toBe(
        targetAuditsBefore
      );
      expect(
        await prisma.auditLog.count({ where: { requestId: CATALOG_NOT_FOUND_REQUEST_ID } })
      ).toBe(0);
      expect(
        await prisma.catalogItem.count({ where: { id: catalogItemAId, tenantId: tenantBId } })
      ).toBe(0);
    }, 30_000);

    it("serves the three globally seeded rates to both tenants and rejects an item with an unknown rate id, persisting nothing", async () => {
      // Real at the database level: exactly three GLOBAL rows (no tenant
      // column) carrying the exact PRD §15 `Decimal(5,2)` literals, inserted by
      // the seed and not by the migration.
      const seedRows = await prisma.$queryRaw<{ code: string; rate: string }[]>`
        SELECT "code", "rate"::text AS rate FROM "tax_rate" ORDER BY "code"
      `;
      // Lexicographic `code` order, exact padded column text: exactly the three
      // PRD §15 rates, inserted by the seed and not by the migration.
      expect(seedRows.map((row) => [row.code, row.rate])).toEqual([
        ["EXEMPT", "0.00"],
        ["IVA_10", "10.00"],
        ["IVA_5", "5.00"],
      ]);
      const tenantColumns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tax_rate' AND column_name = 'tenant_id'
      `;
      expect(tenantColumns).toEqual([]);

      // The SAME three rows are served identically to BOTH tenants...
      const ratesForA = await supertest(serverUrl)
        .get("/catalog/tax-rates")
        .set("Cookie", ownerACookie)
        .expect(200);
      const ratesForB = await supertest(serverUrl)
        .get("/catalog/tax-rates")
        .set("Cookie", ownerBCookie)
        .expect(200);
      expect(ratesForA.text).toBe(ratesForB.text);
      const rates = ratesForA.body as TaxRateDto[];
      for (const rate of rates) {
        expect(Object.keys(rate).sort(), rate.code).toEqual(TAX_RATE_DTO_KEYS);
      }
      // The list is ordered by `code` ascending, which is lexicographic: IVA_10
      // precedes IVA_5.
      expect(rates.map((rate) => rate.code)).toEqual(["EXEMPT", "IVA_10", "IVA_5"]);
      const ratesByCode = new Map(rates.map((rate) => [rate.code, rate]));
      for (const seed of SEEDED_TAX_RATES) {
        const rate = ratesByCode.get(seed.code);
        expect(rate?.name, seed.code).toBe(seed.name);
        // The DTO reports the seeded two-decimal literal EXACTLY — the same
        // string the column holds, not a trimmed form.
        expect(rate?.rate, seed.code).toBe(seed.rate);
      }
      // ...and they ARE the seeded database rows, not a projection of a cache.
      expect(rates.map((rate) => rate.id).sort()).toEqual(
        [exemptRateId, iva5RateId, iva10RateId].sort()
      );

      // An unknown rate id is rejected before any write: no item, no audit row.
      const requestId = "live-pg-catalog-unknown-rate";
      const itemsBefore = await prisma.catalogItem.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count({ where: { tenantId: tenantAId } });
      const rejected = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({ kind: "SUPPLY", name: "No Such Rate", taxRateId: randomUUID() })
        .expect(400);
      expect((rejected.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
      expect(await prisma.catalogItem.count({ where: { tenantId: tenantAId } })).toBe(itemsBefore);
      expect(await prisma.catalogItem.count({ where: { name: "No Such Rate" } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } })).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);

      // The required rate is a REAL precondition, not just a Zod rule: with the
      // service bypassed entirely a raw insert with an unknown rate id is
      // rejected by the RESTRICT foreign key, so no rate-less item can exist.
      const bypassedInsert = () =>
        prisma.$executeRaw`
          INSERT INTO "catalog_item" ("tenant_id", "kind", "name", "tax_rate_id")
          VALUES (${tenantAId}::uuid, 'SUPPLY'::catalog_item_kind, 'Bypassed Rate Probe', ${randomUUID()}::uuid)
        `;
      await expect(bypassedInsert()).rejects.toThrow(/catalog_item_tax_rate_id_fkey/);
      expect(await prisma.catalogItem.count({ where: { tenantId: tenantAId } })).toBe(itemsBefore);
    }, 30_000);

    it("proves the delete-rejecting trigger and the reference-price pair CHECK at the database level", async () => {
      // Mirrors the EPIC-06 clinical proof: the BEFORE DELETE trigger raises and
      // the row physically survives.
      const rowBefore = await prisma.catalogItem.findUnique({ where: { id: catalogItemAId } });
      expect(rowBefore).not.toBeNull();
      const hardDelete = prisma.$executeRaw`DELETE FROM "catalog_item" WHERE "id" = ${catalogItemAId}::uuid`;
      await expect(hardDelete).rejects.toThrow(/cannot be hard-deleted/);
      const surviving = await prisma.$queryRaw<{ rows: number }[]>`
        SELECT count(*)::int AS rows FROM "catalog_item" WHERE "id" = ${catalogItemAId}::uuid
      `;
      expect(surviving).toEqual([{ rows: 1 }]);
      expect(await prisma.catalogItem.findUnique({ where: { id: catalogItemAId } })).toEqual(
        rowBefore
      );

      // The migration's amount/currency pair CHECK is real too: an amount
      // without a currency (and the reverse) is refused by PostgreSQL, so a
      // half pair can never be stored even by raw SQL.
      const itemsBefore = await prisma.catalogItem.count();
      const pairViolations = [
        // Amount supplied, currency absent.
        () =>
          prisma.$executeRaw`
            INSERT INTO "catalog_item" ("tenant_id", "kind", "name", "tax_rate_id", "reference_price_amount")
            VALUES (${tenantAId}::uuid, 'PRODUCT'::catalog_item_kind, 'Pair Probe Amount Only', ${iva5RateId}::uuid, 1500.00)
          `,
        // Currency supplied, amount absent.
        () =>
          prisma.$executeRaw`
            INSERT INTO "catalog_item" ("tenant_id", "kind", "name", "tax_rate_id", "reference_price_currency")
            VALUES (${tenantAId}::uuid, 'PRODUCT'::catalog_item_kind, 'Pair Probe Currency Only', ${iva5RateId}::uuid, 'PYG')
          `,
      ];
      for (const insert of pairViolations) {
        await expect(insert()).rejects.toThrow(/catalog_item_reference_price_pair_check/);
      }
      expect(await prisma.catalogItem.count()).toBe(itemsBefore);
      expect(
        await prisma.catalogItem.count({
          where: { name: { in: ["Pair Probe Amount Only", "Pair Probe Currency Only"] } },
        })
      ).toBe(0);
    }, 30_000);

    it("keeps the item mutation and its audit row atomically visible under a concurrent reader (co-commit invariant)", async () => {
      // A second item, so the masking and audit assertions above stay untouched.
      const concurrentName = "Live Concurrent Consulta";
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", "live-pg-catalog-concurrency-create")
        .send({ kind: "SERVICE", name: concurrentName, taxRateId: exemptRateId })
        .expect(201);
      const concurrentItemId = (created.body as CatalogItemDto).id;

      const updateRequestId = "live-pg-catalog-concurrency-update";
      const renamed = "Live Concurrent Consulta v2";

      // Deterministic barrier: hold a SHARE table lock on `audit_log`. SHARE
      // conflicts with the ROW EXCLUSIVE an INSERT needs, so the writer parks on
      // its audit append AFTER the item UPDATE has already run inside its still
      // open transaction — while every SELECT (ACCESS SHARE) stays allowed, so
      // the concurrent reader is never blocked by the barrier itself.
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
          await tx.$executeRawUnsafe('LOCK TABLE "audit_log" IN SHARE MODE');
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;

      const write = supertest(serverUrl)
        .put(`/catalog/${concurrentItemId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", updateRequestId)
        .send({ name: renamed })
        .then((response) => response);

      try {
        // The writer is PROVABLY parked on the audit_log relation lock, so its
        // item UPDATE is mid-transaction and uncommitted.
        await waitForRelationLockWaiters(prisma, "audit_log", 1, 10_000);

        // No reader may observe the rename before its audit row exists: both
        // the HTTP read and a raw read still see the pre-state, and the trail
        // holds no row for the in-flight request yet.
        const whileBlocked = await supertest(serverUrl)
          .get(`/catalog/${concurrentItemId}`)
          .set("Cookie", ownerACookie)
          .expect(200);
        expect((whileBlocked.body as CatalogItemDto).name).toBe(concurrentName);
        const rawWhileBlocked = await prisma.catalogItem.findUnique({
          where: { id: concurrentItemId },
        });
        expect(rawWhileBlocked?.name).toBe(concurrentName);
        expect(await prisma.auditLog.count({ where: { requestId: updateRequestId } })).toBe(0);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const written = await write;
      expect(written.status).toBe(200);
      expect((written.body as CatalogItemDto).name).toBe(renamed);

      // After the commit BOTH halves are visible TOGETHER — the renamed item and
      // exactly one co-committed audit row, never a partial state.
      const after = await supertest(serverUrl)
        .get(`/catalog/${concurrentItemId}`)
        .set("Cookie", ownerACookie)
        .expect(200);
      expect((after.body as CatalogItemDto).name).toBe(renamed);
      const audit = await prisma.auditLog.findMany({ where: { requestId: updateRequestId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "catalog_item.updated",
        targetType: "catalog_item",
        targetId: concurrentItemId,
        tenantId: tenantAId,
      });
      expect((audit[0].metadata as { changedFields: string[] }).changedFields).toEqual(["name"]);
    }, 30_000);

    it("attributes the isActive flip to exactly ONE of two concurrent deactivations of the same item", async () => {
      const itemName = "Live Concurrent Deactivation";
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", "live-pg-catalog-race-create")
        .send({ kind: "SUPPLY", name: itemName, taxRateId: exemptRateId })
        .expect(201);
      const raceItemId = (created.body as CatalogItemDto).id;

      const winnerRequestId = "live-pg-catalog-race-deactivate-1";
      const loserRequestId = "live-pg-catalog-race-deactivate-2";

      // Deterministic overlap: a dedicated transaction holds the item's row lock
      // (`SELECT ... FOR UPDATE`), so both racers park on the SAME conditional
      // `isActive = true` UPDATE and neither can commit before the other is
      // parked. A plain reader is never blocked by a row lock, so the pre-state
      // read this command used to perform also happened before either write —
      // which is exactly why the LOSER must not claim the flip.
      // `waitForRowLockWaiters` proves both are parked on that exact tuple, so the
      // interleaving is decided by the database boundary rather than by timing.
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
          await tx.$queryRaw`SELECT id FROM "catalog_item" WHERE id = ${raceItemId}::uuid FOR UPDATE`;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;
      // The row lock is held now, so the ctid cannot move under the racers.
      const ctid = await readRowCtid(prisma, "catalog_item", raceItemId);

      const deactivate = (requestId: string) =>
        supertest(serverUrl)
          .post(`/catalog/${raceItemId}/deactivate`)
          .set("Cookie", ownerACookie)
          .set("X-Request-Id", requestId)
          .then((response) => response);
      const racers = [deactivate(winnerRequestId), deactivate(loserRequestId)];

      try {
        await waitForRowLockWaiters(prisma, "catalog_item", ctid.page, ctid.tuple, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      for (const response of responses) {
        expect(response.status).toBe(201);
        expect((response.body as CatalogItemDto).isActive).toBe(false);
      }

      // Deactivation stays idempotent: both accepted commands co-commit their
      // own trail row...
      const trail = await prisma.auditLog.findMany({
        where: { requestId: { in: [winnerRequestId, loserRequestId] } },
      });
      expect(trail).toHaveLength(2);
      expect(trail.map((row) => row.action)).toEqual([
        "catalog_item.deactivated",
        "catalog_item.deactivated",
      ]);
      expect(trail.map((row) => row.targetId)).toEqual([raceItemId, raceItemId]);

      // ...but only ONE of them actually flipped `isActive`. The loser's own
      // conditional update matched ZERO rows once the winner committed, so its
      // diff is empty — an isActive change may never be reported twice for one
      // physical transition.
      const diffs = trail.map((row) => (row.metadata as { changedFields: string[] }).changedFields);
      expect(diffs.filter((diff) => diff.includes("isActive"))).toHaveLength(1);
      expect(diffs.filter((diff) => diff.length === 0)).toHaveLength(1);
      expect(await prisma.catalogItem.count({ where: { id: raceItemId } })).toBe(1);
    }, 30_000);
  });

  /**
   * EPIC-10 W3 live-PostgreSQL evidence (CAT-006/CAT-007 closure, task W3).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP, real row locks and the migration's real DDL — what the in-memory
   * boundary cannot represent:
   *   1. a signed adjustment co-commits ONE immutable movement, the exact
   *      projection and exactly ONE audit row;
   *   2. the fixed `BLOCK` policy persists nothing when it rejects, and accepts
   *      an output that lands exactly on zero;
   *   3. the `BLOCK` race is decided by a PROVEN database overlap, admits
   *      exactly one output and never drives the balance negative;
   *   4. immutability and the non-negative projection hold against RAW SQL
   *      because the trigger and the CHECKs are real;
   *   5. another tenant's item id is a byte-equivalent 404 with the owner's
   *      ledger untouched.
   *
   * The ledger is the source of truth, so every acceptance also compares the
   * projection with the raw SIGNED sum of its movements: a lost update that
   * left the balance non-negative but diverged from the ledger would fail here.
   */
  describe("EPIC-10 inventory application-path isolation", () => {
    /** Global SEED-owned EXEMPT rate, the catalog precondition for an item. */
    let exemptRateId: string;
    /** Tenant A item funded by the first adjustment; reused by the raw-SQL probe. */
    let stockedItemAId: string;
    /** First movement insert of that item: the immutability probe target. */
    let openingMovementAId: string;
    /** The single projection row of that item: the balance CHECK probe target. */
    let openingBalanceAId: string;
    /** Tenant B item whose id tenant A must never resolve. */
    let foreignItemBId: string;
    /** Tenant B's own ledger row for that item. */
    let foreignMovementBId: string;

    /** Creates a tenant item through the REAL catalog command (by-kind tracking). */
    const createStockedItem = async (cookie: string, name: string): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", cookie)
        .send({ kind: "PRODUCT", name, taxRateId: exemptRateId })
        .expect(201);
      return (created.body as { id: string }).id;
    };

    /** One SIGNED adjustment over real HTTP, with a pinned correlation id. */
    const adjust = (
      cookie: string,
      catalogItemId: string,
      quantity: string,
      requestId: string,
      reason = "Live adjustment"
    ) =>
      supertest(serverUrl)
        .post("/inventory/stock/adjustments")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .send({ catalogItemId, quantity, reason });

    /**
     * Raw `DECIMAL(10,3)` column text of one item's projection, or `null` when
     * the item has no projection row. The stored scale is read from PostgreSQL
     * itself, so a padded DTO can never masquerade as the stored value.
     */
    const rawBalanceText = async (
      tenantId: string,
      catalogItemId: string
    ): Promise<string | null> => {
      const rows = await prisma.$queryRaw<{ quantity: string }[]>`
        SELECT "quantity"::text AS quantity FROM "stock_balance"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
      `;
      return rows[0]?.quantity ?? null;
    };

    /** Raw SIGNED sum of one item's movements at the projection's exact scale. */
    const rawLedgerSum = async (tenantId: string, catalogItemId: string): Promise<string> => {
      const rows = await prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(sum("quantity"), 0)::numeric(10,3)::text AS total
        FROM "stock_movement"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
      `;
      return rows[0]?.total ?? "0.000";
    };

    beforeAll(async () => {
      // The rate row is SEED-owned, so resolving it proves the reference seed
      // really ran against this database.
      const exempt = await prisma.taxRate.findUnique({ where: { code: "EXEMPT" } });
      if (!exempt) {
        throw new Error("Reference seed did not create the global EXEMPT tax rate");
      }
      exemptRateId = exempt.id;

      // Tenant B's own stocked item, funded by tenant B's own command: the
      // cross-tenant probes below need a REAL foreign ledger to leave intact.
      foreignItemBId = await createStockedItem(ownerBCookie, "Live Foreign Stocked Item");
      const funded = await adjust(
        ownerBCookie,
        foreignItemBId,
        "99.000",
        "live-pg-inventory-foreign-fund",
        "Foreign opening count"
      ).expect(201);
      foreignMovementBId = (funded.body as StockMovementDto).id;
    }, 30_000);

    it("creates one immutable movement, moves the balance to the exact quantity and appends exactly one co-committed audit row per signed adjustment", async () => {
      const itemId = await createStockedItem(ownerACookie, "Live Gasa estéril");
      stockedItemAId = itemId;
      const inputRequestId = "live-pg-inventory-adjust-input";
      const movementsBefore = await prisma.stockMovement.count();
      const balancesBefore = await prisma.stockBalance.count();
      const auditsBefore = await prisma.auditLog.count();

      // A POSITIVE quantity is an input.
      const input = await adjust(
        ownerACookie,
        itemId,
        "10.000",
        inputRequestId,
        "Live opening count"
      ).expect(201);
      const body = input.body as StockMovementDto;
      expect(Object.keys(body).sort()).toEqual(STOCK_MOVEMENT_DTO_KEYS);
      expect(body.tenantId).toBe(tenantAId);
      expect(body.catalogItemId).toBe(itemId);
      expect(body.type).toBe("ADJUSTMENT");
      expect(body.quantity).toBe("10.000");
      expect(body.reason).toBe("Live opening count");
      // The reserved compensating link is never populated in this slice.
      expect(body.reversesMovementId).toBeNull();
      // No Prisma column name crosses the HTTP boundary.
      expect(input.text).not.toContain("catalog_item_id");
      expect(input.text).not.toContain("reverses_movement_id");

      // The movement is CREATED CONFIRMED: the ledger has no draft/status
      // column at all, so a movement cannot represent an unconfirmed state.
      const statusColumn = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stock_movement' AND column_name = 'status'
      `;
      expect(statusColumn).toEqual([]);

      openingMovementAId = body.id;
      const rawMovement = await prisma.$queryRaw<
        { quantity: string; movement_type: string; reverses: string | null }[]
      >`
        SELECT "quantity"::text AS quantity, "type"::text AS movement_type,
               "reverses_movement_id"::text AS reverses
        FROM "stock_movement" WHERE "id" = ${body.id}::uuid
      `;
      // Exact stored DECIMAL(10,3) text: the column holds the submitted value.
      expect(rawMovement).toEqual([
        { quantity: "10.000", movement_type: "ADJUSTMENT", reverses: null },
      ]);

      // The projection is the ledger's sum, stored at the same exact scale.
      expect(await rawBalanceText(tenantAId, itemId)).toBe("10.000");
      expect(await rawLedgerSum(tenantAId, itemId)).toBe("10.000");
      const balanceRow = await prisma.stockBalance.findFirst({
        where: { tenantId: tenantAId, catalogItemId: itemId },
      });
      expect(balanceRow).not.toBeNull();
      openingBalanceAId = balanceRow!.id;
      // ONE row per (tenant, item): the upsert target, never an accumulation.
      expect(
        await prisma.stockBalance.count({ where: { tenantId: tenantAId, catalogItemId: itemId } })
      ).toBe(1);

      // Exactly one co-committed audit row carrying stable ids and field NAMES.
      const audit = await prisma.auditLog.findMany({ where: { requestId: inputRequestId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "stock_movement.created",
        targetType: "stock_movement",
        targetId: body.id,
        tenantId: tenantAId,
      });
      const metadata = audit[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual(["quantity", "reason"]);
      // The reason VALUE and the quantity VALUE never reach the trail.
      const serializedMetadata = JSON.stringify(metadata);
      expect(serializedMetadata).not.toContain("Live opening count");
      expect(serializedMetadata).not.toContain("10.000");

      // The command's complete durable side effect: one movement, one
      // projection row and ONE audit row above the pre-command counts.
      expect(await prisma.stockMovement.count()).toBe(movementsBefore + 1);
      expect(await prisma.stockBalance.count()).toBe(balancesBefore + 1);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);

      // The read path projects the exact fixed-scale balance with the item
      // identity through the allowlisted DTO.
      const listed = await supertest(serverUrl)
        .get("/inventory/stock")
        .set("Cookie", ownerACookie)
        .expect(200);
      const listedRow = (listed.body as StockBalanceDto[]).find(
        (entry) => entry.catalogItemId === itemId
      );
      expect(listedRow).toBeDefined();
      expect(Object.keys(listedRow ?? {}).sort()).toEqual(STOCK_BALANCE_DTO_KEYS);
      expect(Object.keys(listedRow?.item ?? {}).sort()).toEqual(STOCK_ITEM_PROJECTION_KEYS);
      expect(listedRow?.quantity).toBe("10.000");
      expect(listedRow?.item).toEqual({ name: "Live Gasa estéril", kind: "PRODUCT" });

      // A NEGATIVE quantity is an output and moves the balance back.
      const outputRequestId = "live-pg-inventory-adjust-output";
      const output = await adjust(
        ownerACookie,
        itemId,
        "-4.000",
        outputRequestId,
        "Live consumption"
      ).expect(201);
      const outputBody = output.body as StockMovementDto;
      expect(outputBody.quantity).toBe("-4.000");
      expect(outputBody.reason).toBe("Live consumption");
      expect(outputBody.reversesMovementId).toBeNull();
      expect(await rawBalanceText(tenantAId, itemId)).toBe("6.000");
      expect(await rawLedgerSum(tenantAId, itemId)).toBe("6.000");

      // Two movements, ONE projection row, two audit rows: the second command
      // appended its own trail entry and rewrote no ledger row.
      expect(await prisma.stockMovement.count({ where: { catalogItemId: itemId } })).toBe(2);
      expect(
        await prisma.stockBalance.count({ where: { tenantId: tenantAId, catalogItemId: itemId } })
      ).toBe(1);
      expect(await prisma.auditLog.count({ where: { requestId: outputRequestId } })).toBe(1);
      const stillRaw = await prisma.$queryRaw<
        { quantity: string; movement_type: string; reverses: string | null }[]
      >`
        SELECT "quantity"::text AS quantity, "type"::text AS movement_type,
               "reverses_movement_id"::text AS reverses
        FROM "stock_movement" WHERE "id" = ${openingMovementAId}::uuid
      `;
      expect(stillRaw).toEqual(rawMovement);

      // The immutable ledger keeps the SIGN of every entry.
      const signed = await prisma.$queryRaw<{ quantity: string }[]>`
        SELECT "quantity"::text AS quantity FROM "stock_movement"
        WHERE "tenant_id" = ${tenantAId}::uuid AND "catalog_item_id" = ${itemId}::uuid
      `;
      expect(signed.map((row) => row.quantity).sort()).toEqual(["-4.000", "10.000"]);
    }, 30_000);

    it("persists nothing when the fixed BLOCK policy rejects, and accepts an output that lands exactly on zero", async () => {
      // From an EMPTY balance even one unit out is rejected.
      const emptyItemId = await createStockedItem(ownerACookie, "Live Sin stock");
      const movementsBefore = await prisma.stockMovement.count();
      const balancesBefore = await prisma.stockBalance.count();
      const auditsBefore = await prisma.auditLog.count();
      const fromZeroRequestId = "live-pg-inventory-block-empty";

      const fromZero = await adjust(
        ownerACookie,
        emptyItemId,
        "-1.000",
        fromZeroRequestId,
        "Sin stock"
      ).expect(409);
      expect((fromZero.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((fromZero.body as { error: { message: string } }).error.message).toBe(
        "The adjustment would drive the stock balance below zero."
      );
      // The rejection rolled back: no projection row, no movement, no audit.
      expect(await rawBalanceText(tenantAId, emptyItemId)).toBeNull();
      expect(await prisma.stockMovement.count()).toBe(movementsBefore);
      expect(await prisma.stockBalance.count()).toBe(balancesBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId: fromZeroRequestId } })).toBe(0);

      // One thousandth past a funded balance is still an overdraw: the rule is
      // exact Decimal(10,3) arithmetic, not a coerced float.
      const fundedItemId = await createStockedItem(ownerACookie, "Live Propofol 1%");
      await adjust(
        ownerACookie,
        fundedItemId,
        "5.000",
        "live-pg-inventory-block-fund",
        "Live funding"
      ).expect(201);
      const fundedMovements = await prisma.stockMovement.count();
      const fundedBalances = await prisma.stockBalance.count();
      const fundedAudits = await prisma.auditLog.count();

      const overdrawRequestId = "live-pg-inventory-block-overdraw";
      const overdraw = await adjust(
        ownerACookie,
        fundedItemId,
        "-5.001",
        overdrawRequestId,
        "One thousandth past"
      ).expect(409);
      expect((overdraw.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect(await rawBalanceText(tenantAId, fundedItemId)).toBe("5.000");
      expect(await rawLedgerSum(tenantAId, fundedItemId)).toBe("5.000");
      expect(await prisma.stockMovement.count()).toBe(fundedMovements);
      expect(await prisma.stockBalance.count()).toBe(fundedBalances);
      expect(await prisma.auditLog.count()).toBe(fundedAudits);
      expect(await prisma.auditLog.count({ where: { requestId: overdrawRequestId } })).toBe(0);

      // Exactly zero is NOT negative: an output that empties the balance is
      // accepted and the projection row SURVIVES at zero.
      const toZeroRequestId = "live-pg-inventory-block-to-zero";
      await adjust(ownerACookie, fundedItemId, "-5.000", toZeroRequestId, "Ajuste a cero").expect(
        201
      );
      expect(await rawBalanceText(tenantAId, fundedItemId)).toBe("0.000");
      expect(await rawLedgerSum(tenantAId, fundedItemId)).toBe("0.000");
      expect(
        await prisma.stockBalance.count({
          where: { tenantId: tenantAId, catalogItemId: fundedItemId },
        })
      ).toBe(1);
      expect(await prisma.auditLog.count({ where: { requestId: toZeroRequestId } })).toBe(1);
      // Still never negative anywhere, and the ledger sum equals the projection.
      const negative = await prisma.$queryRaw<{ rows: number }[]>`
        SELECT count(*)::int AS rows FROM "stock_balance" WHERE "quantity" < 0
      `;
      expect(negative).toEqual([{ rows: 0 }]);
    }, 30_000);

    it("admits exactly one of two concurrent overdrawing outputs under a proven transaction-scoped overlap", async () => {
      const raceItemId = await createStockedItem(ownerACookie, "Live Concurrent Overdraw");
      await adjust(
        ownerACookie,
        raceItemId,
        "10.000",
        "live-pg-inventory-race-fund",
        "Live race funding"
      ).expect(201);

      const movementsBefore = await prisma.stockMovement.count({
        where: { catalogItemId: raceItemId },
      });
      const firstRequestId = "live-pg-inventory-block-race-1";
      const secondRequestId = "live-pg-inventory-block-race-2";

      // Deterministic overlap: a dedicated transaction holds the SAME
      // transaction-scoped advisory lock the command takes for this
      // `(tenant, item)`, so BOTH outputs park on that exact key before either
      // one can read the projection. `waitForAdvisoryLockWaiters` matches the
      // reconstructed 64-bit key, so an unrelated lock waiter can never satisfy
      // it: the interleaving is decided by the database, never by wall-clock
      // timing.
      const lockKey = stockSerializationLockKey(tenantAId, raceItemId);
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

      const racers = [
        adjust(ownerACookie, raceItemId, "-7.000", firstRequestId, "Race output one").then(
          (response) => response
        ),
        adjust(ownerACookie, raceItemId, "-7.000", secondRequestId, "Race output two").then(
          (response) => response
        ),
      ];

      try {
        await waitForAdvisoryLockWaiters(prisma, lockKey, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      // Regression for the lost update this case FIRST exposed (both outputs
      // returned 201, the projection ended at "3.000" against a ledger sum of
      // "-4.000"): the per-`(tenant, item)` advisory lock now makes the `BLOCK`
      // pre-check and the absolute balance write ONE serialized
      // read-modify-write, so exactly one output commits and the projection
      // stays the ledger's signed sum. The overlap above is still proven by the
      // database, not by timing.
      const admitted = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected[0].body as { error: { message: string } }).error.message).toBe(
        "The adjustment would drive the stock balance below zero."
      );
      const admittedMovementId = (admitted[0].body as StockMovementDto).id;

      // The projection is the ledger's SIGNED sum: exactly one output
      // committed, so the balance is 3.000 and the loser left NO movement and
      // NO audit row behind. A lost update would leave the projection
      // non-negative but DIFFERENT from the ledger sum, so this comparison is
      // what makes the atomicity claim real.
      expect(await rawBalanceText(tenantAId, raceItemId)).toBe("3.000");
      expect(await rawLedgerSum(tenantAId, raceItemId)).toBe("3.000");
      expect(await prisma.stockMovement.count({ where: { catalogItemId: raceItemId } })).toBe(
        movementsBefore + 1
      );
      expect(
        await prisma.stockBalance.count({
          where: { tenantId: tenantAId, catalogItemId: raceItemId },
        })
      ).toBe(1);
      const raceAudits = await prisma.auditLog.findMany({
        where: { requestId: { in: [firstRequestId, secondRequestId] } },
      });
      expect(raceAudits).toHaveLength(1);
      expect(raceAudits[0]).toMatchObject({
        action: "stock_movement.created",
        targetType: "stock_movement",
        targetId: admittedMovementId,
        tenantId: tenantAId,
      });
      // The balance was never driven negative at any point.
      const negative = await prisma.$queryRaw<{ rows: number }[]>`
        SELECT count(*)::int AS rows FROM "stock_balance" WHERE "quantity" < 0
      `;
      expect(negative).toEqual([{ rows: 0 }]);
    }, 30_000);

    it("rejects a raw DELETE at the immutability trigger and a negative projection at the balance CHECK", async () => {
      // The deletion this slice can never issue is refused by the migration's
      // BEFORE DELETE row trigger, and the movement physically survives.
      const movementBefore = await prisma.stockMovement.findUnique({
        where: { id: openingMovementAId },
      });
      expect(movementBefore).not.toBeNull();

      const triggers = await prisma.$queryRaw<
        { tgname: string; tgtype: number; proname: string }[]
      >`
        SELECT t.tgname, t.tgtype::int AS tgtype, p.proname
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_proc AS p ON p.oid = t.tgfoid
        WHERE c.relname = 'stock_movement' AND NOT t.tgisinternal
        ORDER BY t.tgname
      `;
      expect(triggers).toHaveLength(1);
      expect(triggers[0].tgname).toBe("stock_movement_no_delete_trigger");
      expect(triggers[0].proname).toBe("stock_movement_no_delete");
      // BEFORE (2) | DELETE (8) | ROW (1), and NOT UPDATE (16): the ledger
      // declares no update semantics of any kind.
      expect(triggers[0].tgtype & 1).toBe(1);
      expect(triggers[0].tgtype & 2).toBe(2);
      expect(triggers[0].tgtype & 8).toBe(8);
      expect(triggers[0].tgtype & 16).toBe(0);

      await expect(
        prisma.$executeRaw`DELETE FROM "stock_movement" WHERE "id" = ${openingMovementAId}::uuid`
      ).rejects.toThrow(/cannot be hard-deleted/);
      expect(await prisma.stockMovement.findUnique({ where: { id: openingMovementAId } })).toEqual(
        movementBefore
      );

      // The balance CHECK is the last line of defence: raw SQL cannot drive an
      // existing projection negative...
      await expect(
        prisma.$executeRaw`UPDATE "stock_balance" SET "quantity" = -0.001 WHERE "id" = ${openingBalanceAId}::uuid`
      ).rejects.toThrow(/stock_balance_quantity_non_negative/);
      expect(await rawBalanceText(tenantAId, stockedItemAId)).toBe("6.000");

      // ...nor insert a negative projection row for another item.
      const checkItemId = await createStockedItem(ownerACookie, "Live CHECK probe");
      await expect(
        prisma.$executeRaw`
          INSERT INTO "stock_balance" ("tenant_id", "catalog_item_id", "quantity")
          VALUES (${tenantAId}::uuid, ${checkItemId}::uuid, -1.000)
        `
      ).rejects.toThrow(/stock_balance_quantity_non_negative/);
      expect(await rawBalanceText(tenantAId, checkItemId)).toBeNull();

      // The signed-quantity CHECK is real too: a zero movement is not a movement.
      await expect(
        prisma.$executeRaw`
          INSERT INTO "stock_movement" ("tenant_id", "catalog_item_id", "type", "quantity", "reason")
          VALUES (${tenantAId}::uuid, ${checkItemId}::uuid, 'ADJUSTMENT'::stock_movement_type, 0.000, 'Zero probe')
        `
      ).rejects.toThrow(/stock_movement_quantity_non_zero/);
      expect(await prisma.stockMovement.count({ where: { catalogItemId: checkItemId } })).toBe(0);

      // The composite tenant-ownership FK is real as well: a raw movement can
      // never reference another tenant's item, whatever the application does.
      await expect(
        prisma.$executeRaw`
          INSERT INTO "stock_movement" ("tenant_id", "catalog_item_id", "type", "quantity", "reason")
          VALUES (${tenantAId}::uuid, ${foreignItemBId}::uuid, 'ADJUSTMENT'::stock_movement_type, 1.000, 'Composite FK probe')
        `
      ).rejects.toThrow(/stock_movement_tenant_id_catalog_item_id_fkey/);
      expect(await prisma.stockMovement.count({ where: { catalogItemId: checkItemId } })).toBe(0);
    }, 30_000);

    it("masks another tenant's item id as a byte-equivalent 404 on write and read, leaving the owner's ledger untouched", async () => {
      const foreignMovementsBefore = await prisma.stockMovement.count({
        where: { tenantId: tenantBId },
      });
      const foreignBalancesBefore = await prisma.stockBalance.count({
        where: { tenantId: tenantBId },
      });
      const foreignAuditsBefore = await prisma.auditLog.count({ where: { tenantId: tenantBId } });
      const ownMovementsBefore = await prisma.stockMovement.count({
        where: { tenantId: tenantAId },
      });
      const ownAuditsBefore = await prisma.auditLog.count({ where: { tenantId: tenantAId } });
      const foreignBalanceBefore = await prisma.stockBalance.findFirst({
        where: { tenantId: tenantBId, catalogItemId: foreignItemBId },
      });

      const cases = [
        {
          label: "POST /inventory/stock/adjustments",
          request: () =>
            supertest(serverUrl)
              .post("/inventory/stock/adjustments")
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", INVENTORY_NOT_FOUND_REQUEST_ID)
              .send({ catalogItemId: foreignItemBId, quantity: "1.000", reason: "Probe" }),
          missingRequest: () =>
            supertest(serverUrl)
              .post("/inventory/stock/adjustments")
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", INVENTORY_NOT_FOUND_REQUEST_ID)
              .send({ catalogItemId: randomUUID(), quantity: "1.000", reason: "Probe" }),
        },
        {
          label: "GET /inventory/stock/movements?catalogItemId",
          request: () =>
            supertest(serverUrl)
              .get(`/inventory/stock/movements?catalogItemId=${foreignItemBId}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", INVENTORY_NOT_FOUND_REQUEST_ID),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/inventory/stock/movements?catalogItemId=${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", INVENTORY_NOT_FOUND_REQUEST_ID),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
        // non-existent one, body and echoed correlation alike.
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(foreignItemBId);
        expect(response.text, scenario.label).not.toContain(tenantBId);
      }

      // The balance and ledger READS are tenant-scoped: tenant A observes no
      // tenant B item, movement, balance or correlation.
      const balances = await supertest(serverUrl)
        .get("/inventory/stock")
        .set("Cookie", ownerACookie)
        .expect(200);
      const movements = await supertest(serverUrl)
        .get("/inventory/stock/movements")
        .set("Cookie", ownerACookie)
        .expect(200);
      for (const row of balances.body as StockBalanceDto[]) {
        expect(Object.keys(row).sort()).toEqual(STOCK_BALANCE_DTO_KEYS);
        expect(Object.keys(row.item).sort()).toEqual(STOCK_ITEM_PROJECTION_KEYS);
        expect(row.tenantId).toBe(tenantAId);
      }
      for (const row of movements.body as StockMovementDto[]) {
        expect(Object.keys(row).sort()).toEqual(STOCK_MOVEMENT_DTO_KEYS);
        expect(row.tenantId).toBe(tenantAId);
      }
      expect(balances.text).not.toContain(foreignItemBId);
      expect(balances.text).not.toContain(tenantBId);
      expect(movements.text).not.toContain(foreignItemBId);
      expect(movements.text).not.toContain(foreignMovementBId);
      expect(movements.text).not.toContain(tenantBId);

      // The owner's ledger is exactly as the owner's own command left it, and
      // the masked attempts persisted nothing anywhere.
      expect(await prisma.stockMovement.count({ where: { tenantId: tenantBId } })).toBe(
        foreignMovementsBefore
      );
      expect(await prisma.stockBalance.count({ where: { tenantId: tenantBId } })).toBe(
        foreignBalancesBefore
      );
      expect(await prisma.auditLog.count({ where: { tenantId: tenantBId } })).toBe(
        foreignAuditsBefore
      );
      expect(
        await prisma.stockBalance.findFirst({
          where: { tenantId: tenantBId, catalogItemId: foreignItemBId },
        })
      ).toEqual(foreignBalanceBefore);
      expect(await prisma.stockMovement.count({ where: { tenantId: tenantAId } })).toBe(
        ownMovementsBefore
      );
      expect(await prisma.auditLog.count({ where: { tenantId: tenantAId } })).toBe(ownAuditsBefore);
      expect(
        await prisma.auditLog.count({ where: { requestId: INVENTORY_NOT_FOUND_REQUEST_ID } })
      ).toBe(0);
    }, 30_000);
  });

  /**
   * EPIC-11 WU1 live-PostgreSQL evidence (SUP-001 closure, task V1).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the W1 migration's real DDL — what the in-memory boundary
   * cannot represent:
   *   1. a duplicate PRESENT `taxId` is rejected by the PARTIAL unique index
   *      itself, through Prisma, and surfaces as the stable `409 CONFLICT`
   *      with the exact value-free message, persisting no supplier and no audit
   *      row (on create AND on update);
   *   2. two suppliers with an ABSENT `taxId` coexist inside one tenant;
   *   3. the same present `taxId` in another tenant is a different key;
   *   4. the database admits exactly one of two concurrent duplicates;
   *   5. a foreign supplier id is a byte-equivalent `404` on read, update and
   *      deactivation, leaving the owner's supplier untouched;
   *   6. the applied schema carries the partial UNIQUE index on
   *      `(tenant_id, tax_id) WHERE tax_id IS NOT NULL`, the `RESTRICT` tenant
   *      FK and the delete-rejecting trigger.
   *
   * Case 1 deliberately exercises the REAL index path: it never injects, stubs
   * or shapes a synthetic `P2002`.
   */
  describe("EPIC-11 suppliers application-path isolation", () => {
    /** One supplier create over REAL HTTP, with an optional pinned request id. */
    const createSupplier = (
      cookie: string,
      body: Record<string, unknown>,
      requestId?: string
    ): supertest.Test => {
      const request = supertest(serverUrl).post("/suppliers").set("Cookie", cookie);
      return (requestId === undefined ? request : request.set("X-Request-Id", requestId)).send(
        body
      );
    };

    it("rejects a duplicate PRESENT taxId through the real partial index as a stable 409 on create and update, persisting nothing", async () => {
      // A unique value for the whole suite: the partial index forbids a repeat
      // inside tenant A, so every case owns its own present identifier.
      const taxId = "live-pg-dup-tax-80012345";
      const first = await createSupplier(
        ownerACookie,
        { name: "Live Proveedor Duplicado", taxId },
        "live-pg-suppliers-dup-first"
      ).expect(201);
      const firstBody = first.body as SupplierDto;
      expect(Object.keys(firstBody).sort()).toEqual(SUPPLIER_DTO_KEYS);
      expect(firstBody.tenantId).toBe(tenantAId);
      expect(firstBody.taxId).toBe(taxId);

      const suppliersBefore = await prisma.supplier.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();
      const rejectedCreateRequestId = "live-pg-suppliers-dup-create-rejected";

      // The duplicate attempt: a real second insert with the same present
      // `taxId`. The partial unique index rejects it — no pre-read, no injected
      // `P2002` — and the W2 service renders the stable value-free 409.
      const duplicate = await supertest(serverUrl)
        .post("/suppliers")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", rejectedCreateRequestId)
        .send({ name: "Live Otro Proveedor", taxId })
        .expect(409);
      expect((duplicate.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((duplicate.body as { error: { message: string } }).error.message).toBe(
        SUPPLIER_TAX_ID_CONFLICT_MESSAGE
      );
      // The rejection is value-free: the CONFIDENTIAL identifier and the tenant
      // id never leak into the response.
      expect(duplicate.text).not.toContain(taxId);
      expect(duplicate.text).not.toContain(tenantAId);
      // Nothing was persisted and no audit row trailed the rejected attempt.
      expect(await prisma.supplier.count({ where: { tenantId: tenantAId } })).toBe(suppliersBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId: rejectedCreateRequestId } })).toBe(
        0
      );

      // The same duplicate through PUT /suppliers/:id: create a second supplier
      // with an ABSENT taxId, then move it onto the first one's identifier.
      const second = await createSupplier(ownerACookie, {
        name: "Live Proveedor Secundario",
      }).expect(201);
      const secondId = (second.body as SupplierDto).id;
      expect((second.body as SupplierDto).taxId).toBeNull();

      const updateRequestId = "live-pg-suppliers-dup-update-rejected";
      const auditsBeforeUpdate = await prisma.auditLog.count();
      const update = await supertest(serverUrl)
        .put(`/suppliers/${secondId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", updateRequestId)
        .send({ taxId })
        .expect(409);
      expect((update.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((update.body as { error: { message: string } }).error.message).toBe(
        SUPPLIER_TAX_ID_CONFLICT_MESSAGE
      );
      expect(update.text).not.toContain(taxId);
      // The update rolled back: the second supplier keeps its absent identifier,
      // the first is untouched, and no audit row was appended.
      expect((await prisma.supplier.findUnique({ where: { id: secondId } }))?.taxId).toBeNull();
      expect((await prisma.supplier.findUnique({ where: { id: firstBody.id } }))?.taxId).toBe(
        taxId
      );
      expect(await prisma.supplier.count({ where: { tenantId: tenantAId } })).toBe(
        suppliersBefore + 1
      );
      expect(await prisma.auditLog.count()).toBe(auditsBeforeUpdate);
      expect(await prisma.auditLog.count({ where: { requestId: updateRequestId } })).toBe(0);
    }, 30_000);

    it("admits two suppliers with an ABSENT taxId inside one tenant", async () => {
      const suppliersBefore = await prisma.supplier.count({ where: { tenantId: tenantAId } });
      const first = await createSupplier(ownerACookie, { name: "Live Sin TaxId Uno" }).expect(201);
      const second = await createSupplier(ownerACookie, { name: "Live Sin TaxId Dos" }).expect(201);
      const firstBody = first.body as SupplierDto;
      const secondBody = second.body as SupplierDto;
      // Neither create hit the duplicate-identifier conflict: with the tax id
      // absent there is no key to collide on, so both attempts are ADMITTED and
      // neither response carries the conflict envelope.
      expect((first.body as { error?: unknown }).error).toBeUndefined();
      expect((second.body as { error?: unknown }).error).toBeUndefined();
      expect(first.text).not.toContain(SUPPLIER_TAX_ID_CONFLICT_MESSAGE);
      expect(second.text).not.toContain(SUPPLIER_TAX_ID_CONFLICT_MESSAGE);
      // Both rows are real, distinct and carry no identifier: absent values sit
      // outside the partial index entirely and can never collide.
      expect(firstBody.taxId).toBeNull();
      expect(secondBody.taxId).toBeNull();
      expect(firstBody.id).not.toBe(secondBody.id);
      expect(firstBody.tenantId).toBe(tenantAId);
      expect(secondBody.tenantId).toBe(tenantAId);
      // Exactly TWO rows were persisted over the pre-case baseline: nothing was
      // lost and no extra row appeared.
      expect(await prisma.supplier.count({ where: { tenantId: tenantAId } })).toBe(
        suppliersBefore + 2
      );
      // Both returned ids resolve to stored rows whose identifier is NULL, so
      // the admitted responses are backed by real database state.
      const storedFirst = await prisma.supplier.findUnique({ where: { id: firstBody.id } });
      const storedSecond = await prisma.supplier.findUnique({ where: { id: secondBody.id } });
      expect(storedFirst?.taxId).toBeNull();
      expect(storedSecond?.taxId).toBeNull();
      expect(
        await prisma.supplier.count({ where: { tenantId: tenantAId, taxId: null } })
      ).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("admits the same present taxId in another tenant because tenant_id leads the index", async () => {
      const taxId = "live-pg-cross-tenant-90000001";
      const tenantA = await createSupplier(ownerACookie, {
        name: "Live Tenant A Identificador",
        taxId,
      }).expect(201);
      const tenantB = await createSupplier(ownerBCookie, {
        name: "Live Tenant B Identificador",
        taxId,
      }).expect(201);
      expect((tenantA.body as SupplierDto).tenantId).toBe(tenantAId);
      expect((tenantB.body as SupplierDto).tenantId).toBe(tenantBId);
      expect((tenantA.body as SupplierDto).taxId).toBe(taxId);
      expect((tenantB.body as SupplierDto).taxId).toBe(taxId);
      // Exactly one row per tenant: the key is `(tenant_id, tax_id)`, so the
      // same value in a different tenant is a different key.
      expect(await prisma.supplier.count({ where: { tenantId: tenantAId, taxId } })).toBe(1);
      expect(await prisma.supplier.count({ where: { tenantId: tenantBId, taxId } })).toBe(1);
    }, 30_000);

    it("admits exactly one of two concurrent duplicate creations with no timing assumption", async () => {
      const taxId = "live-pg-concurrent-70000001";
      const firstRequestId = "live-pg-suppliers-race-1";
      const secondRequestId = "live-pg-suppliers-race-2";
      const suppliersBefore = await prisma.supplier.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();

      // Two REAL concurrent inserts of the same present identifier. The database
      // guarantees the outcome for EVERY interleaving, so the assertion below
      // never depends on which request won and never sleeps or retries.
      const responses = await Promise.all([
        createSupplier(ownerACookie, { name: "Live Carrera Uno", taxId }, firstRequestId),
        createSupplier(ownerACookie, { name: "Live Carrera Dos", taxId }, secondRequestId),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const admitted = responses.find((response) => response.status === 201)!;
      const rejected = responses.find((response) => response.status === 409)!;
      expect((rejected.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected.body as { error: { message: string } }).error.message).toBe(
        SUPPLIER_TAX_ID_CONFLICT_MESSAGE
      );

      // Exactly one supplier row for the identifier, and exactly one MORE than
      // the pre-race baseline: the loser left nothing behind.
      expect(await prisma.supplier.count({ where: { tenantId: tenantAId, taxId } })).toBe(1);
      expect(await prisma.supplier.count({ where: { tenantId: tenantAId } })).toBe(
        suppliersBefore + 1
      );

      // Exactly one co-committed `supplier.created` audit row across BOTH
      // attempts, and it names the row the 201 response returned.
      const raceAudits = await prisma.auditLog.findMany({
        where: { requestId: { in: [firstRequestId, secondRequestId] } },
      });
      expect(raceAudits).toHaveLength(1);
      expect(raceAudits[0]).toMatchObject({
        action: "supplier.created",
        targetType: "supplier",
        targetId: (admitted.body as SupplierDto).id,
        tenantId: tenantAId,
      });
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
    }, 30_000);

    it("returns a byte-equivalent 404 for cross-tenant supplier read, update and deactivation and leaves tenant A untouched", async () => {
      const supplier = await createSupplier(ownerACookie, {
        name: "Live Proveedor Aislado",
        legalName: "Live Proveedor Aislado S.A.",
        taxId: "live-pg-aislado-50000001",
        email: "aislado@example.test",
        phone: "+595981000001",
        address: "Live Aislado 123",
      }).expect(201);
      const supplierId = (supplier.body as SupplierDto).id;
      const requestId = SUPPLIER_NOT_FOUND_REQUEST_ID;

      // The COMPLETE stored row, captured before any foreign-tenant attempt, so
      // "untouched" can be asserted over every field the model exposes instead
      // of two of them. Every optional field is populated so a masked write that
      // slipped through would have to change or clear one of them.
      const before = await prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!before) {
        throw new Error("supplier row vanished before the cross-tenant attempts");
      }
      expect(before.name).toBe("Live Proveedor Aislado");
      expect(before.legalName).toBe("Live Proveedor Aislado S.A.");
      expect(before.taxId).toBe("live-pg-aislado-50000001");
      expect(before.email).toBe("aislado@example.test");
      expect(before.phone).toBe("+595981000001");
      expect(before.address).toBe("Live Aislado 123");
      expect(before.isActive).toBe(true);

      const auditsBefore = await prisma.auditLog.count();

      const cases = [
        {
          label: "GET /suppliers/:id",
          request: () =>
            supertest(serverUrl)
              .get(`/suppliers/${supplierId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", requestId),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/suppliers/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", requestId),
        },
        {
          label: "PUT /suppliers/:id",
          request: () =>
            supertest(serverUrl)
              .put(`/suppliers/${supplierId}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", requestId)
              .send({ name: "Tampered" }),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/suppliers/${randomUUID()}`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", requestId)
              .send({ name: "Tampered" }),
        },
        {
          label: "POST /suppliers/:id/deactivate",
          request: () =>
            supertest(serverUrl)
              .post(`/suppliers/${supplierId}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", requestId)
              .send({}),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/suppliers/${randomUUID()}/deactivate`)
              .set("Cookie", ownerBCookie)
              .set("X-Request-Id", requestId)
              .send({}),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
        // non-existent one, echoed correlation included.
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(supplierId);
        expect(response.text, scenario.label).not.toContain(tenantAId);
      }

      // Tenant A's supplier survived every masked attempt unchanged, and
      // "unchanged" is the WHOLE row: every field the model exposes still holds
      // its pre-attempt value, `updatedAt` included — a real update would have
      // bumped it.
      const stored = await prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!stored) {
        throw new Error("supplier row vanished after the cross-tenant attempts");
      }
      expect(stored.name).toBe(before.name);
      expect(stored.legalName).toBe(before.legalName);
      expect(stored.taxId).toBe(before.taxId);
      expect(stored.email).toBe(before.email);
      expect(stored.phone).toBe(before.phone);
      expect(stored.address).toBe(before.address);
      expect(stored.isActive).toBe(before.isActive);
      expect(stored.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      // None of the three masked attempts wrote an audit row: not one scoped to
      // the shared request id, and not one anywhere in the log.
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
    }, 30_000);

    it("asserts the partial unique index, the RESTRICT tenant FK and the delete-rejecting trigger against the applied schema", async () => {
      // The PARTIAL unique index is the mechanism behind the 409. Assert its
      // exact shape — UNIQUE validity, both key columns and the normalized
      // predicate — because a plain `(tenant_id, tax_id)` composite unique would
      // also reject duplicates but would forbid multiple absent identifiers.
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
        WHERE c.relname = 'supplier_tenant_id_tax_id_key'
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0].is_unique).toBe(true);
      expect(indexRows[0].key_1).toBe("tenant_id");
      expect(indexRows[0].key_2).toBe("tax_id");
      expect(normalizeIndexPredicate(indexRows[0].predicate)).toBe(SUPPLIER_TAX_ID_INDEX_PREDICATE);

      // The tenant FK is RESTRICT on BOTH delete and update: a tenant cannot be
      // removed while it still owns suppliers.
      const fkRows = await prisma.$queryRaw<
        {
          is_foreign_key: boolean;
          on_delete_restrict: boolean;
          on_update_restrict: boolean;
        }[]
      >`
        SELECT
          c.contype = 'f' AS is_foreign_key,
          c.confdeltype = 'r' AS on_delete_restrict,
          c.confupdtype = 'r' AS on_update_restrict
        FROM pg_constraint c
        WHERE c.conname = 'supplier_tenant_id_fkey'
      `;
      expect(fkRows).toEqual([
        { is_foreign_key: true, on_delete_restrict: true, on_update_restrict: true },
      ]);

      // Removal is deactivation: a raw hard DELETE raises at the migration's
      // BEFORE DELETE trigger and the row physically survives.
      const probe = await createSupplier(ownerACookie, {
        name: "Live Trigger Probe",
      }).expect(201);
      const probeId = (probe.body as SupplierDto).id;
      await expect(
        prisma.$executeRaw`DELETE FROM "supplier" WHERE "id" = ${probeId}::uuid`
      ).rejects.toThrow(/suppliers are deactivated and cannot be hard-deleted/);
      expect(await prisma.supplier.findUnique({ where: { id: probeId } })).not.toBeNull();
    }, 30_000);
  });

  /**
   * EPIC-11 PUR-001 live-PostgreSQL evidence (task P3).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the `20260926000002_purchases` migration's real DDL — what the
   * in-memory boundary cannot represent:
   *   1. a draft create persists its lines and leaves the stock ledger
   *      untouched (the draft path is inert);
   *   2. the `(tenant_id, purchase_id, catalog_item_id)` unique is REAL, proven
   *      by catalog introspection plus a raw duplicate insert the applied index
   *      rejects;
   *   3. DEC-019's conditional immutability holds against the real triggers: a
   *      DRAFT deletes while RECEIVED and CANCELLED refuse with the exact
   *      trigger messages;
   *   4. the line-set reconciliation removes a stored line while the purchase
   *      stays DRAFT;
   *   5. the DRAFT-only guard is real: a raw-SQL RECEIVED purchase rejects an
   *      HTTP update and cancel with the stable `409` and persists nothing;
   *   6. the composite tenant-ownership FKs reject a raw cross-tenant supplier
   *      and catalog-item reference, and the same reference over HTTP is a
   *      byte-equivalent `404`;
   *   7. the positive-quantity and non-negative-cost CHECKs are real.
   *
   * Every assertion is deterministic: no injected Prisma error, no mock, no
   * sleep, no retry, and every raw-SQL mutation runs inside a transaction that
   * is rolled back, so no probe row ever survives.
   */
  describe("EPIC-11 purchases application-path isolation", () => {
    /** Marker error that forces an interactive transaction to roll back. */
    const PURCHASES_ROLLBACK_SENTINEL = "live-pg-purchases-rollback";

    /** Global SEED-owned EXEMPT rate, the catalog precondition for an item. */
    let exemptRateId: string;
    /** Fixture supplier/items owned by the two live tenants. */
    let supplierAId: string;
    let supplierBId: string;
    let itemAId: string;
    let itemA2Id: string;
    let itemBId: string;

    /** One supplier create over REAL HTTP. */
    const createSupplier = async (cookie: string, name: string): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/suppliers")
        .set("Cookie", cookie)
        .send({ name })
        .expect(201);
      return (created.body as SupplierDto).id;
    };

    /** One ACTIVE, stock-tracking tenant item through the REAL catalog command. */
    const createItem = async (cookie: string, name: string): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", cookie)
        .send({ kind: "SUPPLY", name, taxRateId: exemptRateId })
        .expect(201);
      return (created.body as { id: string }).id;
    };

    /**
     * Extracts the database message from Prisma's raw-query error wrapper
     * (`Raw query failed. Code: \`23001\`. Message: \`...\``). The captured text
     * is the database's own message, so an assertion can compare it EXACTLY
     * instead of matching a substring of the wrapper.
     */
    const databaseMessage = (error: unknown): string => {
      const text = error instanceof Error ? error.message : String(error);
      const match = /Message: `([\s\S]*?)`/.exec(text);
      // PostgreSQL renders a `RAISE EXCEPTION` message with a fixed `ERROR: `
      // severity prefix; stripping it leaves the exact text the trigger raises.
      return (match ? match[1] : text).replace(/^ERROR: /, "");
    };

    /** Runs `probe` and returns the exact database message of its rejection. */
    const captureDatabaseMessage = async (probe: () => Promise<unknown>): Promise<string> => {
      try {
        await probe();
      } catch (error) {
        return databaseMessage(error);
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `work` inside an interactive transaction that is ALWAYS rolled back,
     * so a probe can seed throwaway rows and attempt a mutation without
     * persisting anything. An assertion failure inside `work` propagates and
     * fails the case instead of matching the rollback sentinel.
     */
    const inRolledBackTransaction = async (
      work: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<void> => {
      await expect(
        prisma.$transaction(async (tx) => {
          await work(tx);
          throw new Error(PURCHASES_ROLLBACK_SENTINEL);
        })
      ).rejects.toThrow(PURCHASES_ROLLBACK_SENTINEL);
    };

    /** Raw purchase insert in tenant A; returns the generated id. */
    const insertRawPurchase = async (
      tx: Prisma.TransactionClient,
      status: "DRAFT" | "RECEIVED" | "CANCELLED",
      supplierId: string = supplierAId,
      tenantId: string = tenantAId
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "purchase" ("id", "tenant_id", "supplier_id", "status")
        VALUES (${id}::uuid, ${tenantId}::uuid, ${supplierId}::uuid, ${status}::purchase_status)
      `;
      return id;
    };

    /** Raw line insert for a tenant-A purchase; returns the generated id. */
    const insertRawLine = async (
      tx: Prisma.TransactionClient,
      purchaseId: string,
      catalogItemId: string,
      quantity = "1.000"
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "purchase_line" ("id", "tenant_id", "purchase_id", "catalog_item_id", "quantity")
        VALUES (${id}::uuid, ${tenantAId}::uuid, ${purchaseId}::uuid, ${catalogItemId}::uuid, ${quantity}::decimal)
      `;
      return id;
    };

    beforeAll(async () => {
      // The rate row is SEED-owned, so resolving it proves the reference seed
      // really ran against this database.
      const exempt = await prisma.taxRate.findUnique({ where: { code: "EXEMPT" } });
      if (!exempt) {
        throw new Error("Reference seed did not create the global EXEMPT tax rate");
      }
      exemptRateId = exempt.id;

      // Every live case owns its own fixture: the development database seeds no
      // supplier and no catalog item, so this block creates what it references.
      supplierAId = await createSupplier(ownerACookie, "Live Purchase Supplier A");
      supplierBId = await createSupplier(ownerBCookie, "Live Purchase Supplier B");
      itemAId = await createItem(ownerACookie, "Live Purchase Item A1");
      itemA2Id = await createItem(ownerACookie, "Live Purchase Item A2");
      itemBId = await createItem(ownerBCookie, "Live Purchase Item B1");
    }, 30_000);

    it("creates a DRAFT purchase with its lines and leaves the stock ledger untouched", async () => {
      const movementsBefore = await prisma.stockMovement.count();
      const balancesBefore = await prisma.stockBalance.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-purchases-create";

      const created = await supertest(serverUrl)
        .post("/purchases")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .send({
          supplierId: supplierAId,
          lines: [
            { catalogItemId: itemAId, quantity: "2", unitCost: "10.5" },
            { catalogItemId: itemA2Id, quantity: "1.250" },
          ],
        })
        .expect(201);

      const body = created.body as PurchaseDto;
      expect(Object.keys(body).sort()).toEqual(PURCHASE_DTO_KEYS);
      expect(body.tenantId).toBe(tenantAId);
      expect(body.supplierId).toBe(supplierAId);
      expect(body.status).toBe("DRAFT");
      expect(body.lines).toHaveLength(2);

      // Decimal projections are FIXED-SCALE exact strings: padded, never floats.
      const firstLine = body.lines.find((line) => line.catalogItemId === itemAId);
      expect(firstLine).toBeDefined();
      expect(Object.keys(firstLine ?? {}).sort()).toEqual(PURCHASE_LINE_DTO_KEYS);
      expect(firstLine?.quantity).toBe("2.000");
      expect(firstLine?.unitCost).toBe("10.50");
      const secondLine = body.lines.find((line) => line.catalogItemId === itemA2Id);
      expect(secondLine?.quantity).toBe("1.250");
      expect(secondLine?.unitCost).toBeNull();

      // The lines are REALLY persisted, read back at their stored column scale.
      const storedLines = await prisma.$queryRaw<
        { catalog_item_id: string; quantity: string; unit_cost: string | null }[]
      >`
        SELECT "catalog_item_id"::text AS catalog_item_id, "quantity"::text AS quantity,
               "unit_cost"::text AS unit_cost
        FROM "purchase_line" WHERE "purchase_id" = ${body.id}::uuid
      `;
      const storedByItem = new Map(storedLines.map((row) => [row.catalog_item_id, row]));
      expect(storedByItem.size).toBe(2);
      expect(storedByItem.get(itemAId)).toEqual({
        catalog_item_id: itemAId,
        quantity: "2.000",
        unit_cost: "10.50",
      });
      expect(storedByItem.get(itemA2Id)).toEqual({
        catalog_item_id: itemA2Id,
        quantity: "1.250",
        unit_cost: null,
      });

      // The draft path NEVER touches the ledger: no movement, no balance row.
      expect(await prisma.stockMovement.count()).toBe(movementsBefore);
      expect(await prisma.stockBalance.count()).toBe(balancesBefore);

      // Exactly one co-committed audit row carrying ids and field NAMES only.
      const audits = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "purchase.created",
        targetType: "purchase",
        targetId: body.id,
        tenantId: tenantAId,
      });
      const metadata = audits[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual(["supplierId", "lines"]);
      expect(JSON.stringify(metadata)).not.toContain(itemAId);
      expect(JSON.stringify(metadata)).not.toContain("2.000");
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
    }, 30_000);

    it("proves the duplicate-line unique is real with catalog introspection and a raw duplicate insert", async () => {
      // The APPLIED index: UNIQUE on (tenant_id, purchase_id, catalog_item_id),
      // non-partial and not the primary key.
      const indexRows = await prisma.$queryRaw<
        {
          is_unique: boolean;
          is_primary: boolean;
          key_1: string | null;
          key_2: string | null;
          key_3: string | null;
          predicate: string | null;
        }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_indexdef(i.indexrelid, 3, true) AS key_3,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'purchase_line_tenant_id_purchase_id_catalog_item_id_key'
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0].is_unique).toBe(true);
      expect(indexRows[0].is_primary).toBe(false);
      expect(indexRows[0].key_1).toBe("tenant_id");
      expect(indexRows[0].key_2).toBe("purchase_id");
      expect(indexRows[0].key_3).toBe("catalog_item_id");
      expect(indexRows[0].predicate).toBeNull();

      // Exactly ONE unique index on `purchase_line` covers those three columns
      // in that order, so the violation the raw insert below raises can only be
      // this key.
      const covering = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        JOIN pg_class AS t ON t.oid = i.indrelid
        WHERE t.relname = 'purchase_line' AND i.indisunique
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'tenant_id'
          AND pg_get_indexdef(i.indexrelid, 2, true) = 'purchase_id'
          AND pg_get_indexdef(i.indexrelid, 3, true) = 'catalog_item_id'
      `;
      expect(covering.map((row) => row.relname)).toEqual([
        "purchase_line_tenant_id_purchase_id_catalog_item_id_key",
      ]);

      // A REAL draft with one line, then a raw duplicate of that same
      // `(tenant, purchase, item)` key. The HTTP path cannot produce this
      // violation because the request contract rejects a duplicate item in the
      // payload, so the database proof must be explicit.
      const created = await supertest(serverUrl)
        .post("/purchases")
        .set("Cookie", ownerACookie)
        .send({ supplierId: supplierAId, lines: [{ catalogItemId: itemAId, quantity: "1.000" }] })
        .expect(201);
      const purchaseId = (created.body as PurchaseDto).id;
      expect(await prisma.purchaseLine.count({ where: { purchaseId } })).toBe(1);

      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(
          () => tx.$executeRaw`
            INSERT INTO "purchase_line" ("tenant_id", "purchase_id", "catalog_item_id", "quantity")
            VALUES (${tenantAId}::uuid, ${purchaseId}::uuid, ${itemAId}::uuid, 5.000)
          `
        );
        // Prisma surfaces PostgreSQL's `unique_violation` DETAIL, which names
        // the violated key columns exactly. Combined with the catalog
        // introspection above, this proves the rejection is the duplicate
        // `(tenant_id, purchase_id, catalog_item_id)` key and not some other
        // constraint.
        expect(message).toContain("Key (tenant_id, purchase_id, catalog_item_id)=");
        expect(message).toContain("already exists.");
      });

      // The rejection persisted nothing: the purchase still holds one line.
      expect(await prisma.purchaseLine.count({ where: { purchaseId } })).toBe(1);
    }, 30_000);

    it("enforces DEC-019 conditional immutability with the exact trigger messages", async () => {
      const purchasesBefore = await prisma.purchase.count();
      const linesBefore = await prisma.purchaseLine.count();

      // The migration's two triggers are BEFORE DELETE ROW, and neither fires
      // on UPDATE: the DRAFT conditional shape DEC-019 mandates.
      const triggers = await prisma.$queryRaw<
        { tgname: string; proname: string; tgtype: number }[]
      >`
        SELECT t.tgname, p.proname, t.tgtype::int AS tgtype
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_proc AS p ON p.oid = t.tgfoid
        WHERE c.relname IN ('purchase', 'purchase_line') AND NOT t.tgisinternal
        ORDER BY t.tgname
      `;
      expect(triggers.map((row) => row.tgname)).toEqual([
        "purchase_line_no_delete_when_received_or_cancelled_trigger",
        "purchase_no_delete_when_received_or_cancelled_trigger",
      ]);
      for (const trigger of triggers) {
        expect(trigger.tgtype & 1).toBe(1); // ROW
        expect(trigger.tgtype & 2).toBe(2); // BEFORE
        expect(trigger.tgtype & 8).toBe(8); // DELETE
        expect(trigger.tgtype & 16).toBe(0); // NOT UPDATE
      }

      // A DRAFT is fully editable: its line and then the header both delete.
      await inRolledBackTransaction(async (tx) => {
        const purchaseId = await insertRawPurchase(tx, "DRAFT");
        const lineId = await insertRawLine(tx, purchaseId, itemAId);
        expect(await tx.$executeRaw`DELETE FROM "purchase_line" WHERE "id" = ${lineId}::uuid`).toBe(
          1
        );
        expect(await tx.$executeRaw`DELETE FROM "purchase" WHERE "id" = ${purchaseId}::uuid`).toBe(
          1
        );
      });

      for (const status of ["RECEIVED", "CANCELLED"] as const) {
        // The header trigger refuses the DELETE with its EXACT message.
        await inRolledBackTransaction(async (tx) => {
          const purchaseId = await insertRawPurchase(tx, status);
          expect(
            await captureDatabaseMessage(
              () => tx.$executeRaw`DELETE FROM "purchase" WHERE "id" = ${purchaseId}::uuid`
            )
          ).toBe("a received or cancelled purchase cannot be deleted");
        });

        // The line trigger reads the OWNING purchase's status.
        await inRolledBackTransaction(async (tx) => {
          const purchaseId = await insertRawPurchase(tx, status);
          const lineId = await insertRawLine(tx, purchaseId, itemAId);
          expect(
            await captureDatabaseMessage(
              () => tx.$executeRaw`DELETE FROM "purchase_line" WHERE "id" = ${lineId}::uuid`
            )
          ).toBe("a line of a received or cancelled purchase cannot be deleted");
        });
      }

      // Every probe rolled back: no throwaway purchase or line survived.
      expect(await prisma.purchase.count()).toBe(purchasesBefore);
      expect(await prisma.purchaseLine.count()).toBe(linesBefore);
    }, 30_000);

    it("reconciles the line set over HTTP: a removed item is gone and the purchase stays DRAFT", async () => {
      const created = await supertest(serverUrl)
        .post("/purchases")
        .set("Cookie", ownerACookie)
        .send({
          supplierId: supplierAId,
          lines: [
            { catalogItemId: itemAId, quantity: "1.000" },
            { catalogItemId: itemA2Id, quantity: "2.000" },
          ],
        })
        .expect(201);
      const createdBody = created.body as PurchaseDto;
      const retainedLineId = createdBody.lines.find((line) => line.catalogItemId === itemAId)?.id;
      expect(retainedLineId).toBeDefined();

      const updated = await supertest(serverUrl)
        .put(`/purchases/${createdBody.id}`)
        .set("Cookie", ownerACookie)
        .send({ lines: [{ catalogItemId: itemAId, quantity: "3.000" }] })
        .expect(200);
      const body = updated.body as PurchaseDto;
      expect(body.status).toBe("DRAFT");
      expect(body.lines.map((line) => line.catalogItemId)).toEqual([itemAId]);
      // The retained line was updated IN PLACE: its identity survived.
      expect(body.lines[0].id).toBe(retainedLineId);
      expect(body.lines[0].quantity).toBe("3.000");

      // The removed item's row is really gone from the table.
      const stored = await prisma.$queryRaw<{ catalog_item_id: string }[]>`
        SELECT "catalog_item_id"::text AS catalog_item_id FROM "purchase_line"
        WHERE "purchase_id" = ${createdBody.id}::uuid
      `;
      expect(stored.map((row) => row.catalog_item_id)).toEqual([itemAId]);
      expect(await prisma.purchase.findUnique({ where: { id: createdBody.id } })).toMatchObject({
        status: "DRAFT",
      });
    }, 30_000);

    it("rejects an HTTP update and cancel of a raw RECEIVED purchase with the stable 409 and persists nothing", async () => {
      // The receive command is PUR-002, so a RECEIVED aggregate is created with
      // raw SQL; the point is that the APPLICATION refuses to change it.
      const purchaseId = randomUUID();
      const lineId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "purchase" ("id", "tenant_id", "supplier_id", "status")
        VALUES (${purchaseId}::uuid, ${tenantAId}::uuid, ${supplierAId}::uuid, 'RECEIVED'::purchase_status)
      `;
      await prisma.$executeRaw`
        INSERT INTO "purchase_line" ("id", "tenant_id", "purchase_id", "catalog_item_id", "quantity", "unit_cost")
        VALUES (${lineId}::uuid, ${tenantAId}::uuid, ${purchaseId}::uuid, ${itemAId}::uuid, 3.000, 7.25)
      `;
      const auditsBefore = await prisma.auditLog.count();
      const updateRequestId = "live-pg-purchases-received-update";
      const cancelRequestId = "live-pg-purchases-received-cancel";

      const update = await supertest(serverUrl)
        .put(`/purchases/${purchaseId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", updateRequestId)
        .send({ supplierId: supplierAId, lines: [{ catalogItemId: itemA2Id, quantity: "9.000" }] })
        .expect(409);
      expect((update.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((update.body as { error: { message: string } }).error.message).toBe(
        PURCHASE_NOT_EDITABLE_MESSAGE
      );

      const cancel = await supertest(serverUrl)
        .post(`/purchases/${purchaseId}/cancel`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", cancelRequestId)
        .expect(409);
      expect((cancel.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((cancel.body as { error: { message: string } }).error.message).toBe(
        PURCHASE_NOT_EDITABLE_MESSAGE
      );

      // Nothing was persisted: status, supplier and the complete line set are
      // exactly as the raw insert left them, and no audit row trailed either
      // rejected command.
      expect(await prisma.purchase.findUnique({ where: { id: purchaseId } })).toMatchObject({
        status: "RECEIVED",
        supplierId: supplierAId,
      });
      const storedLines = await prisma.$queryRaw<
        { catalog_item_id: string; quantity: string; unit_cost: string | null }[]
      >`
        SELECT "catalog_item_id"::text AS catalog_item_id, "quantity"::text AS quantity,
               "unit_cost"::text AS unit_cost
        FROM "purchase_line" WHERE "purchase_id" = ${purchaseId}::uuid
      `;
      expect(storedLines).toEqual([
        { catalog_item_id: itemAId, quantity: "3.000", unit_cost: "7.25" },
      ]);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: [updateRequestId, cancelRequestId] } },
        })
      ).toBe(0);
    }, 30_000);

    it("rejects cross-tenant references at the composite FKs and masks another tenant's purchase as a byte-equivalent 404", async () => {
      // A raw tenant-A purchase cannot reference a tenant-B supplier...
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(
          () => tx.$executeRaw`
            INSERT INTO "purchase" ("tenant_id", "supplier_id")
            VALUES (${tenantAId}::uuid, ${supplierBId}::uuid)
          `
        );
        expect(message).toContain("purchase_tenant_id_supplier_id_fkey");
      });

      // ...and a raw tenant-A line cannot reference a tenant-B catalog item.
      await inRolledBackTransaction(async (tx) => {
        const purchaseId = await insertRawPurchase(tx, "DRAFT");
        const message = await captureDatabaseMessage(
          () => tx.$executeRaw`
            INSERT INTO "purchase_line" ("tenant_id", "purchase_id", "catalog_item_id", "quantity")
            VALUES (${tenantAId}::uuid, ${purchaseId}::uuid, ${itemBId}::uuid, 1.000)
          `
        );
        expect(message).toContain("purchase_line_tenant_id_catalog_item_id_fkey");
      });

      // Tenant B owns a real draft the masked tenant-A verbs must never resolve.
      const foreign = await supertest(serverUrl)
        .post("/purchases")
        .set("Cookie", ownerBCookie)
        .send({ supplierId: supplierBId, lines: [{ catalogItemId: itemBId, quantity: "4.000" }] })
        .expect(201);
      const foreignBody = foreign.body as PurchaseDto;
      const requestId = PURCHASE_NOT_FOUND_REQUEST_ID;
      const auditsBefore = await prisma.auditLog.count();

      const cases = [
        {
          label: "GET /purchases/:id",
          request: () =>
            supertest(serverUrl)
              .get(`/purchases/${foreignBody.id}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/purchases/${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
        },
        {
          label: "PUT /purchases/:id",
          request: () =>
            supertest(serverUrl)
              .put(`/purchases/${foreignBody.id}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId)
              .send({ lines: [{ catalogItemId: itemAId, quantity: "5.000" }] }),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/purchases/${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId)
              .send({ lines: [{ catalogItemId: itemAId, quantity: "5.000" }] }),
        },
        {
          label: "POST /purchases/:id/cancel",
          request: () =>
            supertest(serverUrl)
              .post(`/purchases/${foreignBody.id}/cancel`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/purchases/${randomUUID()}/cancel`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(
          (response.body as { error: { message: string } }).error.message,
          scenario.label
        ).toBe(PURCHASE_NOT_FOUND_MESSAGE);
        // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
        // non-existent one, echoed correlation included.
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(foreignBody.id);
        expect(response.text, scenario.label).not.toContain(tenantBId);
        expect(response.text, scenario.label).not.toContain(supplierBId);
      }

      // Tenant B's draft survived every masked attempt unchanged.
      expect(await prisma.purchase.findUnique({ where: { id: foreignBody.id } })).toMatchObject({
        status: "DRAFT",
        supplierId: supplierBId,
      });
      const storedLines = await prisma.purchaseLine.findMany({
        where: { purchaseId: foreignBody.id },
      });
      expect(storedLines).toHaveLength(1);
      expect(storedLines[0].catalogItemId).toBe(itemBId);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
    }, 30_000);

    it("rejects a zero or negative quantity and a negative unit cost at the database CHECKs", async () => {
      const linesBefore = await prisma.purchaseLine.count();

      for (const quantity of ["0.000", "-1.000"]) {
        await inRolledBackTransaction(async (tx) => {
          const purchaseId = await insertRawPurchase(tx, "DRAFT");
          const message = await captureDatabaseMessage(
            () => tx.$executeRaw`
              INSERT INTO "purchase_line" ("tenant_id", "purchase_id", "catalog_item_id", "quantity")
              VALUES (${tenantAId}::uuid, ${purchaseId}::uuid, ${itemAId}::uuid, ${quantity}::decimal)
            `
          );
          expect(message, quantity).toContain("purchase_line_quantity_positive");
        });
      }

      await inRolledBackTransaction(async (tx) => {
        const purchaseId = await insertRawPurchase(tx, "DRAFT");
        const message = await captureDatabaseMessage(
          () => tx.$executeRaw`
            INSERT INTO "purchase_line" ("tenant_id", "purchase_id", "catalog_item_id", "quantity", "unit_cost")
            VALUES (${tenantAId}::uuid, ${purchaseId}::uuid, ${itemAId}::uuid, 1.000, -1.00)
          `
        );
        expect(message).toContain("purchase_line_unit_cost_non_negative");
      });

      // Every probe rolled back: no rejected line survived.
      expect(await prisma.purchaseLine.count()).toBe(linesBefore);
    }, 30_000);
  });

  /**
   * EPIC-11 PUR-002 live-PostgreSQL evidence (task R3).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the `20260926000003_purchase_receiving` migration's applied
   * enum — what the single-threaded in-memory boundary cannot represent:
   *   1. a receive is atomic: exactly one positive `PURCHASE` movement and one
   *      balance projection per line, the projection equal to the ledger's
   *      signed sum, and exactly one `purchase.received` audit row;
   *   2. a replay is the stable `409 CONFLICT` and persists nothing (DEC-014);
   *   3. two concurrent receives of the SAME purchase admit exactly one under a
   *      PROVEN overlap on the purchase header row lock — the case the in-memory
   *      suite could not prove;
   *   4. a cross-tenant and an unknown purchase id are one byte-equivalent `404`,
   *      persisting nothing for either;
   *   5. a line gate is all-or-nothing with the reused inventory `409` messages,
   *      writing no movement for any line including the good ones;
   *   6. the applied `stock_movement_type` carries `PURCHASE` additively and the
   *      pre-existing no-delete trigger still rejects a raw delete of one.
   *
   * Every assertion is deterministic: no injected Prisma error, no mock, no
   * sleep, no timeout and no retry.
   */
  describe("EPIC-11 purchase receiving application-path isolation", () => {
    /** Global SEED-owned EXEMPT rate, the catalog precondition for an item. */
    let exemptRateId: string;
    /** Fixture suppliers owned by the two live tenants. */
    let supplierAId: string;
    let supplierBId: string;
    /** Tenant B catalog item, referenced only by tenant B's own draft. */
    let itemBId: string;

    /** One supplier create over REAL HTTP. */
    const createSupplier = async (cookie: string, name: string): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/suppliers")
        .set("Cookie", cookie)
        .send({ name })
        .expect(201);
      return (created.body as SupplierDto).id;
    };

    /**
     * One tenant catalog item through the REAL catalog command. `overrides`
     * carries the state under test (for example `tracksStock: false`) on top of
     * an ACTIVE, stock-tracking default.
     */
    const createItem = async (
      cookie: string,
      name: string,
      overrides: Record<string, unknown> = {}
    ): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", cookie)
        .send({ kind: "SUPPLY", name, taxRateId: exemptRateId, ...overrides })
        .expect(201);
      return (created.body as { id: string }).id;
    };

    /** One tenant-A draft purchase over REAL HTTP; returns its projection. */
    const createDraft = async (
      cookie: string,
      lines: { catalogItemId: string; quantity: string }[]
    ): Promise<PurchaseDto> => {
      const created = await supertest(serverUrl)
        .post("/purchases")
        .set("Cookie", cookie)
        .send({ supplierId: supplierAId, lines })
        .expect(201);
      return created.body as PurchaseDto;
    };

    /** The explicit receive command over REAL HTTP, with a pinned request id. */
    const receive = (cookie: string, purchaseId: string, requestId: string) =>
      supertest(serverUrl)
        .post(`/purchases/${purchaseId}/receive`)
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .then((response) => response);

    /** Raw `DECIMAL(10,3)` projection text, or `null` when the item has no row. */
    const rawBalanceText = async (
      tenantId: string,
      catalogItemId: string
    ): Promise<string | null> => {
      const rows = await prisma.$queryRaw<{ quantity: string }[]>`
        SELECT "quantity"::text AS quantity FROM "stock_balance"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
      `;
      return rows[0]?.quantity ?? null;
    };

    /** Raw SIGNED sum of one item's movements at the projection's exact scale. */
    const rawLedgerSum = async (tenantId: string, catalogItemId: string): Promise<string> => {
      const rows = await prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(sum("quantity"), 0)::numeric(10,3)::text AS total
        FROM "stock_movement"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
      `;
      return rows[0]?.total ?? "0.000";
    };

    /** Raw `PURCHASE` movements of one item, at the column's exact scale. */
    const purchaseMovements = async (
      tenantId: string,
      catalogItemId: string
    ): Promise<{ quantity: string; reason: string }[]> => {
      return prisma.$queryRaw<{ quantity: string; reason: string }[]>`
        SELECT "quantity"::text AS quantity, "reason" AS reason
        FROM "stock_movement"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
          AND "type" = 'PURCHASE'::stock_movement_type
        ORDER BY "created_at" ASC, "id" ASC
      `;
    };

    beforeAll(async () => {
      // The rate row is SEED-owned, so resolving it proves the reference seed
      // really ran against this database.
      const exempt = await prisma.taxRate.findUnique({ where: { code: "EXEMPT" } });
      if (!exempt) {
        throw new Error("Reference seed did not create the global EXEMPT tax rate");
      }
      exemptRateId = exempt.id;

      // Every live case owns its funding fixtures: the development database
      // seeds no supplier and no catalog item, so this block creates what it
      // references. The tenant-A items are created per case so each "exactly one
      // movement" assertion starts from an item with an empty ledger.
      supplierAId = await createSupplier(ownerACookie, "Live Receiving Supplier A");
      supplierBId = await createSupplier(ownerBCookie, "Live Receiving Supplier B");
      itemBId = await createItem(ownerBCookie, "Live Receiving Item B1");
    }, 30_000);

    it("receives a draft atomically: one positive PURCHASE movement and projection per line, projection equal to the ledger sum, one audit row", async () => {
      const firstItemId = await createItem(ownerACookie, "Live Receiving Item A1");
      const secondItemId = await createItem(ownerACookie, "Live Receiving Item A2");
      const draft = await createDraft(ownerACookie, [
        { catalogItemId: firstItemId, quantity: "2.500" },
        { catalogItemId: secondItemId, quantity: "7.000" },
      ]);
      expect(draft.status).toBe("DRAFT");

      const movementsBefore = await prisma.stockMovement.count();
      const balancesBefore = await prisma.stockBalance.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-receiving-success";

      const response = await receive(ownerACookie, draft.id, requestId);
      expect(response.status).toBe(201);
      const body = response.body as PurchaseDto;
      expect(Object.keys(body).sort()).toEqual(PURCHASE_DTO_KEYS);
      expect(body.tenantId).toBe(tenantAId);
      expect(body.status).toBe("RECEIVED");
      expect(body.lines).toHaveLength(2);
      // No Prisma column name crosses the HTTP boundary.
      expect(response.text).not.toContain("stock_movement");
      expect(response.text).not.toContain("catalog_item_id");

      // Exactly ONE positive `PURCHASE` movement per line, at the ledger's
      // signed convention and the column's own exact scale.
      expect(await purchaseMovements(tenantAId, firstItemId)).toEqual([
        { quantity: "2.500", reason: PURCHASE_RECEIVE_MOVEMENT_REASON },
      ]);
      expect(await purchaseMovements(tenantAId, secondItemId)).toEqual([
        { quantity: "7.000", reason: PURCHASE_RECEIVE_MOVEMENT_REASON },
      ]);
      // The movement TYPE itself is the new enum value: an adjustment for the
      // same items would be a different type, so this is asserted from the
      // stored column rather than inferred from the response.
      const types = await prisma.$queryRaw<{ type: string }[]>`
        SELECT DISTINCT "type"::text AS type FROM "stock_movement"
        WHERE "tenant_id" = ${tenantAId}::uuid
          AND "catalog_item_id" IN (${firstItemId}::uuid, ${secondItemId}::uuid)
      `;
      expect(types).toEqual([{ type: "PURCHASE" }]);

      // The projection equals the ledger's SIGNED sum for each item, at the
      // projection's own exact scale, and there is ONE row per `(tenant, item)`.
      for (const [itemId, expected] of [
        [firstItemId, "2.500"],
        [secondItemId, "7.000"],
      ] as const) {
        expect(await rawBalanceText(tenantAId, itemId)).toBe(expected);
        expect(await rawLedgerSum(tenantAId, itemId)).toBe(await rawBalanceText(tenantAId, itemId));
        expect(
          await prisma.stockBalance.count({ where: { tenantId: tenantAId, catalogItemId: itemId } })
        ).toBe(1);
      }

      // Exactly ONE co-committed `purchase.received` audit row, naming the
      // status change only: field names, no identifier and no stored value.
      const audits = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "purchase.received",
        targetType: "purchase",
        targetId: draft.id,
        tenantId: tenantAId,
      });
      const metadata = audits[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual(["status"]);
      // No CONFIDENTIAL value and no identifier reach the trail.
      const serializedMetadata = JSON.stringify(metadata);
      expect(serializedMetadata).not.toContain(firstItemId);
      expect(serializedMetadata).not.toContain("2.500");
      expect(serializedMetadata).not.toContain(supplierAId);

      // The command's complete durable side effect above the pre-command counts:
      // two movements, two projection rows and exactly ONE audit row.
      expect(await prisma.stockMovement.count()).toBe(movementsBefore + 2);
      expect(await prisma.stockBalance.count()).toBe(balancesBefore + 2);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.purchase.findUnique({ where: { id: draft.id } })).toMatchObject({
        status: "RECEIVED",
      });
    }, 30_000);

    it("rejects a replay of the same purchase with the stable 409 and persists nothing", async () => {
      const itemId = await createItem(ownerACookie, "Live Receiving Replay Item");
      const draft = await createDraft(ownerACookie, [{ catalogItemId: itemId, quantity: "3.250" }]);
      const first = await receive(ownerACookie, draft.id, "live-pg-receiving-replay-first");
      expect(first.status).toBe(201);

      const movementsAfter = await prisma.stockMovement.count();
      const balancesAfter = await prisma.stockBalance.findMany({
        where: { tenantId: tenantAId },
        orderBy: { id: "asc" },
      });
      const auditsAfter = await prisma.auditLog.count();
      const balanceBefore = await rawBalanceText(tenantAId, itemId);
      const requestId = "live-pg-receiving-replay-second";

      const replay = await receive(ownerACookie, draft.id, requestId);
      expect(replay.status).toBe(409);
      expect((replay.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((replay.body as { error: { message: string } }).error.message).toBe(
        PURCHASE_NOT_EDITABLE_MESSAGE
      );

      // Nothing further was persisted: no second movement, no balance change, no
      // additional audit row, and the purchase stays RECEIVED.
      expect(await prisma.stockMovement.count()).toBe(movementsAfter);
      expect(
        await prisma.stockBalance.findMany({
          where: { tenantId: tenantAId },
          orderBy: { id: "asc" },
        })
      ).toEqual(balancesAfter);
      expect(await prisma.auditLog.count()).toBe(auditsAfter);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await rawBalanceText(tenantAId, itemId)).toBe(balanceBefore);
      expect(await rawLedgerSum(tenantAId, itemId)).toBe("3.250");
      expect(await purchaseMovements(tenantAId, itemId)).toEqual([
        { quantity: "3.250", reason: PURCHASE_RECEIVE_MOVEMENT_REASON },
      ]);
      expect(await prisma.purchase.findUnique({ where: { id: draft.id } })).toMatchObject({
        status: "RECEIVED",
      });
    }, 30_000);

    it("admits exactly ONE of two concurrent receives of the SAME purchase under a proven header-lock overlap", async () => {
      const firstItemId = await createItem(ownerACookie, "Live Receiving Race Item A1");
      const secondItemId = await createItem(ownerACookie, "Live Receiving Race Item A2");
      const draft = await createDraft(ownerACookie, [
        { catalogItemId: firstItemId, quantity: "2.000" },
        { catalogItemId: secondItemId, quantity: "4.000" },
      ]);
      const firstRequestId = "live-pg-receiving-race-1";
      const secondRequestId = "live-pg-receiving-race-2";
      const movementsBefore = await prisma.stockMovement.count();
      const auditsBefore = await prisma.auditLog.count();

      // Deterministic overlap: a dedicated transaction holds the purchase
      // HEADER row lock (`SELECT ... FOR UPDATE`), which is the exact row the
      // command locks FIRST, so BOTH receives park on that single row before
      // either can read the status or take an item lock.
      // `waitForRowLockWaiters` matches the tuple lock on THAT row, so an
      // unrelated lock waiter can never satisfy it: the interleaving is decided
      // by the database boundary, never by wall-clock timing.
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
            SELECT "id" FROM "purchase"
            WHERE "tenant_id" = ${tenantAId}::uuid AND "id" = ${draft.id}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;
      // The row lock is held now, so the ctid cannot move under the racers.
      const ctid = await readRowCtid(prisma, "purchase", draft.id);

      const racers = [
        receive(ownerACookie, draft.id, firstRequestId),
        receive(ownerACookie, draft.id, secondRequestId),
      ];

      try {
        await waitForRowLockWaiters(prisma, "purchase", ctid.page, ctid.tuple, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      // The database guarantees this outcome for EVERY interleaving: the winner
      // flips the header to RECEIVED inside its transaction, and the loser's
      // post-lock status read sees the committed RECEIVED and is rejected. The
      // assertions never depend on WHICH request won, and there is no sleep and
      // no retry that could hide a double receive.
      const admitted = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected[0].body as { error: { message: string } }).error.message).toBe(
        PURCHASE_NOT_EDITABLE_MESSAGE
      );
      expect((admitted[0].body as PurchaseDto).status).toBe("RECEIVED");

      // Exactly ONE movement per line — NEVER two sets — and each projection is
      // exactly its own ledger's signed sum.
      expect(await purchaseMovements(tenantAId, firstItemId)).toEqual([
        { quantity: "2.000", reason: PURCHASE_RECEIVE_MOVEMENT_REASON },
      ]);
      expect(await purchaseMovements(tenantAId, secondItemId)).toEqual([
        { quantity: "4.000", reason: PURCHASE_RECEIVE_MOVEMENT_REASON },
      ]);
      for (const [itemId, expected] of [
        [firstItemId, "2.000"],
        [secondItemId, "4.000"],
      ] as const) {
        expect(await rawBalanceText(tenantAId, itemId)).toBe(expected);
        expect(await rawLedgerSum(tenantAId, itemId)).toBe(await rawBalanceText(tenantAId, itemId));
      }
      expect(await prisma.stockMovement.count()).toBe(movementsBefore + 2);

      // Exactly ONE `purchase.received` audit row across BOTH attempts, and the
      // purchase is RECEIVED.
      const raceAudits = await prisma.auditLog.findMany({
        where: { requestId: { in: [firstRequestId, secondRequestId] } },
      });
      expect(raceAudits).toHaveLength(1);
      expect(raceAudits[0]).toMatchObject({
        action: "purchase.received",
        targetType: "purchase",
        targetId: draft.id,
        tenantId: tenantAId,
      });
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.purchase.findUnique({ where: { id: draft.id } })).toMatchObject({
        status: "RECEIVED",
      });
    }, 60_000);

    it("masks a cross-tenant and an unknown purchase id as one byte-equivalent 404 on receive, persisting nothing", async () => {
      // Tenant B owns a real draft the masked tenant-A command must never resolve.
      const foreign = await supertest(serverUrl)
        .post("/purchases")
        .set("Cookie", ownerBCookie)
        .send({ supplierId: supplierBId, lines: [{ catalogItemId: itemBId, quantity: "4.000" }] })
        .expect(201);
      const foreignBody = foreign.body as PurchaseDto;

      const movementsBefore = await prisma.stockMovement.count();
      const balancesBefore = await prisma.stockBalance.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = RECEIVE_NOT_FOUND_REQUEST_ID;

      const foreignResponse = await supertest(serverUrl)
        .post(`/purchases/${foreignBody.id}/receive`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId);
      const unknownResponse = await supertest(serverUrl)
        .post(`/purchases/${randomUUID()}/receive`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId);

      expect(foreignResponse.status).toBe(404);
      expect(unknownResponse.status).toBe(404);
      expect((foreignResponse.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect((foreignResponse.body as { error: { message: string } }).error.message).toBe(
        PURCHASE_NOT_FOUND_MESSAGE
      );
      // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
      // non-existent one, echoed correlation included.
      expect(foreignResponse.text).toBe(unknownResponse.text);
      expect(foreignResponse.text).not.toContain(foreignBody.id);
      expect(foreignResponse.text).not.toContain(tenantBId);
      expect(foreignResponse.text).not.toContain(supplierBId);

      // Nothing was persisted for EITHER attempt: the foreign draft is still
      // DRAFT, its item has no movement or projection, and no audit row trailed
      // the masked commands.
      expect(await prisma.purchase.findUnique({ where: { id: foreignBody.id } })).toMatchObject({
        status: "DRAFT",
      });
      expect(await purchaseMovements(tenantBId, itemBId)).toEqual([]);
      expect(await rawBalanceText(tenantBId, itemBId)).toBeNull();
      expect(await prisma.stockMovement.count()).toBe(movementsBefore);
      expect(await prisma.stockBalance.count()).toBe(balancesBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
    }, 30_000);

    it("fails the WHOLE receive when any line is not stockable, writing no movement for any line", async () => {
      const goodItemId = await createItem(ownerACookie, "Live Receiving Gate Good Item");
      const inactiveItemId = await createItem(ownerACookie, "Live Receiving Gate Inactive Item");
      await supertest(serverUrl)
        .post(`/catalog/${inactiveItemId}/deactivate`)
        .set("Cookie", ownerACookie)
        .send({})
        .expect(201);
      const nonTrackingItemId = await createItem(
        ownerACookie,
        "Live Receiving Gate Non-Tracking Item",
        { tracksStock: false }
      );

      const scenarios = [
        {
          label: "inactive",
          itemId: inactiveItemId,
          message: STOCK_ITEM_INACTIVE_MESSAGE,
        },
        {
          label: "non-tracking",
          itemId: nonTrackingItemId,
          message: STOCK_ITEM_NOT_TRACKED_MESSAGE,
        },
      ];

      for (const scenario of scenarios) {
        const draft = await createDraft(ownerACookie, [
          { catalogItemId: goodItemId, quantity: "5.000" },
          { catalogItemId: scenario.itemId, quantity: "1.000" },
        ]);
        const movementsBefore = await prisma.stockMovement.count();
        const balancesBefore = await prisma.stockBalance.count();
        const auditsBefore = await prisma.auditLog.count();
        const requestId = `live-pg-receiving-gate-${scenario.label}`;

        const response = await receive(ownerACookie, draft.id, requestId);
        expect(response.status, scenario.label).toBe(409);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("CONFLICT");
        expect(
          (response.body as { error: { message: string } }).error.message,
          scenario.label
        ).toBe(scenario.message);

        // ALL-OR-NOTHING: the purchase is still DRAFT and NO movement was
        // written for ANY line — including the good one.
        expect(
          await prisma.purchase.findUnique({ where: { id: draft.id } }),
          scenario.label
        ).toMatchObject({ status: "DRAFT" });
        expect(await purchaseMovements(tenantAId, scenario.itemId), scenario.label).toEqual([]);
        expect(await purchaseMovements(tenantAId, goodItemId), scenario.label).toEqual([]);
        expect(await rawBalanceText(tenantAId, scenario.itemId), scenario.label).toBeNull();
        expect(await rawBalanceText(tenantAId, goodItemId), scenario.label).toBeNull();
        expect(await prisma.stockMovement.count()).toBe(movementsBefore);
        expect(await prisma.stockBalance.count()).toBe(balancesBefore);
        expect(await prisma.auditLog.count()).toBe(auditsBefore);
        expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      }
    }, 30_000);

    it("asserts the applied PURCHASE enum value and rejects a raw delete of a PURCHASE movement", async () => {
      // The APPLIED enum: `PURCHASE` was added ADDITIVELY, so `ADJUSTMENT`
      // keeps its original sort position and the new value follows it.
      // EPIC-12 POS-003 appended `SALE` the same way, so the effective set is
      // ADJUSTMENT, PURCHASE, SALE; the reserved TRANSFER_* and *_REVERSAL
      // compensations stay absent.
      const enumRows = await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_enum AS e
        JOIN pg_type AS t ON t.oid = e.enumtypid
        WHERE t.typname = 'stock_movement_type'
        ORDER BY e.enumsortorder ASC
      `;
      expect(enumRows.map((row) => row.enumlabel)).toEqual(["ADJUSTMENT", "PURCHASE", "SALE"]);

      // A real `PURCHASE` movement, written by the real command.
      const itemId = await createItem(ownerACookie, "Live Receiving Immutable Item");
      const draft = await createDraft(ownerACookie, [{ catalogItemId: itemId, quantity: "6.000" }]);
      const response = await receive(ownerACookie, draft.id, "live-pg-receiving-immutable");
      expect(response.status).toBe(201);
      const movementRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id"::text AS id FROM "stock_movement"
        WHERE "tenant_id" = ${tenantAId}::uuid AND "catalog_item_id" = ${itemId}::uuid
          AND "type" = 'PURCHASE'::stock_movement_type
      `;
      expect(movementRows).toHaveLength(1);
      const movementId = movementRows[0].id;
      const movementBefore = await prisma.stockMovement.findUnique({ where: { id: movementId } });
      expect(movementBefore).not.toBeNull();

      // The pre-existing no-delete trigger is unchanged and still rejects a raw
      // delete of the NEW movement type; the row physically survives.
      await expect(
        prisma.$executeRaw`DELETE FROM "stock_movement" WHERE "id" = ${movementId}::uuid`
      ).rejects.toThrow(/cannot be hard-deleted/);
      expect(await prisma.stockMovement.findUnique({ where: { id: movementId } })).toEqual(
        movementBefore
      );
    }, 30_000);
  });

  /**
   * EPIC-12 POS-001 live-PostgreSQL sale-draft evidence (task W3).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the `20260927000001_sales` migration's applied DDL — what the
   * in-memory boundary cannot represent:
   *   1. an atomic create persists the sale, its lines and exactly one
   *      `sale.created` audit row, with the DEC-021 snapshot stored at the real
   *      column scales;
   *   2. a create that fails inside the transaction persists no sale, no line
   *      and no audit row;
   *   3. a foreign sale UUID is one byte-equivalent `404` on read, update and
   *      cancel;
   *   4. the composite tenant-ownership keys, the six RESTRICT foreign keys and
   *      the `(tenant_id, status)` index are really applied;
   *   5. the `DRAFT`-only transition is a stable `409` that persists nothing;
   *   6. the CONDITIONAL delete triggers reject a settled sale and its lines
   *      while a DRAFT stays fully deletable;
   *   7. the one-line-per-item unique is real;
   *   8. the money and quantity CHECKs are real;
   *   9. the row-lock-first protocol serializes two concurrent cancels of one
   *      DRAFT into exactly one success and one stable `409`.
   *
   * Every assertion is deterministic: no mock, no injected Prisma error, no
   * sleep, no retry, and every raw-SQL mutation runs inside a transaction that is
   * rolled back, so no probe row ever survives.
   */
  describe("EPIC-12 sale draft application-path isolation", () => {
    /** Marker error that forces an interactive transaction to roll back. */
    const SALES_ROLLBACK_SENTINEL = "live-pg-sales-rollback";

    /** Global SEED-owned rates the line snapshots freeze (PRD §15). */
    let exemptRateId: string;
    let iva10RateId: string;
    /** Tenant-scoped customer references for the composite customer FK. */
    let saleCustomerAId: string;
    let saleCustomerBId: string;
    /** Tenant A catalog items covering both rates and both price sources. */
    let saleItemA1Id: string;
    let saleItemA2Id: string;
    let saleItemA3Id: string;
    /** Tenant A item whose informational reference currency is USD. */
    let usdItemAId: string;
    /** Tenant B item, referenced only by tenant B's own sale. */
    let saleItemBId: string;

    /** One sale create over REAL HTTP, with an optional pinned request id. */
    const postSale = (
      cookie: string,
      body: Record<string, unknown>,
      requestId?: string
    ): supertest.Test => {
      const request = supertest(serverUrl).post("/sales").set("Cookie", cookie);
      return (requestId === undefined ? request : request.set("X-Request-Id", requestId)).send(
        body
      );
    };

    /**
     * One ACTIVE tenant catalog item through the REAL catalog command, so the
     * frozen `rateCode` and the reference-price pair come from stored rows.
     */
    const createSaleItem = async (
      cookie: string,
      name: string,
      overrides: Record<string, unknown> = {}
    ): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", cookie)
        .send({ kind: "SUPPLY", name, taxRateId: exemptRateId, ...overrides })
        .expect(201);
      return (created.body as { id: string }).id;
    };

    /**
     * Extracts the database message from Prisma's raw-query error wrapper
     * (`Raw query failed. Code: \`23001\`. Message: \`...\``). The captured text
     * is the database's own message, so an assertion can compare it EXACTLY
     * instead of matching a substring of the wrapper.
     */
    const databaseMessage = (error: unknown): string => {
      const text = error instanceof Error ? error.message : String(error);
      const match = /Message: `([\s\S]*?)`/.exec(text);
      // PostgreSQL renders a `RAISE EXCEPTION` message with a fixed `ERROR: `
      // severity prefix; stripping it leaves the exact text the trigger raises.
      return (match ? match[1] : text).replace(/^ERROR: /, "");
    };

    /** Runs `probe` and returns the exact database message of its rejection. */
    const captureDatabaseMessage = async (probe: () => Promise<unknown>): Promise<string> => {
      try {
        await probe();
      } catch (error) {
        return databaseMessage(error);
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `work` inside an interactive transaction that is ALWAYS rolled back,
     * so a probe can seed throwaway rows and attempt a mutation without
     * persisting anything. An assertion failure inside `work` propagates and
     * fails the case instead of matching the rollback sentinel.
     */
    const inRolledBackTransaction = async (
      work: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<void> => {
      await expect(
        prisma.$transaction(async (tx) => {
          await work(tx);
          throw new Error(SALES_ROLLBACK_SENTINEL);
        })
      ).rejects.toThrow(SALES_ROLLBACK_SENTINEL);
    };

    /** Raw tenant-A `sale` insert with an explicit status; returns the id. */
    const insertRawSale = async (
      tx: Prisma.TransactionClient,
      status: "DRAFT" | "COMPLETED" | "CANCELLED",
      options: { customerId?: string | null } = {}
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "sale" ("id", "tenant_id", "customer_id", "currency", "status")
        VALUES (
          ${id}::uuid, ${tenantAId}::uuid, ${options.customerId ?? null}::uuid, 'PYG',
          ${status}::sale_status
        )
      `;
      return id;
    };

    /**
     * Raw line insert for a tenant-A sale at the migration's exact shape. The
     * money defaults are independent of `unitPrice`, so a negative-unit-price
     * probe violates its OWN CHECK and never the non-negative ones.
     */
    const insertRawSaleLine = async (
      tx: Prisma.TransactionClient,
      saleId: string,
      catalogItemId: string,
      overrides: {
        rateCode?: string;
        unitPrice?: string;
        quantity?: string;
        lineTotal?: string;
        taxableBase?: string;
        taxAmount?: string;
      } = {}
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "sale_line" (
          "id", "tenant_id", "sale_id", "catalog_item_id", "rate_code",
          "unit_price", "quantity", "line_total", "taxable_base", "tax_amount"
        )
        VALUES (
          ${id}::uuid, ${tenantAId}::uuid, ${saleId}::uuid, ${catalogItemId}::uuid,
          ${overrides.rateCode ?? "EXEMPT"},
          ${overrides.unitPrice ?? "100.00"}::decimal,
          ${overrides.quantity ?? "1.000"}::decimal,
          ${overrides.lineTotal ?? "100.00"}::decimal,
          ${overrides.taxableBase ?? "100.00"}::decimal,
          ${overrides.taxAmount ?? "0.00"}::decimal
        )
      `;
      return id;
    };

    /**
     * The stored `sale_line` columns of one sale, at their OWN exact scales, so
     * the DEC-021 snapshot is asserted against real PostgreSQL rather than the
     * HTTP projection alone.
     */
    const rawStoredLines = (
      saleId: string
    ): Promise<
      {
        catalog_item_id: string;
        rate_code: string;
        unit_price: string;
        quantity: string;
        line_total: string;
        taxable_base: string;
        tax_amount: string;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "catalog_item_id"::text AS catalog_item_id, "rate_code" AS rate_code,
          "unit_price"::text AS unit_price, "quantity"::text AS quantity,
          "line_total"::text AS line_total, "taxable_base"::text AS taxable_base,
          "tax_amount"::text AS tax_amount
        FROM "sale_line" WHERE "sale_id" = ${saleId}::uuid
        ORDER BY "catalog_item_id"::text ASC
      `;

    beforeAll(async () => {
      // The rate rows are SEED-owned, so resolving them proves the reference
      // seed really ran against this database (PRD §15).
      const rates = await prisma.taxRate.findMany();
      const rateIdsByCode = new Map(rates.map((rate) => [rate.code, rate.id]));
      const requireRate = (code: string): string => {
        const id = rateIdsByCode.get(code);
        if (!id) {
          throw new Error(`Reference seed did not create the global ${code} tax rate`);
        }
        return id;
      };
      exemptRateId = requireRate("EXEMPT");
      iva10RateId = requireRate("IVA_10");

      // The `sales` grant is explicit: plan mappings never grant access, so both
      // live tenants must hold a direct tenant_entitlement row (DEC-026).
      const salesFeature = await prisma.featureCode.upsert({
        where: { code: "sales" },
        create: { code: "sales" },
        update: {},
      });
      for (const tenantId of [tenantAId, tenantBId]) {
        await prisma.tenantEntitlement.upsert({
          where: {
            tenantId_featureCodeId: { tenantId, featureCodeId: salesFeature.id },
          },
          create: { tenantId, featureCodeId: salesFeature.id },
          update: {},
        });
      }

      // Every live case owns its own fixture: the development database seeds no
      // customer and no catalog item, so this block creates what it references.
      saleCustomerAId = (
        await prisma.customer.create({
          data: { tenantId: tenantAId, kind: "INDIVIDUAL", displayName: "Live Sale Customer A" },
        })
      ).id;
      saleCustomerBId = (
        await prisma.customer.create({
          data: { tenantId: tenantBId, kind: "INDIVIDUAL", displayName: "Live Sale Customer B" },
        })
      ).id;

      saleItemA1Id = await createSaleItem(ownerACookie, "Live Sale Item A1", {
        taxRateId: iva10RateId,
        referencePriceAmount: "11000.00",
        referencePriceCurrency: "PYG",
      });
      saleItemA2Id = await createSaleItem(ownerACookie, "Live Sale Item A2", {
        referencePriceAmount: "1000.00",
        referencePriceCurrency: "PYG",
      });
      // No reference price at all: the operator override is the only price.
      saleItemA3Id = await createSaleItem(ownerACookie, "Live Sale Item A3", {
        taxRateId: iva10RateId,
      });
      usdItemAId = await createSaleItem(ownerACookie, "Live Sale USD Item A", {
        referencePriceAmount: "100.00",
        referencePriceCurrency: "USD",
      });
      saleItemBId = await createSaleItem(ownerBCookie, "Live Sale Item B1", {
        referencePriceAmount: "100.00",
        referencePriceCurrency: "PYG",
      });
    }, 60_000);

    it("creates a sale atomically with its lines, the DEC-021 snapshot and exactly one sale.created audit row", async () => {
      const movementsBefore = await prisma.stockMovement.count();
      const balancesBefore = await prisma.stockBalance.count();
      const salesBefore = await prisma.sale.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-sales-create";

      const created = await postSale(
        ownerACookie,
        {
          customerId: saleCustomerAId,
          lines: [
            { catalogItemId: saleItemA1Id, quantity: "1" },
            { catalogItemId: saleItemA2Id, quantity: "2.500", unitPrice: "100.00" },
            { catalogItemId: saleItemA3Id, quantity: "1.000", unitPrice: "1000.00" },
          ],
        },
        requestId
      ).expect(201);

      const body = created.body as SaleDto;
      expect(Object.keys(body).sort()).toEqual(SALE_DTO_KEYS);
      expect(body.tenantId).toBe(tenantAId);
      expect(body.customerId).toBe(saleCustomerAId);
      // The currency is resolved server-side from `sales.defaultCurrency` and
      // never read from the body (DEC-022).
      expect(body.currency).toBe("PYG");
      expect(body.status).toBe("DRAFT");
      expect(body.lines).toHaveLength(3);
      for (const line of body.lines) {
        expect(Object.keys(line).sort()).toEqual(SALE_LINE_DTO_KEYS);
      }
      // The total is the sum of the line totals: there is no total column.
      expect(body.total).toBe("12250.00");

      // The REAL stored columns at their own exact scales: quantity at
      // `Decimal(10,3)`, money at `Decimal(14,2)`, with the frozen rate code and
      // the derived snapshot equal to the DEC-021 rule:
      //   lineTotal   = round(unitPrice * quantity)
      //   taxableBase = round(lineTotal / (1 + rate/100))
      //   taxAmount   = lineTotal - taxableBase
      const storedByItem = new Map(
        (await rawStoredLines(body.id)).map((row) => [row.catalog_item_id, row])
      );
      expect(storedByItem.size).toBe(3);
      // IVA_10 reference price 11000.00 x 1.000 = 11000; 11000 / 1.1 = 10000.
      expect(storedByItem.get(saleItemA1Id)).toEqual({
        catalog_item_id: saleItemA1Id,
        rate_code: "IVA_10",
        unit_price: "11000.00",
        quantity: "1.000",
        line_total: "11000.00",
        taxable_base: "10000.00",
        tax_amount: "1000.00",
      });
      // EXEMPT override 100.00 x 2.500 = 250, base === total, no tax.
      expect(storedByItem.get(saleItemA2Id)).toEqual({
        catalog_item_id: saleItemA2Id,
        rate_code: "EXEMPT",
        unit_price: "100.00",
        quantity: "2.500",
        line_total: "250.00",
        taxable_base: "250.00",
        tax_amount: "0.00",
      });
      // IVA_10 override 1000.00 x 1.000 = 1000; 1000 / 1.1 = 909.09... rounds
      // HALF-UP at the PYG minor unit (0 decimals) to 909, tax 91.
      expect(storedByItem.get(saleItemA3Id)).toEqual({
        catalog_item_id: saleItemA3Id,
        rate_code: "IVA_10",
        unit_price: "1000.00",
        quantity: "1.000",
        line_total: "1000.00",
        taxable_base: "909.00",
        tax_amount: "91.00",
      });

      // The header row itself is DRAFT and carries the in-tenant reference.
      expect(await prisma.sale.findUnique({ where: { id: body.id } })).toMatchObject({
        tenantId: tenantAId,
        customerId: saleCustomerAId,
        currency: "PYG",
        status: "DRAFT",
      });

      // Exactly ONE co-committed audit row carrying ids and field NAMES only.
      const audits = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "sale.created",
        targetType: "sale",
        targetId: body.id,
        tenantId: tenantAId,
      });
      const metadata = audits[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual(["customerId", "currency", "lines"]);
      const serializedMetadata = JSON.stringify(metadata);
      expect(serializedMetadata).not.toContain(saleItemA1Id);
      expect(serializedMetadata).not.toContain("11000.00");
      expect(serializedMetadata).not.toContain(saleCustomerAId);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.sale.count({ where: { tenantId: tenantAId } })).toBe(salesBefore + 1);

      // The draft path is INERT: no stock movement and no balance row appeared.
      expect(await prisma.stockMovement.count()).toBe(movementsBefore);
      expect(await prisma.stockBalance.count()).toBe(balancesBefore);
    }, 30_000);

    it("persists nothing when a create is rejected inside the transaction", async () => {
      const salesBefore = await prisma.sale.count({ where: { tenantId: tenantAId } });
      const linesBefore = await prisma.saleLine.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();

      const scenarios: {
        label: string;
        requestId: string;
        body: Record<string, unknown>;
        status: number;
        code: string;
        message?: string;
      }[] = [
        {
          label: "unknown catalog item",
          requestId: "live-pg-sales-create-unknown-item",
          body: { lines: [{ catalogItemId: randomUUID(), quantity: "1" }] },
          status: 404,
          code: "NOT_FOUND",
        },
        {
          label: "cross-tenant catalog item",
          requestId: "live-pg-sales-create-foreign-item",
          body: { lines: [{ catalogItemId: saleItemBId, quantity: "1" }] },
          status: 404,
          code: "NOT_FOUND",
        },
        {
          label: "cross-currency reference price",
          requestId: "live-pg-sales-create-currency-mismatch",
          body: { lines: [{ catalogItemId: usdItemAId, quantity: "1" }] },
          status: 400,
          code: "VALIDATION_FAILED",
          message: SALE_CURRENCY_MISMATCH_MESSAGE,
        },
      ];

      for (const scenario of scenarios) {
        const response = await postSale(ownerACookie, scenario.body, scenario.requestId);
        expect(response.status, scenario.label).toBe(scenario.status);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe(scenario.code);
        if (scenario.message !== undefined) {
          expect(
            (response.body as { error: { message: string } }).error.message,
            scenario.label
          ).toBe(scenario.message);
        }
        // The rejection is value-free: the foreign item id never leaks.
        expect(response.text, scenario.label).not.toContain(saleItemBId);
      }

      // Nothing persisted for ANY rejected attempt: no sale row, no line row and
      // no audit row trailed the transaction that aborted.
      expect(await prisma.sale.count({ where: { tenantId: tenantAId } })).toBe(salesBefore);
      expect(await prisma.saleLine.count({ where: { tenantId: tenantAId } })).toBe(linesBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: scenarios.map((scenario) => scenario.requestId) } },
        })
      ).toBe(0);
    }, 30_000);

    it("masks another tenant's sale as one byte-equivalent 404 on read, update and cancel", async () => {
      // Tenant B owns a real draft every masked tenant-A verb must never resolve.
      const foreign = await postSale(ownerBCookie, {
        customerId: saleCustomerBId,
        lines: [{ catalogItemId: saleItemBId, quantity: "1" }],
      }).expect(201);
      const foreignBody = foreign.body as SaleDto;
      expect(foreignBody.tenantId).toBe(tenantBId);

      const requestId = SALE_NOT_FOUND_REQUEST_ID;
      const auditsBefore = await prisma.auditLog.count();
      const updateBody = { lines: [{ catalogItemId: saleItemA1Id, quantity: "1" }] };

      const cases = [
        {
          label: "GET /sales/:id",
          request: () =>
            supertest(serverUrl)
              .get(`/sales/${foreignBody.id}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
          missingRequest: () =>
            supertest(serverUrl)
              .get(`/sales/${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
        },
        {
          label: "PUT /sales/:id",
          request: () =>
            supertest(serverUrl)
              .put(`/sales/${foreignBody.id}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId)
              .send(updateBody),
          missingRequest: () =>
            supertest(serverUrl)
              .put(`/sales/${randomUUID()}`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId)
              .send(updateBody),
        },
        {
          label: "POST /sales/:id/cancel",
          request: () =>
            supertest(serverUrl)
              .post(`/sales/${foreignBody.id}/cancel`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
          missingRequest: () =>
            supertest(serverUrl)
              .post(`/sales/${randomUUID()}/cancel`)
              .set("Cookie", ownerACookie)
              .set("X-Request-Id", requestId),
        },
      ];

      for (const scenario of cases) {
        const response = await scenario.request().expect(404);
        const missingResponse = await scenario.missingRequest().expect(404);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe("NOT_FOUND");
        expect(
          (response.body as { error: { message: string } }).error.message,
          scenario.label
        ).toBe(SALE_NOT_FOUND_MESSAGE);
        // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
        // non-existent one, echoed correlation included.
        expect(response.text, scenario.label).toBe(missingResponse.text);
        expect(response.text, scenario.label).not.toContain(foreignBody.id);
        expect(response.text, scenario.label).not.toContain(tenantBId);
        expect(response.text, scenario.label).not.toContain(saleItemBId);
      }

      // Tenant B's draft survived every masked attempt unchanged.
      expect(await prisma.sale.findUnique({ where: { id: foreignBody.id } })).toMatchObject({
        status: "DRAFT",
        customerId: saleCustomerBId,
        currency: "PYG",
      });
      const storedLines = await rawStoredLines(foreignBody.id);
      expect(storedLines).toHaveLength(1);
      expect(storedLines[0].catalog_item_id).toBe(saleItemBId);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
    }, 30_000);

    it("proves the composite ownership keys, the six RESTRICT foreign keys and the status index against the applied schema", async () => {
      const salesBefore = await prisma.sale.count();
      const linesBefore = await prisma.saleLine.count();

      // The APPLIED lifecycle enum: exactly the PRD §18 states, in order.
      const enumRows = await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_enum AS e
        JOIN pg_type AS t ON t.oid = e.enumtypid
        WHERE t.typname = 'sale_status'
        ORDER BY e.enumsortorder ASC
      `;
      expect(enumRows.map((row) => row.enumlabel)).toEqual(["DRAFT", "COMPLETED", "CANCELLED"]);

      // The six APPLIED foreign keys, every one RESTRICT on delete AND update,
      // exactly on the tables the migration declares.
      const fkRows = await prisma.$queryRaw<
        {
          conname: string;
          table_name: string;
          referenced_table: string;
          on_delete: string;
          on_update: string;
        }[]
      >`
        SELECT
          c.conname,
          rel.relname AS table_name,
          frel.relname AS referenced_table,
          c.confdeltype AS on_delete,
          c.confupdtype AS on_update
        FROM pg_constraint AS c
        JOIN pg_class AS rel ON rel.oid = c.conrelid
        JOIN pg_class AS frel ON frel.oid = c.confrelid
        WHERE rel.relname IN ('sale', 'sale_line') AND c.contype = 'f'
      `;
      expect(
        fkRows
          .map(
            (row) =>
              `${row.conname}:${row.table_name}->${row.referenced_table}:${row.on_delete}${row.on_update}`
          )
          .sort()
      ).toEqual(
        [
          "sale_line_rate_code_fkey:sale_line->tax_rate:rr",
          "sale_line_tenant_id_catalog_item_id_fkey:sale_line->catalog_item:rr",
          "sale_line_tenant_id_fkey:sale_line->tenant:rr",
          "sale_line_tenant_id_sale_id_fkey:sale_line->sale:rr",
          "sale_tenant_id_customer_id_fkey:sale->customer:rr",
          "sale_tenant_id_fkey:sale->tenant:rr",
        ].sort()
      );

      // The composite `(tenant_id, id)` ownership keys and the `(tenant_id,
      // status)` list index are APPLIED with their exact key columns.
      const indexRows = await prisma.$queryRaw<
        { relname: string; is_unique: boolean; key_1: string; key_2: string }[]
      >`
        SELECT
          c.relname,
          i.indisunique AS is_unique,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        WHERE c.relname IN (
          'sale_tenant_id_id_key',
          'sale_line_tenant_id_id_key',
          'sale_tenant_id_status_idx'
        )
      `;
      expect(
        indexRows.map((row) => `${row.relname}:${row.is_unique}:${row.key_1},${row.key_2}`).sort()
      ).toEqual(
        [
          "sale_line_tenant_id_id_key:true:tenant_id,id",
          "sale_tenant_id_id_key:true:tenant_id,id",
          "sale_tenant_id_status_idx:false:tenant_id,status",
        ].sort()
      );

      // The composite customer FK rejects a tenant-A sale pointing at a
      // tenant-B customer...
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawSale(tx, "DRAFT", { customerId: saleCustomerBId })
        );
        expect(message).toContain("sale_tenant_id_customer_id_fkey");
      });

      // ...a tenant-A line pointing at a tenant-B catalog item is rejected by
      // the composite catalog-item FK...
      await inRolledBackTransaction(async (tx) => {
        const saleId = await insertRawSale(tx, "DRAFT");
        const message = await captureDatabaseMessage(() =>
          insertRawSaleLine(tx, saleId, saleItemBId)
        );
        expect(message).toContain("sale_line_tenant_id_catalog_item_id_fkey");
      });

      // ...and `rate_code` can only name a seeded global rate (DEC-021).
      await inRolledBackTransaction(async (tx) => {
        const saleId = await insertRawSale(tx, "DRAFT");
        const message = await captureDatabaseMessage(() =>
          insertRawSaleLine(tx, saleId, saleItemA1Id, { rateCode: "NO_SUCH_RATE" })
        );
        expect(message).toContain("sale_line_rate_code_fkey");
      });

      // Every probe rolled back: no throwaway sale or line survived.
      expect(await prisma.sale.count()).toBe(salesBefore);
      expect(await prisma.saleLine.count()).toBe(linesBefore);
    }, 30_000);

    it("rejects an update and a cancel of a CANCELLED sale with the stable 409 and keeps the row and its lines intact", async () => {
      const created = await postSale(ownerACookie, {
        lines: [
          { catalogItemId: saleItemA1Id, quantity: "1" },
          { catalogItemId: saleItemA2Id, quantity: "2.500", unitPrice: "100.00" },
        ],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;

      const cancelled = await supertest(serverUrl)
        .post(`/sales/${saleId}/cancel`)
        .set("Cookie", ownerACookie)
        .expect(201);
      expect((cancelled.body as SaleDto).status).toBe("CANCELLED");

      const storedBefore = await prisma.sale.findUnique({ where: { id: saleId } });
      const linesBefore = await rawStoredLines(saleId);
      expect(linesBefore).toHaveLength(2);
      const auditsBefore = await prisma.auditLog.count();
      const updateRequestId = "live-pg-sales-cancelled-update";
      const cancelRequestId = "live-pg-sales-cancelled-cancel";

      const update = await supertest(serverUrl)
        .put(`/sales/${saleId}`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", updateRequestId)
        .send({ lines: [{ catalogItemId: saleItemA3Id, quantity: "9.000", unitPrice: "1.00" }] })
        .expect(409);
      expect((update.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((update.body as { error: { message: string } }).error.message).toBe(
        SALE_NOT_EDITABLE_MESSAGE
      );

      const cancel = await supertest(serverUrl)
        .post(`/sales/${saleId}/cancel`)
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", cancelRequestId)
        .expect(409);
      expect((cancel.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((cancel.body as { error: { message: string } }).error.message).toBe(
        SALE_NOT_EDITABLE_MESSAGE
      );

      // Nothing was persisted: the stored status and the complete line set are
      // exactly as the successful cancel left them, and no audit row trailed
      // either rejected command.
      expect(await prisma.sale.findUnique({ where: { id: saleId } })).toEqual(storedBefore);
      expect(await rawStoredLines(saleId)).toEqual(linesBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: [updateRequestId, cancelRequestId] } },
        })
      ).toBe(0);
    }, 30_000);

    it("rejects deleting a COMPLETED or CANCELLED sale and its lines while a DRAFT deletes", async () => {
      const salesBefore = await prisma.sale.count();
      const linesBefore = await prisma.saleLine.count();

      // The migration's two triggers are BEFORE DELETE ROW and never fire on
      // UPDATE: the DRAFT-conditional shape DEC-023 mandates, NOT the
      // unconditional shape the catalog/supplier/inventory tables use.
      const triggers = await prisma.$queryRaw<
        { tgname: string; proname: string; tgtype: number }[]
      >`
        SELECT t.tgname, p.proname, t.tgtype::int AS tgtype
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_proc AS p ON p.oid = t.tgfoid
        WHERE c.relname IN ('sale', 'sale_line') AND NOT t.tgisinternal
      `;
      expect(triggers.map((row) => row.tgname).sort()).toEqual(
        [
          "sale_line_no_delete_when_completed_or_cancelled_trigger",
          "sale_no_delete_when_completed_or_cancelled_trigger",
        ].sort()
      );
      for (const trigger of triggers) {
        expect(trigger.tgtype & 1).toBe(1); // ROW
        expect(trigger.tgtype & 2).toBe(2); // BEFORE
        expect(trigger.tgtype & 8).toBe(8); // DELETE
        expect(trigger.tgtype & 16).toBe(0); // NOT UPDATE
      }

      // The trigger FUNCTIONS carry the CONDITIONAL predicate: the header reads
      // its own status and the line reads the OWNING sale's status, and both
      // raise `restrict_violation` only for a settled sale.
      const functions = await prisma.$queryRaw<{ proname: string; prosrc: string }[]>`
        SELECT p.proname, p.prosrc
        FROM pg_proc AS p
        WHERE p.proname IN (
          'sale_no_delete_when_completed_or_cancelled',
          'sale_line_no_delete_when_completed_or_cancelled'
        )
      `;
      const sourceByName = new Map(
        functions.map((row) => [row.proname, row.prosrc.replace(/\s+/g, " ")])
      );
      const headerSource = sourceByName.get("sale_no_delete_when_completed_or_cancelled");
      expect(headerSource).toContain(`OLD."status" IN ('COMPLETED', 'CANCELLED')`);
      expect(headerSource).toContain("ERRCODE = 'restrict_violation'");
      const lineSource = sourceByName.get("sale_line_no_delete_when_completed_or_cancelled");
      expect(lineSource).toContain(`parent_status IN ('COMPLETED', 'CANCELLED')`);
      expect(lineSource).toContain('FROM "sale"');
      expect(lineSource).toContain("ERRCODE = 'restrict_violation'");

      // A DRAFT is fully editable: its line and then its header both delete.
      await inRolledBackTransaction(async (tx) => {
        const saleId = await insertRawSale(tx, "DRAFT");
        const lineId = await insertRawSaleLine(tx, saleId, saleItemA1Id);
        expect(await tx.$executeRaw`DELETE FROM "sale_line" WHERE "id" = ${lineId}::uuid`).toBe(1);
        expect(await tx.$executeRaw`DELETE FROM "sale" WHERE "id" = ${saleId}::uuid`).toBe(1);
      });

      for (const status of ["COMPLETED", "CANCELLED"] as const) {
        // The header trigger refuses the DELETE with its EXACT message.
        await inRolledBackTransaction(async (tx) => {
          const saleId = await insertRawSale(tx, status);
          expect(
            await captureDatabaseMessage(
              () => tx.$executeRaw`DELETE FROM "sale" WHERE "id" = ${saleId}::uuid`
            )
          ).toBe("a completed or cancelled sale cannot be deleted");
        });

        // The line trigger reads the OWNING sale's status.
        await inRolledBackTransaction(async (tx) => {
          const saleId = await insertRawSale(tx, status);
          const lineId = await insertRawSaleLine(tx, saleId, saleItemA1Id);
          expect(
            await captureDatabaseMessage(
              () => tx.$executeRaw`DELETE FROM "sale_line" WHERE "id" = ${lineId}::uuid`
            )
          ).toBe("a line of a completed or cancelled sale cannot be deleted");
        });
      }

      // Every probe rolled back: no throwaway sale or line survived.
      expect(await prisma.sale.count()).toBe(salesBefore);
      expect(await prisma.saleLine.count()).toBe(linesBefore);
    }, 30_000);

    it("rejects a second line for the same catalog item through the applied unique index", async () => {
      // The APPLIED index: UNIQUE on (tenant_id, sale_id, catalog_item_id),
      // non-partial and not the primary key.
      const indexRows = await prisma.$queryRaw<
        {
          is_unique: boolean;
          is_primary: boolean;
          key_1: string | null;
          key_2: string | null;
          key_3: string | null;
          predicate: string | null;
        }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_indexdef(i.indexrelid, 3, true) AS key_3,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'sale_line_tenant_id_sale_id_catalog_item_id_key'
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0].is_unique).toBe(true);
      expect(indexRows[0].is_primary).toBe(false);
      expect(indexRows[0].key_1).toBe("tenant_id");
      expect(indexRows[0].key_2).toBe("sale_id");
      expect(indexRows[0].key_3).toBe("catalog_item_id");
      // UNCONDITIONAL by design: a duplicate inside a draft is never valid,
      // whatever the sale status.
      expect(indexRows[0].predicate).toBeNull();

      // Exactly ONE unique index on `sale_line` covers those three columns in
      // that order, so the violation below can only be this key.
      const covering = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        JOIN pg_class AS t ON t.oid = i.indrelid
        WHERE t.relname = 'sale_line' AND i.indisunique
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'tenant_id'
          AND pg_get_indexdef(i.indexrelid, 2, true) = 'sale_id'
          AND pg_get_indexdef(i.indexrelid, 3, true) = 'catalog_item_id'
      `;
      expect(covering.map((row) => row.relname)).toEqual([
        "sale_line_tenant_id_sale_id_catalog_item_id_key",
      ]);

      // A REAL draft with one line, then a raw duplicate of that same key. The
      // HTTP path cannot produce this violation because the request contract
      // rejects a duplicate item in the payload, so the proof is explicit.
      const created = await postSale(ownerACookie, {
        lines: [{ catalogItemId: saleItemA1Id, quantity: "1" }],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      expect(await prisma.saleLine.count({ where: { saleId } })).toBe(1);

      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawSaleLine(tx, saleId, saleItemA1Id, { quantity: "5.000" })
        );
        // Prisma surfaces PostgreSQL's `unique_violation` DETAIL, which names
        // the violated key columns exactly.
        expect(message).toContain("Key (tenant_id, sale_id, catalog_item_id)=");
        expect(message).toContain("already exists.");
      });

      // The rejection persisted nothing: the sale still holds one line.
      expect(await prisma.saleLine.count({ where: { saleId } })).toBe(1);

      // The request contract refuses the same payload first with a stable 400,
      // so the unique key is never the first line of defence.
      const duplicate = await postSale(ownerACookie, {
        lines: [
          { catalogItemId: saleItemA1Id, quantity: "1" },
          { catalogItemId: saleItemA1Id, quantity: "2" },
        ],
      });
      expect(duplicate.status).toBe(400);
      expect((duplicate.body as ErrorEnvelope).error.code).toBe("VALIDATION_FAILED");
      expect(await prisma.saleLine.count({ where: { saleId } })).toBe(1);
    }, 30_000);

    it("rejects a non-positive quantity and a negative unit price at the applied CHECK constraints", async () => {
      // The five APPLIED line CHECKs.
      const checkRows = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint AS c
        JOIN pg_class AS t ON t.oid = c.conrelid
        WHERE t.relname = 'sale_line' AND c.contype = 'c'
      `;
      expect(checkRows.map((row) => row.conname).sort()).toEqual(
        [
          "sale_line_line_total_non_negative",
          "sale_line_quantity_positive",
          "sale_line_tax_amount_non_negative",
          "sale_line_taxable_base_non_negative",
          "sale_line_unit_price_non_negative",
        ].sort()
      );

      const linesBefore = await prisma.saleLine.count();

      for (const quantity of ["0.000", "-1.000"]) {
        await inRolledBackTransaction(async (tx) => {
          const saleId = await insertRawSale(tx, "DRAFT");
          const message = await captureDatabaseMessage(() =>
            insertRawSaleLine(tx, saleId, saleItemA1Id, { quantity })
          );
          expect(message, quantity).toContain("sale_line_quantity_positive");
        });
      }

      await inRolledBackTransaction(async (tx) => {
        const saleId = await insertRawSale(tx, "DRAFT");
        const message = await captureDatabaseMessage(() =>
          insertRawSaleLine(tx, saleId, saleItemA1Id, { unitPrice: "-1.00" })
        );
        expect(message).toContain("sale_line_unit_price_non_negative");
      });

      // Every probe rolled back: no rejected line survived.
      expect(await prisma.saleLine.count()).toBe(linesBefore);
    }, 30_000);

    it("serializes two concurrent cancels of the SAME draft into exactly one success and one stable 409", async () => {
      const created = await postSale(ownerACookie, {
        lines: [
          { catalogItemId: saleItemA1Id, quantity: "1" },
          { catalogItemId: saleItemA2Id, quantity: "2.500", unitPrice: "100.00" },
        ],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      const lineSetBefore = await rawStoredLines(saleId);
      expect(lineSetBefore).toHaveLength(2);
      const firstRequestId = "live-pg-sales-race-1";
      const secondRequestId = "live-pg-sales-race-2";
      const auditsBefore = await prisma.auditLog.count();

      // Deterministic overlap: a dedicated transaction holds the sale HEADER row
      // lock (`SELECT ... FOR UPDATE`), which is the exact row `lockById` locks
      // FIRST, so BOTH cancels park on that single row before either can read
      // the status. `waitForRowLockWaiters` matches the tuple lock on THAT row,
      // so an unrelated lock waiter can never satisfy it: the interleaving is
      // decided by the database boundary, never by wall-clock timing.
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
            SELECT "id" FROM "sale"
            WHERE "tenant_id" = ${tenantAId}::uuid AND "id" = ${saleId}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;
      // The row lock is held now, so the ctid cannot move under the racers.
      const ctid = await readRowCtid(prisma, "sale", saleId);

      const racers = [
        supertest(serverUrl)
          .post(`/sales/${saleId}/cancel`)
          .set("Cookie", ownerACookie)
          .set("X-Request-Id", firstRequestId)
          .then((response) => response),
        supertest(serverUrl)
          .post(`/sales/${saleId}/cancel`)
          .set("Cookie", ownerACookie)
          .set("X-Request-Id", secondRequestId)
          .then((response) => response),
      ];

      try {
        await waitForRowLockWaiters(prisma, "sale", ctid.page, ctid.tuple, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      // The database guarantees this outcome for EVERY interleaving: the winner
      // commits CANCELLED inside its transaction, and the loser's post-lock
      // status read sees the committed status and is rejected by the DRAFT gate.
      const admitted = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((admitted[0].body as SaleDto).status).toBe("CANCELLED");
      expect((rejected[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected[0].body as { error: { message: string } }).error.message).toBe(
        SALE_NOT_EDITABLE_MESSAGE
      );

      // Exactly ONE application of the transition: the stored status is
      // CANCELLED, the line set is COMPLETE (cancel never touched it, so there
      // is no partial or lost line), and exactly ONE `sale.cancelled` audit row
      // exists across BOTH attempts.
      expect(await prisma.sale.findUnique({ where: { id: saleId } })).toMatchObject({
        status: "CANCELLED",
      });
      expect(await rawStoredLines(saleId)).toEqual(lineSetBefore);
      const raceAudits = await prisma.auditLog.findMany({
        where: { requestId: { in: [firstRequestId, secondRequestId] } },
      });
      expect(raceAudits).toHaveLength(1);
      expect(raceAudits[0]).toMatchObject({
        action: "sale.cancelled",
        targetType: "sale",
        targetId: saleId,
        tenantId: tenantAId,
      });
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
    }, 60_000);
  });

  /**
   * EPIC-12 POS-002 live-PostgreSQL evidence (C3).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the `20260927000002_cash_foundation` migration's real DDL —
   * what the shared in-memory boundary cannot represent (the POS-002 Story's
   * Known Limitations say so explicitly: the fake enforces no partial unique
   * index and no CHECK, so the one-`OPEN` rule MUST be proven against real
   * PostgreSQL):
   *   1. a register create over HTTP persists the trimmed name, returns the
   *      allowlisted projection and co-commits exactly one `cash.register.created`
   *      audit row carrying field NAMES only;
   *   2. the per-tenant register-name unique is REAL, proven by a raw duplicate
   *      insert the applied index rejects by name while the same name in another
   *      tenant is admitted, and by the HTTP `409` the real index produces;
   *   3. a session open stores the exact `Decimal(14,2)` float with `OPEN` status,
   *      resolves the register in-tenant and the opener from the request context,
   *      and co-commits exactly one `cash.session.opened` audit row;
   *   4. the one-`OPEN`-session rule is a DATABASE property: the applied partial
   *      index carries the exact predicate, a raw duplicate is rejected by name,
   *      a `CLOSED` row is outside the index, and two concurrent opens under a
   *      proven table-lock overlap resolve to exactly one `201` and one stable
   *      `409` with one session row and one audit row;
   *   5. the seven composite `RESTRICT` ownership keys are applied and reject
   *      cross-tenant register, opener and session references;
   *   6. confirmed rows are immutable and the money CHECKs are real;
   *   7. another tenant's register is one byte-equivalent `404` and another
   *      tenant's session is never observable over HTTP;
   *   8. the cash surface is INERT: it writes no movement, sale, stock movement
   *      or balance change;
   *   9. zero residue: every raw probe rolled back and the fixture counts are
   *      unchanged.
   *
   * Every assertion is deterministic: no injected Prisma error, no mock, no
   * sleep, no retry, and every raw-SQL mutation runs inside a transaction that
   * is rolled back, so no probe row ever survives.
   */
  describe("EPIC-12 cash foundation application-path isolation", () => {
    /** Marker error that forces an interactive transaction to roll back. */
    const CASH_ROLLBACK_SENTINEL = "live-pg-cash-rollback";

    /**
     * Probe-only fixture register: no HTTP case ever opens a session on it, so
     * the zero-residue case can prove that every raw session probe rolled back.
     */
    let cashRegisterAId: string;
    /** Tenant B's own register, referenced only by the cross-tenant probes. */
    let cashRegisterBId: string;
    /** Tenant B's own committed `OPEN` session, the foreign row to leave intact. */
    let cashForeignSessionBId: string;
    /** The two live owners' ACTIVE memberships: the opener the DB stores. */
    let membershipAId: string;
    let membershipBId: string;

    /** One register create over REAL HTTP, with an optional pinned request id. */
    const createRegister = (
      cookie: string,
      body: Record<string, unknown>,
      requestId?: string
    ): supertest.Test => {
      const request = supertest(serverUrl).post("/cash/registers").set("Cookie", cookie);
      return (requestId === undefined ? request : request.set("X-Request-Id", requestId)).send(
        body
      );
    };

    /** One session open over REAL HTTP, with an optional pinned request id. */
    const openSession = (
      cookie: string,
      registerId: string,
      openingAmount: string,
      requestId?: string
    ): supertest.Test => {
      const request = supertest(serverUrl).post("/cash/sessions").set("Cookie", cookie);
      return (requestId === undefined ? request : request.set("X-Request-Id", requestId)).send({
        registerId,
        openingAmount,
      });
    };

    /**
     * Extracts the database message from Prisma's raw-query error wrapper
     * (`Raw query failed. Code: `23001`. Message: `...``). The captured text is
     * the database's own message, so an assertion can compare it EXACTLY instead
     * of matching a substring of the wrapper.
     */
    const databaseMessage = (error: unknown): string => {
      const text = error instanceof Error ? error.message : String(error);
      const match = /Message: `([\s\S]*?)`/.exec(text);
      // PostgreSQL renders a `RAISE EXCEPTION` message with a fixed `ERROR: `
      // severity prefix; stripping it leaves the exact text the trigger raises.
      return (match ? match[1] : text).replace(/^ERROR: /, "");
    };

    /** Runs `probe` and returns the exact database message of its rejection. */
    const captureDatabaseMessage = async (probe: () => Promise<unknown>): Promise<string> => {
      try {
        await probe();
      } catch (error) {
        return databaseMessage(error);
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `probe` and returns the PostgreSQL SQLSTATE and the exact message
     * Prisma surfaced for its rejection.
     *
     * Prisma wraps a raw `unique_violation` as `P2010` and puts the SERVER's
     * SQLSTATE in `meta.code` (`23505`) and the server's DETAIL text in
     * `meta.message`. That DETAIL names the violated KEY COLUMNS exactly
     * (`Key (tenant_id, name)=(...) already exists.`) but never the index, which
     * is why the APPLIED index that produced it is identified by catalogue
     * introspection (its name, its exact key columns and, where it has one, its
     * exact predicate) rather than by message text.
     */
    const captureRawRejection = async (
      probe: () => Promise<unknown>
    ): Promise<{ sqlState: string | undefined; message: string }> => {
      try {
        await probe();
      } catch (error) {
        const candidate = error as { meta?: { code?: unknown; message?: unknown } };
        return {
          sqlState: typeof candidate.meta?.code === "string" ? candidate.meta.code : undefined,
          message:
            typeof candidate.meta?.message === "string"
              ? candidate.meta.message
              : databaseMessage(error),
        };
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `work` inside an interactive transaction that is ALWAYS rolled back,
     * so a probe can seed throwaway rows and attempt a mutation without
     * persisting anything. An assertion failure inside `work` propagates and
     * fails the case instead of matching the rollback sentinel.
     */
    const inRolledBackTransaction = async (
      work: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<void> => {
      await expect(
        prisma.$transaction(async (tx) => {
          await work(tx);
          throw new Error(CASH_ROLLBACK_SENTINEL);
        })
      ).rejects.toThrow(CASH_ROLLBACK_SENTINEL);
    };

    /** Raw register insert at the migration's exact shape; returns the id. */
    const insertRawRegister = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      name: string
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_register" ("id", "tenant_id", "name")
        VALUES (${id}::uuid, ${tenantId}::uuid, ${name})
      `;
      return id;
    };

    /**
     * Raw session insert at the migration's exact shape; returns the id. The
     * opener and the register are caller-supplied so a probe can point at a
     * FOREIGN row and let the composite keys reject it.
     */
    const insertRawSession = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      registerId: string,
      openedByMembershipId: string,
      openingAmount: string,
      status: "OPEN" | "CLOSED" = "OPEN"
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_session" (
          "id", "tenant_id", "register_id", "status", "opened_by_membership_id",
          "opening_amount"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid,
          ${status}::cash_session_status, ${openedByMembershipId}::uuid,
          ${openingAmount}::decimal
        )
      `;
      return id;
    };

    /**
     * Raw movement insert at the migration's exact shape; returns the id. The
     * optional `direction` is the EPIC-13 CASH-002 column and defaults to NULL,
     * the only legal value for every type-owned kind; an `ADJUSTMENT` probe MUST
     * pass one, because `cash_movement_direction_required` refuses a NULL for it
     * BEFORE the reason CHECK is ever consulted.
     */
    const insertRawMovement = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      registerId: string,
      sessionId: string,
      amount: string,
      type = "SALE",
      reason: string | null = null,
      direction: string | null = null
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_movement" (
          "id", "tenant_id", "register_id", "session_id", "type", "amount", "reason", "direction"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${sessionId}::uuid,
          ${type}::cash_movement_type, ${amount}::decimal, ${reason},
          ${direction}::cash_movement_direction
        )
      `;
      return id;
    };

    /**
     * The STORED `cash_session` columns of one row, read from PostgreSQL at
     * their OWN exact scales, so the `Decimal(14, 2)` float, the server-owned
     * opener and the three EPIC-13 CASH-003 close-result columns (DEC-031, NULL
     * while the session is `OPEN`) are asserted against real database state
     * rather than the HTTP projection alone.
     */
    const rawStoredSession = (
      id: string
    ): Promise<
      {
        tenant_id: string;
        register_id: string;
        status: string;
        opening_amount: string;
        opened_by_membership_id: string;
        expected_amount: string | null;
        counted_amount: string | null;
        difference_amount: string | null;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "tenant_id"::text AS tenant_id, "register_id"::text AS register_id,
          "status"::text AS status, "opening_amount"::text AS opening_amount,
          "opened_by_membership_id"::text AS opened_by_membership_id,
          "expected_amount"::text AS expected_amount,
          "counted_amount"::text AS counted_amount,
          "difference_amount"::text AS difference_amount
        FROM "cash_session" WHERE "id" = ${id}::uuid
      `;

    beforeAll(async () => {
      // The `cash` grant is explicit: plan mappings never grant access, so both
      // live tenants must hold a direct tenant_entitlement row (DEC-026). `cash`
      // is its own seeded feature code (PRD §10), not the `sales` capability.
      const cashFeature = await prisma.featureCode.upsert({
        where: { code: "cash" },
        create: { code: "cash" },
        update: {},
      });
      for (const tenantId of [tenantAId, tenantBId]) {
        await prisma.tenantEntitlement.upsert({
          where: { tenantId_featureCodeId: { tenantId, featureCodeId: cashFeature.id } },
          create: { tenantId, featureCodeId: cashFeature.id },
          update: {},
        });
      }

      // The opener of a session is the CALLER'S own ACTIVE membership, so the
      // block resolves the two live owners' membership ids exactly the way the
      // guard does: server-side, from the request context, never the body.
      const ownerA = await prisma.userProfile.findUnique({
        where: { email: "owner-a@live.test" },
      });
      const ownerB = await prisma.userProfile.findUnique({
        where: { email: "owner-b@live.test" },
      });
      if (!ownerA || !ownerB) {
        throw new Error("The live owner profiles are missing");
      }
      const memberships = await prisma.tenantMembership.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { tenantId: tenantAId, userProfileId: ownerA.id },
            { tenantId: tenantBId, userProfileId: ownerB.id },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const membershipFor = (tenantId: string): string => {
        const row = memberships.find((membership) => membership.tenantId === tenantId);
        if (!row) {
          throw new Error(`No ACTIVE membership resolved for tenant ${tenantId}`);
        }
        return row.id;
      };
      membershipAId = membershipFor(tenantAId);
      membershipBId = membershipFor(tenantBId);

      // The probe-only fixture register: no case opens a session on it, so a
      // surviving session row could only come from a raw probe that failed to
      // roll back (asserted by the zero-residue case).
      const registerA = await createRegister(
        ownerACookie,
        { name: "Live Cash Probe Drawer A" },
        "live-pg-cash-fixture-register-a"
      ).expect(201);
      cashRegisterAId = (registerA.body as CashRegisterDto).id;

      // Tenant B owns a REAL register and a REAL open session: the cross-tenant
      // probes below need foreign rows to leave intact.
      const registerB = await createRegister(
        ownerBCookie,
        { name: "Live Cash Foreign Drawer B" },
        "live-pg-cash-fixture-register-b"
      ).expect(201);
      cashRegisterBId = (registerB.body as CashRegisterDto).id;
      const foreignSession = await openSession(
        ownerBCookie,
        cashRegisterBId,
        "42.50",
        "live-pg-cash-fixture-session-b"
      ).expect(201);
      cashForeignSessionBId = (foreignSession.body as CashSessionDto).id;
    }, 60_000);

    it("creates a register over real HTTP with its allowlisted projection and exactly one cash.register.created audit row", async () => {
      const registersBefore = await prisma.cashRegister.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-cash-register-create";

      const created = await createRegister(
        ownerACookie,
        { name: "  Live Cash Drawer A  " },
        requestId
      ).expect(201);
      const body = created.body as CashRegisterDto;
      // The allowlisted projection: no Prisma model and no server-owned tenant
      // key crosses the boundary, and the name is TRIMMED before it is stored.
      expect(Object.keys(body).sort()).toEqual(CASH_REGISTER_DTO_KEYS);
      expect(body.name).toBe("Live Cash Drawer A");
      expect(body.isActive).toBe(true);
      expect(Object.keys(body)).not.toContain("tenantId");

      const stored = await prisma.cashRegister.findUnique({ where: { id: body.id } });
      expect(stored).toMatchObject({
        tenantId: tenantAId,
        name: "Live Cash Drawer A",
        isActive: true,
      });

      // Exactly ONE co-committed audit row carrying ids and field NAMES only.
      const audits = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "cash.register.created",
        targetType: "cash_register",
        targetId: body.id,
        tenantId: tenantAId,
      });
      const metadata = audits[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual(["name"]);
      const serializedMetadata = JSON.stringify(metadata);
      expect(serializedMetadata).not.toContain(body.id);
      expect(serializedMetadata).not.toContain("Live Cash Drawer A");
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.cashRegister.count({ where: { tenantId: tenantAId } })).toBe(
        registersBefore + 1
      );

      // The validation sweep: every rejected body is a stable 400 that persists
      // nothing and appends no audit row.
      const rejected: { label: string; requestId: string; body: Record<string, unknown> }[] = [
        {
          label: "empty name",
          requestId: "live-pg-cash-register-empty",
          body: { name: "" },
        },
        {
          label: "whitespace-only name",
          requestId: "live-pg-cash-register-whitespace",
          body: { name: "   " },
        },
        {
          label: "over-length name",
          requestId: "live-pg-cash-register-too-long",
          body: { name: "a".repeat(201) },
        },
        {
          label: "unknown key",
          requestId: "live-pg-cash-register-unknown-key",
          body: { name: "Live Invalid Drawer", isActive: false },
        },
        {
          label: "tenantId",
          requestId: "live-pg-cash-register-tenant-id",
          body: { name: "Live Invalid Drawer", tenantId: tenantBId },
        },
      ];
      for (const scenario of rejected) {
        const response = await createRegister(ownerACookie, scenario.body, scenario.requestId);
        expect(response.status, scenario.label).toBe(400);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe(
          "VALIDATION_FAILED"
        );
        // The rejection is value-free: the caller-supplied tenant id and the
        // rejected name never echo back.
        expect(response.text, scenario.label).not.toContain(tenantBId);
        expect(response.text, scenario.label).not.toContain("Live Invalid Drawer");
      }
      expect(await prisma.cashRegister.count({ where: { tenantId: tenantAId } })).toBe(
        registersBefore + 1
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: rejected.map((scenario) => scenario.requestId) } },
        })
      ).toBe(0);
    }, 30_000);

    it("rejects a duplicate register name through the real unique index while admitting the same name in another tenant", async () => {
      // A unique value for the whole suite: the index forbids a repeat inside
      // tenant A, so every case owns its own name.
      const name = "Live Cash Duplicate Drawer";
      const first = await createRegister(
        ownerACookie,
        { name },
        "live-pg-cash-register-dup-first"
      ).expect(201);
      const firstId = (first.body as CashRegisterDto).id;

      // The APPLIED index: UNIQUE on (tenant_id, name) and UNCONDITIONAL — a
      // partial predicate here would admit a duplicate name for an inactive
      // register, which the migration does not declare.
      const indexRows = await prisma.$queryRaw<
        {
          is_unique: boolean;
          is_primary: boolean;
          key_1: string;
          key_2: string;
          predicate: string | null;
        }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        WHERE c.relname = 'cash_register_tenant_id_name_key'
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0]).toMatchObject({
        is_unique: true,
        is_primary: false,
        key_1: "tenant_id",
        key_2: "name",
        predicate: null,
      });

      // Exactly ONE applied unique index on `cash_register` covers exactly those
      // two columns in that order, so the DETAIL `(tenant_id, name)` below can
      // only be `cash_register_tenant_id_name_key`: no other key could have
      // produced it.
      const covering = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        JOIN pg_class AS t ON t.oid = i.indrelid
        WHERE t.relname = 'cash_register' AND i.indisunique
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'tenant_id'
          AND pg_get_indexdef(i.indexrelid, 2, true) = 'name'
      `;
      expect(covering.map((row) => row.relname)).toEqual(["cash_register_tenant_id_name_key"]);

      // A rolled-back raw duplicate in the SAME tenant is rejected by that
      // index. Prisma surfaces the server's DETAIL, which names the violated key
      // columns (`(tenant_id, name)`) rather than the index, so the identity of
      // the rejecting key is the covering-index assertion above plus this exact
      // column pair — not a message-shape assumption.
      await inRolledBackTransaction(async (tx) => {
        const rejection = await captureRawRejection(() => insertRawRegister(tx, tenantAId, name));
        expect(rejection.sqlState).toBe("23505");
        expect(rejection.message).toContain("Key (tenant_id, name)=(");
        expect(rejection.message).toContain(name);
        expect(rejection.message).toContain("already exists.");
      });

      // The SAME name in ANOTHER tenant is a DIFFERENT key, so it is admitted.
      await inRolledBackTransaction(async (tx) => {
        const foreignId = await insertRawRegister(tx, tenantBId, name);
        const stored = await tx.$queryRaw<{ tenant_id: string; name: string }[]>`
          SELECT "tenant_id"::text AS tenant_id, "name" AS name
          FROM "cash_register" WHERE "id" = ${foreignId}::uuid
        `;
        expect(stored).toEqual([{ tenant_id: tenantBId, name }]);
      });

      // The HTTP path renders the stable 409 from the REAL index: the service
      // performs no pre-read, so this `P2002` can only come from PostgreSQL.
      const registersBefore = await prisma.cashRegister.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();
      const duplicateRequestId = "live-pg-cash-register-dup-http";
      const duplicate = await createRegister(ownerACookie, { name }, duplicateRequestId).expect(
        409
      );
      expect((duplicate.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((duplicate.body as { error: { message: string } }).error.message).toBe(
        CASH_REGISTER_NAME_CONFLICT_MESSAGE
      );
      // Value-free: neither the INTERNAL name nor the tenant id echoes back.
      expect(duplicate.text).not.toContain(name);
      expect(duplicate.text).not.toContain(tenantAId);

      // The rejected create persisted nothing and appended no audit row, and
      // exactly ONE register carries the name in tenant A.
      expect(await prisma.cashRegister.count({ where: { tenantId: tenantAId } })).toBe(
        registersBefore
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId: duplicateRequestId } })).toBe(0);
      expect(await prisma.cashRegister.count({ where: { tenantId: tenantAId, name } })).toBe(1);
      expect((await prisma.cashRegister.findUnique({ where: { id: firstId } }))?.name).toBe(name);
    }, 30_000);

    it("opens sessions over real HTTP at the exact Decimal(14,2) float with the caller's own membership and one cash.session.opened audit row each", async () => {
      // Dedicated registers: the one-OPEN rule is not part of this case.
      const zeroRegister = await createRegister(
        ownerACookie,
        { name: "Live Cash Zero Drawer" },
        "live-pg-cash-zero-register"
      ).expect(201);
      const floatRegister = await createRegister(
        ownerACookie,
        { name: "Live Cash Float Drawer" },
        "live-pg-cash-float-register"
      ).expect(201);
      const zeroRegisterId = (zeroRegister.body as CashRegisterDto).id;
      const floatRegisterId = (floatRegister.body as CashRegisterDto).id;

      const sessionsBefore = await prisma.cashSession.count({ where: { tenantId: tenantAId } });
      const auditsBefore = await prisma.auditLog.count();

      // `0.00` is ALLOWED: a register may open with an empty drawer, and the
      // value is the baseline the EPIC-13 expected amount will be compared
      // against.
      const zeroRequestId = "live-pg-cash-session-open-zero";
      const zero = await openSession(ownerACookie, zeroRegisterId, "0.00", zeroRequestId).expect(
        201
      );
      const zeroBody = zero.body as CashSessionDto;
      expect(Object.keys(zeroBody).sort()).toEqual(CASH_SESSION_DTO_KEYS);
      expect(Object.keys(zeroBody)).not.toContain("tenantId");
      expect(zeroBody.registerId).toBe(zeroRegisterId);
      expect(zeroBody.status).toBe("OPEN");
      expect(zeroBody.openingAmount).toBe("0.00");
      // The opener is the caller's OWN ACTIVE membership, never the body.
      expect(zeroBody.openedByMembershipId).toBe(membershipAId);
      // The three EPIC-13 CASH-003 close-result amounts are ALWAYS present on
      // the projection and are `null` while the session is `OPEN` (DEC-031): no
      // route can write them except the close command, which this session never
      // reaches in this block.
      expect(zeroBody.expectedAmount).toBeNull();
      expect(zeroBody.countedAmount).toBeNull();
      expect(zeroBody.differenceAmount).toBeNull();

      const floatRequestId = "live-pg-cash-session-open-nonzero";
      const float = await openSession(
        ownerACookie,
        floatRegisterId,
        "1500.00",
        floatRequestId
      ).expect(201);
      const floatBody = float.body as CashSessionDto;
      expect(floatBody.registerId).toBe(floatRegisterId);
      expect(floatBody.status).toBe("OPEN");
      expect(floatBody.openingAmount).toBe("1500.00");
      expect(floatBody.openedByMembershipId).toBe(membershipAId);
      expect(floatBody.expectedAmount).toBeNull();
      expect(floatBody.countedAmount).toBeNull();
      expect(floatBody.differenceAmount).toBeNull();

      // The REAL stored columns at their own exact scale and tenant: the float
      // is `Decimal(14, 2)` (never a float), the status is server-owned `OPEN`,
      // the register was resolved IN-TENANT, the opener is the caller's own
      // membership in that tenant and the close-result columns are still NULL.
      expect(await rawStoredSession(zeroBody.id)).toEqual([
        {
          tenant_id: tenantAId,
          register_id: zeroRegisterId,
          status: "OPEN",
          opening_amount: "0.00",
          opened_by_membership_id: membershipAId,
          expected_amount: null,
          counted_amount: null,
          difference_amount: null,
        },
      ]);
      expect(await rawStoredSession(floatBody.id)).toEqual([
        {
          tenant_id: tenantAId,
          register_id: floatRegisterId,
          status: "OPEN",
          opening_amount: "1500.00",
          opened_by_membership_id: membershipAId,
          expected_amount: null,
          counted_amount: null,
          difference_amount: null,
        },
      ]);
      // The opener belongs to the SAME tenant the composite key requires.
      expect(membershipAId).not.toBe(membershipBId);
      expect(
        await prisma.tenantMembership.count({
          where: { id: membershipAId, tenantId: tenantAId, status: "ACTIVE" },
        })
      ).toBe(1);

      // Exactly ONE `cash.session.opened` audit row per pinned request id, and
      // exactly one for each opened session, carrying field NAMES only.
      const zeroAudits = await prisma.auditLog.findMany({ where: { requestId: zeroRequestId } });
      expect(zeroAudits).toHaveLength(1);
      expect(zeroAudits[0]).toMatchObject({
        action: "cash.session.opened",
        targetType: "cash_session",
        targetId: zeroBody.id,
        tenantId: tenantAId,
      });
      const zeroMetadata = zeroAudits[0].metadata as {
        schemaVersion: number;
        changedFields: string[];
      };
      expect(zeroMetadata.schemaVersion).toBe(1);
      expect(zeroMetadata.changedFields).toEqual(["registerId", "openingAmount"]);
      const zeroSerialized = JSON.stringify(zeroMetadata);
      expect(zeroSerialized).not.toContain(zeroBody.id);
      expect(zeroSerialized).not.toContain(zeroRegisterId);
      expect(zeroSerialized).not.toContain(membershipAId);

      const floatAudits = await prisma.auditLog.findMany({ where: { requestId: floatRequestId } });
      expect(floatAudits).toHaveLength(1);
      expect(floatAudits[0]).toMatchObject({
        action: "cash.session.opened",
        targetType: "cash_session",
        targetId: floatBody.id,
        tenantId: tenantAId,
      });
      const floatMetadata = floatAudits[0].metadata as {
        schemaVersion: number;
        changedFields: string[];
      };
      expect(floatMetadata.schemaVersion).toBe(1);
      expect(floatMetadata.changedFields).toEqual(["registerId", "openingAmount"]);
      const floatSerialized = JSON.stringify(floatMetadata);
      expect(floatSerialized).not.toContain(floatBody.id);
      expect(floatSerialized).not.toContain(floatRegisterId);
      expect(floatSerialized).not.toContain("1500.00");
      expect(floatSerialized).not.toContain(membershipAId);

      for (const sessionId of [zeroBody.id, floatBody.id]) {
        expect(
          await prisma.auditLog.count({
            where: { action: "cash.session.opened", targetId: sessionId },
          })
        ).toBe(1);
      }
      expect(await prisma.cashSession.count({ where: { tenantId: tenantAId } })).toBe(
        sessionsBefore + 2
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 2);
    }, 30_000);

    it("proves the one-OPEN-session rule with the applied partial index, a raw duplicate and an admitted CLOSED row", async () => {
      // The APPLIED partial index: UNIQUE on (tenant_id, register_id) with the
      // EXACT `WHERE status = 'OPEN'` predicate. Exact-equality normalization
      // proves the index is PARTIAL and carries no extra boolean term, and the
      // covering-index assertion proves no OTHER unique index can be the one
      // that rejects a duplicate.
      const indexRows = await prisma.$queryRaw<
        {
          is_unique: boolean;
          is_primary: boolean;
          key_1: string;
          key_2: string;
          predicate: string | null;
        }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        WHERE c.relname = 'cash_session_one_open_per_register_key'
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0].is_unique).toBe(true);
      expect(indexRows[0].is_primary).toBe(false);
      expect(indexRows[0].key_1).toBe("tenant_id");
      expect(indexRows[0].key_2).toBe("register_id");
      expect(normalizeIndexPredicate(indexRows[0].predicate ?? "")).toBe(
        CASH_ONE_OPEN_INDEX_PREDICATE
      );

      const covering = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        JOIN pg_class AS t ON t.oid = i.indrelid
        WHERE t.relname = 'cash_session' AND i.indisunique
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'tenant_id'
          AND pg_get_indexdef(i.indexrelid, 2, true) = 'register_id'
      `;
      expect(covering.map((row) => row.relname)).toEqual([
        "cash_session_one_open_per_register_key",
      ]);

      // A REAL register with a REAL committed OPEN session.
      const register = await createRegister(
        ownerACookie,
        { name: "Live Cash One-Open Drawer" },
        "live-pg-cash-one-open-register"
      ).expect(201);
      const registerId = (register.body as CashRegisterDto).id;
      const opened = await openSession(
        ownerACookie,
        registerId,
        "100.00",
        "live-pg-cash-one-open-http"
      ).expect(201);
      const openedId = (opened.body as CashSessionDto).id;

      const sessionsBefore = await prisma.cashSession.count({ where: { registerId } });
      expect(sessionsBefore).toBe(1);

      // A rolled-back raw second OPEN row for the SAME register is rejected by
      // that index. The DETAIL names the violated key columns
      // (`(tenant_id, register_id)`) and the covering-index assertion above ties
      // those columns to `cash_session_one_open_per_register_key` and to no
      // other applied unique index.
      await inRolledBackTransaction(async (tx) => {
        const rejection = await captureRawRejection(() =>
          insertRawSession(tx, tenantAId, registerId, membershipAId, "250.00")
        );
        expect(rejection.sqlState).toBe("23505");
        expect(rejection.message).toContain("Key (tenant_id, register_id)=(");
        expect(rejection.message).toContain("already exists.");
      });

      // A CLOSED row for the SAME register sits OUTSIDE the partial index and is
      // ADMITTED: any number of closed sessions coexist per register.
      await inRolledBackTransaction(async (tx) => {
        const closedId = await insertRawSession(
          tx,
          tenantAId,
          registerId,
          membershipAId,
          "0.00",
          "CLOSED"
        );
        const stored = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS status FROM "cash_session" WHERE "id" = ${closedId}::uuid
        `;
        expect(stored).toEqual([{ status: "CLOSED" }]);
      });

      // Every probe rolled back: the register still holds exactly its one OPEN
      // session and no CLOSED probe row survived.
      expect(await prisma.cashSession.count({ where: { registerId } })).toBe(1);
      expect(await prisma.cashSession.count({ where: { registerId, status: "CLOSED" } })).toBe(0);
      expect(await prisma.cashSession.findUnique({ where: { id: openedId } })).toMatchObject({
        status: "OPEN",
        registerId,
        tenantId: tenantAId,
      });
    }, 30_000);

    it("admits exactly ONE of two concurrent opens of the same register under a proven table-lock overlap", async () => {
      const register = await createRegister(
        ownerACookie,
        { name: "Live Cash Race Drawer" },
        "live-pg-cash-race-register"
      ).expect(201);
      const registerId = (register.body as CashRegisterDto).id;
      const firstRequestId = "live-pg-cash-race-open-1";
      const secondRequestId = "live-pg-cash-race-open-2";
      const sessionsBefore = await prisma.cashSession.count({ where: { registerId } });
      const auditsBefore = await prisma.auditLog.count();

      // Deterministic overlap: a dedicated transaction holds a SHARE table lock
      // on `cash_session`. SHARE conflicts with the ROW EXCLUSIVE an INSERT
      // needs, so BOTH opens park on the SAME relation lock — after their
      // read-only register and membership resolution and BEFORE either can
      // attempt the row insert. `waitForRelationLockWaiters` matches an
      // UNGRANTED relation lock on exactly that table, so an unrelated lock
      // waiter can never satisfy it: the interleaving is decided by the database
      // boundary, never by wall-clock timing, and an unproven overlap throws.
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
          await tx.$executeRawUnsafe('LOCK TABLE "cash_session" IN SHARE MODE');
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;

      const racers = [
        openSession(ownerACookie, registerId, "10.00", firstRequestId).then((response) => response),
        openSession(ownerACookie, registerId, "20.00", secondRequestId).then(
          (response) => response
        ),
      ];

      try {
        await waitForRelationLockWaiters(prisma, "cash_session", 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      // The database guarantees this outcome for EVERY interleaving: the winner
      // commits its OPEN row, the loser's concurrent insert of the same key is
      // refused by the partial unique index and translated to the stable 409.
      // The assertion never depends on WHICH request won, and there is no sleep
      // and no retry that could hide a double open.
      const admitted = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected[0].body as { error: { message: string } }).error.message).toBe(
        CASH_SESSION_ALREADY_OPEN_MESSAGE
      );
      const admittedBody = admitted[0].body as CashSessionDto;
      expect(admittedBody.status).toBe("OPEN");
      expect(admittedBody.registerId).toBe(registerId);
      expect(admittedBody.openedByMembershipId).toBe(membershipAId);
      expect(["10.00", "20.00"]).toContain(admittedBody.openingAmount);

      // Exactly ONE session row exists for this register, and exactly ONE
      // `cash.session.opened` audit row across BOTH attempts.
      expect(await prisma.cashSession.count({ where: { registerId } })).toBe(sessionsBefore + 1);
      expect(await prisma.cashSession.count({ where: { registerId, status: "OPEN" } })).toBe(1);
      const raceAudits = await prisma.auditLog.findMany({
        where: { requestId: { in: [firstRequestId, secondRequestId] } },
      });
      expect(raceAudits).toHaveLength(1);
      expect(raceAudits[0]).toMatchObject({
        action: "cash.session.opened",
        targetType: "cash_session",
        targetId: admittedBody.id,
        tenantId: tenantAId,
      });
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
    }, 60_000);

    it("proves the seven composite RESTRICT ownership keys and rejects cross-tenant register, opener and session references", async () => {
      const sessionsBefore = await prisma.cashSession.count();
      const movementsBefore = await prisma.cashMovement.count();

      // The seven APPLIED foreign keys across the three cash tables, every one
      // RESTRICT on delete AND update (`rr`).
      const fkRows = await prisma.$queryRaw<
        {
          conname: string;
          table_name: string;
          referenced_table: string;
          on_delete: string;
          on_update: string;
        }[]
      >`
        SELECT
          c.conname,
          rel.relname AS table_name,
          frel.relname AS referenced_table,
          c.confdeltype AS on_delete,
          c.confupdtype AS on_update
        FROM pg_constraint AS c
        JOIN pg_class AS rel ON rel.oid = c.conrelid
        JOIN pg_class AS frel ON frel.oid = c.confrelid
        WHERE rel.relname IN ('cash_register', 'cash_session', 'cash_movement')
          AND c.contype = 'f'
      `;
      expect(
        fkRows
          .map(
            (row) =>
              `${row.conname}:${row.table_name}->${row.referenced_table}:${row.on_delete}${row.on_update}`
          )
          .sort()
      ).toEqual(
        [
          "cash_movement_tenant_id_fkey:cash_movement->tenant:rr",
          "cash_movement_tenant_id_register_id_fkey:cash_movement->cash_register:rr",
          "cash_movement_tenant_id_session_id_fkey:cash_movement->cash_session:rr",
          "cash_register_tenant_id_fkey:cash_register->tenant:rr",
          "cash_session_tenant_id_fkey:cash_session->tenant:rr",
          "cash_session_tenant_id_opened_by_membership_id_fkey:cash_session->tenant_membership:rr",
          "cash_session_tenant_id_register_id_fkey:cash_session->cash_register:rr",
        ].sort()
      );

      // A tenant-A session whose register belongs to tenant B is rejected by the
      // composite register key...
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawSession(tx, tenantAId, cashRegisterBId, membershipAId, "10.00")
        );
        expect(message).toContain("cash_session_tenant_id_register_id_fkey");
      });

      // ...a tenant-A session whose opener is another tenant's membership is
      // rejected by the composite membership key...
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawSession(tx, tenantAId, cashRegisterAId, membershipBId, "10.00")
        );
        expect(message).toContain("cash_session_tenant_id_opened_by_membership_id_fkey");
      });

      // ...and a tenant-A movement attached to tenant B's session is rejected by
      // the composite session key, so a movement can never cross the boundary.
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawMovement(tx, tenantAId, cashRegisterAId, cashForeignSessionBId, "10.00")
        );
        expect(message).toContain("cash_movement_tenant_id_session_id_fkey");
      });

      // Every probe rolled back: no throwaway session or movement survived.
      expect(await prisma.cashSession.count()).toBe(sessionsBefore);
      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
    }, 30_000);

    it("rejects a session DELETE, a movement DELETE and a movement UPDATE at the immutability triggers and enforces the money CHECKs", async () => {
      // The three APPLIED triggers: an unconditional BEFORE DELETE row trigger on
      // each table plus the strengthening BEFORE UPDATE row trigger on the
      // movement. There is no draft state in cash, so there is no conditional
      // predicate to read — the tgtype bits are the whole contract.
      const triggers = await prisma.$queryRaw<
        { tgname: string; tgtype: number; proname: string }[]
      >`
        SELECT t.tgname, t.tgtype::int AS tgtype, p.proname
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_proc AS p ON p.oid = t.tgfoid
        WHERE c.relname IN ('cash_session', 'cash_movement') AND NOT t.tgisinternal
        ORDER BY t.tgname
      `;
      expect(triggers.map((row) => row.tgname)).toEqual([
        "cash_movement_no_delete_trigger",
        "cash_movement_no_insert_into_closed_session_trigger",
        "cash_movement_no_update_trigger",
        "cash_session_no_delete_trigger",
      ]);
      expect(triggers.map((row) => `${row.tgname}:${row.proname}`).sort()).toEqual(
        [
          "cash_movement_no_delete_trigger:cash_movement_no_delete",
          "cash_movement_no_insert_into_closed_session_trigger:cash_movement_no_insert_into_closed_session",
          "cash_movement_no_update_trigger:cash_movement_no_update",
          "cash_session_no_delete_trigger:cash_session_no_delete",
        ].sort()
      );
      const triggerByName = new Map(triggers.map((row) => [row.tgname, row]));
      for (const tgname of ["cash_session_no_delete_trigger", "cash_movement_no_delete_trigger"]) {
        const trigger = triggerByName.get(tgname);
        if (!trigger) {
          throw new Error(`The ${tgname} trigger is missing`);
        }
        expect(trigger.tgtype & 1, tgname).toBe(1); // ROW
        expect(trigger.tgtype & 2, tgname).toBe(2); // BEFORE
        expect(trigger.tgtype & 8, tgname).toBe(8); // DELETE
        expect(trigger.tgtype & 16, tgname).toBe(0); // NOT UPDATE
      }
      const insertTrigger = triggerByName.get(
        "cash_movement_no_insert_into_closed_session_trigger"
      );
      if (!insertTrigger) {
        throw new Error(
          "The cash_movement_no_insert_into_closed_session_trigger trigger is missing"
        );
      }
      expect(insertTrigger.tgtype & 1).toBe(1); // ROW
      expect(insertTrigger.tgtype & 2).toBe(2); // BEFORE
      expect(insertTrigger.tgtype & 4).toBe(4); // INSERT
      expect(insertTrigger.tgtype & 8).toBe(0); // NOT DELETE
      expect(insertTrigger.tgtype & 16).toBe(0); // NOT UPDATE

      const updateTrigger = triggerByName.get("cash_movement_no_update_trigger");
      if (!updateTrigger) {
        throw new Error("The cash_movement_no_update_trigger trigger is missing");
      }
      expect(updateTrigger.tgtype & 1).toBe(1); // ROW
      expect(updateTrigger.tgtype & 2).toBe(2); // BEFORE
      expect(updateTrigger.tgtype & 8).toBe(0); // NOT DELETE
      expect(updateTrigger.tgtype & 16).toBe(16); // UPDATE

      // The trigger FUNCTIONS carry the exact RAISE message and the
      // `restrict_violation` ERRCODE. They declare no IF predicate: a confirmed
      // cash record is always immutable.
      const functions = await prisma.$queryRaw<{ proname: string; prosrc: string }[]>`
        SELECT p.proname, p.prosrc
        FROM pg_proc AS p
        WHERE p.proname IN (
          'cash_session_no_delete', 'cash_movement_no_delete', 'cash_movement_no_update',
          'cash_movement_no_insert_into_closed_session'
        )
      `;
      const sourceByName = new Map(
        functions.map((row) => [row.proname, row.prosrc.replace(/\s+/g, " ")])
      );
      expect(sourceByName.get("cash_session_no_delete")).toContain(
        "a cash session cannot be hard-deleted; sessions are confirmed records"
      );
      expect(sourceByName.get("cash_movement_no_delete")).toContain(
        "a confirmed cash movement cannot be deleted; correct it with a compensating movement"
      );
      expect(sourceByName.get("cash_movement_no_update")).toContain(
        "a confirmed cash movement is immutable; correct it with a compensating movement"
      );
      expect(sourceByName.get("cash_movement_no_insert_into_closed_session")).toContain(
        "a cash movement cannot be inserted into a closed session"
      );
      for (const proname of [
        "cash_session_no_delete",
        "cash_movement_no_delete",
        "cash_movement_no_update",
        "cash_movement_no_insert_into_closed_session",
      ]) {
        expect(sourceByName.get(proname), proname).toContain("ERRCODE = 'restrict_violation'");
        expect(sourceByName.get(proname), proname).toContain("RAISE EXCEPTION");
      }

      // The three APPLIED table CHECKs, exactly the migration's set.
      const checkRows = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint AS c
        JOIN pg_class AS t ON t.oid = c.conrelid
        WHERE t.relname IN ('cash_register', 'cash_session', 'cash_movement')
          AND c.contype = 'c'
      `;
      expect(checkRows.map((row) => row.conname).sort()).toEqual(
        [
          // EPIC-13 CASH-002 adds the exclusive direction CHECK to the three
          // EPIC-12/EPIC-13 CASH-001 constraints already applied here.
          "cash_movement_amount_non_zero",
          "cash_movement_direction_required",
          "cash_movement_reason_required",
          "cash_register_name_length",
          "cash_session_opening_amount_non_negative",
        ].sort()
      );

      // A raw DELETE of a session raises with the EXACT trigger message.
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          tenantAId,
          cashRegisterAId,
          membershipAId,
          "10.00"
        );
        expect(
          await captureDatabaseMessage(
            () => tx.$executeRaw`DELETE FROM "cash_session" WHERE "id" = ${sessionId}::uuid`
          )
        ).toBe("a cash session cannot be hard-deleted; sessions are confirmed records");
      });

      // A raw DELETE of a movement raises too.
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          tenantAId,
          cashRegisterAId,
          membershipAId,
          "10.00"
        );
        const movementId = await insertRawMovement(
          tx,
          tenantAId,
          cashRegisterAId,
          sessionId,
          "25.00"
        );
        expect(
          await captureDatabaseMessage(
            () => tx.$executeRaw`DELETE FROM "cash_movement" WHERE "id" = ${movementId}::uuid`
          )
        ).toBe(
          "a confirmed cash movement cannot be deleted; correct it with a compensating movement"
        );
      });

      // The strengthening trigger: a raw UPDATE of a movement is refused as
      // well, so a confirmed ledger row is immutable rather than merely
      // undeletable.
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          tenantAId,
          cashRegisterAId,
          membershipAId,
          "10.00"
        );
        const movementId = await insertRawMovement(
          tx,
          tenantAId,
          cashRegisterAId,
          sessionId,
          "25.00"
        );
        expect(
          await captureDatabaseMessage(
            () =>
              tx.$executeRaw`UPDATE "cash_movement" SET "reason" = 'tamper' WHERE "id" = ${movementId}::uuid`
          )
        ).toBe("a confirmed cash movement is immutable; correct it with a compensating movement");
      });

      // A zero movement is rejected by its OWN CHECK (raw SQL cannot smuggle one
      // in): `0.000` is stored as `0.00`, which `amount <> 0` refuses.
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          tenantAId,
          cashRegisterAId,
          membershipAId,
          "10.00"
        );
        const message = await captureDatabaseMessage(() =>
          insertRawMovement(tx, tenantAId, cashRegisterAId, sessionId, "0.000")
        );
        expect(message).toContain("cash_movement_amount_non_zero");
      });

      // A negative opening float is rejected by its OWN CHECK: `0.00` stays
      // allowed (the zero-drawer case above) and only a negative value fails.
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawSession(tx, tenantAId, cashRegisterAId, membershipAId, "-0.01")
        );
        expect(message).toContain("cash_session_opening_amount_non_negative");
      });

      // Every probe rolled back and no movement was ever written.
      expect(await prisma.cashMovement.count()).toBe(0);
      expect(await prisma.cashSession.count({ where: { registerId: cashRegisterAId } })).toBe(0);
    }, 30_000);

    it("applies the EPIC-13 CASH-001 enum, close columns, reason CHECK and closed-session guard", async () => {
      const enumRows = await prisma.$queryRaw<{ label: string }[]>`
        SELECT enumlabel AS label
        FROM pg_enum
        WHERE enumtypid = 'cash_movement_type'::regtype
        ORDER BY enumsortorder
      `;
      expect(enumRows.map((row) => row.label)).toEqual([
        "SALE",
        "REFUND",
        "INCOME",
        "EXPENSE",
        "WITHDRAWAL",
        "DEPOSIT",
        "ADJUSTMENT",
      ]);

      const closeColumns = await prisma.$queryRaw<
        {
          column_name: string;
          is_nullable: string;
          numeric_precision: number;
          numeric_scale: number;
        }[]
      >`
        SELECT column_name, is_nullable, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cash_session'
          AND column_name IN ('expected_amount', 'counted_amount', 'difference_amount')
        ORDER BY column_name
      `;
      expect(
        closeColumns.map(
          (row) =>
            `${row.column_name}:${row.is_nullable}:${row.numeric_precision}:${row.numeric_scale}`
        )
      ).toEqual([
        "counted_amount:YES:14:2",
        "difference_amount:YES:14:2",
        "expected_amount:YES:14:2",
      ]);

      // EPIC-13 CASH-002 applied schema, added by
      // `20260930000002_cash_movement_commands`: the explicit `ADJUSTMENT`
      // direction enum in migration order, the nullable user-defined `direction`
      // column, and the exclusive predicate that requires it exactly for
      // `ADJUSTMENT`.
      const directionEnum = await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_enum AS e
        JOIN pg_type AS t ON t.oid = e.enumtypid
        WHERE t.typname = 'cash_movement_direction'
        ORDER BY e.enumsortorder ASC
      `;
      expect(directionEnum.map((row) => row.enumlabel)).toEqual(["INCREASE", "DECREASE"]);

      const directionColumns = await prisma.$queryRaw<
        { column_name: string; is_nullable: string; data_type: string; udt_name: string }[]
      >`
        SELECT column_name, is_nullable, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cash_movement'
          AND column_name = 'direction'
      `;
      expect(
        directionColumns.map(
          (row) => `${row.column_name}:${row.is_nullable}:${row.data_type}:${row.udt_name}`
        )
      ).toEqual(["direction:YES:USER-DEFINED:cash_movement_direction"]);

      // The APPLIED constraint predicate, normalized and compared for EXACT
      // equality: both halves of the disjunction must survive.
      const directionCheck = await prisma.$queryRaw<{ definition: string }[]>`
        SELECT pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint AS c
        JOIN pg_class AS t ON t.oid = c.conrelid
        WHERE t.relname = 'cash_movement' AND c.contype = 'c'
          AND c.conname = 'cash_movement_direction_required'
      `;
      expect(directionCheck).toHaveLength(1);
      expect(normalizeIndexPredicate(directionCheck[0].definition)).toBe(
        CASH_MOVEMENT_DIRECTION_REQUIRED_PREDICATE
      );

      await inRolledBackTransaction(async (tx) => {
        const openSessionId = await insertRawSession(
          tx,
          tenantAId,
          cashRegisterAId,
          membershipAId,
          "10.00"
        );
        await expect(
          insertRawMovement(tx, tenantAId, cashRegisterAId, openSessionId, "5.00", "SALE")
        ).resolves.toEqual(expect.any(String));
        await expect(
          insertRawMovement(tx, tenantAId, cashRegisterAId, openSessionId, "5.00", "INCOME")
        ).resolves.toEqual(expect.any(String));
      });

      for (const type of ["REFUND", "EXPENSE", "WITHDRAWAL", "DEPOSIT", "ADJUSTMENT"]) {
        // EPIC-13 CASH-002: `ADJUSTMENT` is the one kind whose direction the
        // type cannot own, so its probes supply one and the reason CHECK stays
        // the SOLE violated constraint — the exclusivity CHECK would otherwise
        // report first and mask it.
        const direction = type === "ADJUSTMENT" ? "INCREASE" : null;

        await inRolledBackTransaction(async (tx) => {
          const openSessionId = await insertRawSession(
            tx,
            tenantAId,
            cashRegisterAId,
            membershipAId,
            "10.00"
          );
          const nullReasonMessage = await captureDatabaseMessage(() =>
            insertRawMovement(
              tx,
              tenantAId,
              cashRegisterAId,
              openSessionId,
              "5.00",
              type,
              null,
              direction
            )
          );
          expect(nullReasonMessage).toContain("cash_movement_reason_required");
        });

        await inRolledBackTransaction(async (tx) => {
          const openSessionId = await insertRawSession(
            tx,
            tenantAId,
            cashRegisterAId,
            membershipAId,
            "10.00"
          );
          const blankReasonMessage = await captureDatabaseMessage(() =>
            insertRawMovement(
              tx,
              tenantAId,
              cashRegisterAId,
              openSessionId,
              "5.00",
              type,
              "   ",
              direction
            )
          );
          expect(blankReasonMessage).toContain("cash_movement_reason_required");
        });

        await inRolledBackTransaction(async (tx) => {
          const openSessionId = await insertRawSession(
            tx,
            tenantAId,
            cashRegisterAId,
            membershipAId,
            "10.00"
          );
          await expect(
            insertRawMovement(
              tx,
              tenantAId,
              cashRegisterAId,
              openSessionId,
              "5.00",
              type,
              "ok",
              direction
            )
          ).resolves.toEqual(expect.any(String));
        });
      }

      await inRolledBackTransaction(async (tx) => {
        const closedSessionId = await insertRawSession(
          tx,
          tenantAId,
          cashRegisterAId,
          membershipAId,
          "10.00",
          "CLOSED"
        );
        const closedMessage = await captureDatabaseMessage(() =>
          insertRawMovement(tx, tenantAId, cashRegisterAId, closedSessionId, "5.00", "INCOME", "ok")
        );
        expect(closedMessage).toBe("a cash movement cannot be inserted into a closed session");
      });

      expect(await prisma.cashMovement.count()).toBe(0);
      expect(await prisma.cashSession.count({ where: { registerId: cashRegisterAId } })).toBe(0);
    }, 30_000);

    it("masks another tenant's register as one byte-equivalent 404 and never exposes another tenant's session over real HTTP", async () => {
      const requestId = CASH_NOT_FOUND_REQUEST_ID;
      const auditsBefore = await prisma.auditLog.count();
      const foreignRegisterBefore = await prisma.cashRegister.findUnique({
        where: { id: cashRegisterBId },
      });
      expect(foreignRegisterBefore).not.toBeNull();
      const foreignSessionsBefore = await prisma.cashSession.count({
        where: { tenantId: tenantBId },
      });

      // The register IS addressable over HTTP — `POST /cash/sessions` resolves
      // it in-tenant BEFORE any write — so a foreign register UUID and a
      // non-existent UUID must be the SAME bytes, echoed correlation included,
      // and the stable body is the shared register message.
      const foreign = await openSession(ownerACookie, cashRegisterBId, "10.00", requestId).expect(
        404
      );
      const missing = await openSession(ownerACookie, randomUUID(), "10.00", requestId).expect(404);
      expect((foreign.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect((foreign.body as { error: { message: string } }).error.message).toBe(
        CASH_REGISTER_NOT_FOUND_MESSAGE
      );
      expect(foreign.text).toBe(missing.text);
      expect(foreign.text).not.toContain(cashRegisterBId);
      expect(foreign.text).not.toContain(tenantBId);
      expect(CASH_REGISTER_NOT_FOUND_MESSAGE).not.toBe(CASH_SESSION_NOT_FOUND_MESSAGE);

      // EPIC-12's session surface had NO session-detail route, so a session
      // UUID was not addressable over HTTP at all. EPIC-13 CASH-003 changes
      // that: `POST /cash/sessions/:id/close` NOW addresses a session BY ID, so
      // the session half of the cross-tenant guarantee is exercisable over HTTP
      // and is proven byte-equivalent in the dedicated `EPIC-13 cash session
      // close application-path isolation` block at the end of this file. The
      // tenant-scoped session list remains the read boundary that consumes
      // session rows, so the equivalent property is still proven here: another
      // tenant's session is NEVER observable, and neither is its tenant id.
      const allSessions = await supertest(serverUrl)
        .get("/cash/sessions")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .expect(200);
      const openSessions = await supertest(serverUrl)
        .get("/cash/sessions?status=OPEN")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", requestId)
        .expect(200);
      for (const list of [allSessions, openSessions]) {
        const ids = (list.body as CashSessionDto[]).map((row) => row.id);
        expect(ids).not.toContain(cashForeignSessionBId);
        expect(list.text).not.toContain(cashForeignSessionBId);
        expect(list.text).not.toContain(tenantBId);
        for (const row of list.body as CashSessionDto[]) {
          expect(Object.keys(row).sort()).toEqual(CASH_SESSION_DTO_KEYS);
          // Every tenant-A session of this block is still `OPEN` and was never
          // closed, so the three close-result amounts are present and `null`
          // (DEC-031).
          if (row.status === "OPEN") {
            expect(row.expectedAmount).toBeNull();
            expect(row.countedAmount).toBeNull();
            expect(row.differenceAmount).toBeNull();
          }
        }
      }

      // Tenant B's register and session survived every masked attempt unchanged
      // and no audit row trailed any of them (reads are never audited).
      expect(await prisma.cashRegister.findUnique({ where: { id: cashRegisterBId } })).toEqual(
        foreignRegisterBefore
      );
      expect(await prisma.cashSession.count({ where: { tenantId: tenantBId } })).toBe(
        foreignSessionsBefore
      );
      expect(
        await prisma.cashSession.findUnique({ where: { id: cashForeignSessionBId } })
      ).toMatchObject({ tenantId: tenantBId, status: "OPEN", registerId: cashRegisterBId });
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
    }, 30_000);

    it("writes no cash movement, sale, stock movement or stock balance change anywhere on the cash surface", async () => {
      const salesBefore = await prisma.sale.count();
      const saleLinesBefore = await prisma.saleLine.count();
      const stockMovementsBefore = await prisma.stockMovement.count();
      const stockBalancesBefore = await prisma.stockBalance.count();
      const tenantAStockBalancesBefore = await prisma.stockBalance.count({
        where: { tenantId: tenantAId },
      });
      const auditsBefore = await prisma.auditLog.count();

      const register = await createRegister(
        ownerACookie,
        { name: "Live Cash Inert Drawer" },
        "live-pg-cash-inert-register"
      ).expect(201);
      const registerId = (register.body as CashRegisterDto).id;
      const session = await openSession(
        ownerACookie,
        registerId,
        "123.45",
        "live-pg-cash-inert-session"
      ).expect(201);
      const sessionBody = session.body as CashSessionDto;
      expect(sessionBody.openingAmount).toBe("123.45");
      expect(sessionBody.status).toBe("OPEN");

      // The two mutations wrote ONLY their own rows and the two co-committed
      // audit rows — never a movement, a sale, a stock movement or a balance
      // change, whatever the session status (the ledger write is POS-003's).
      expect(await prisma.cashMovement.count()).toBe(0);
      expect(await prisma.cashMovement.count({ where: { tenantId: tenantAId } })).toBe(0);
      expect(await prisma.sale.count()).toBe(salesBefore);
      expect(await prisma.saleLine.count()).toBe(saleLinesBefore);
      expect(await prisma.stockMovement.count()).toBe(stockMovementsBefore);
      expect(await prisma.stockBalance.count()).toBe(stockBalancesBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 2);
      // The opening float is a stored column, never a directly mutated balance:
      // the fixture tenant's projection is byte-for-byte unchanged and no
      // register balance column exists at all.
      expect(await prisma.stockBalance.count({ where: { tenantId: tenantAId } })).toBe(
        tenantAStockBalancesBefore
      );
    }, 30_000);

    it("leaves no residue: every raw probe rolled back and the fixture counts are unchanged", async () => {
      // `cashRegisterAId` is the probe-only fixture register: no HTTP case ever
      // opens a session on it, so any surviving session row could only come from
      // a raw probe that failed to roll back.
      expect(await prisma.cashSession.count({ where: { registerId: cashRegisterAId } })).toBe(0);
      // The CLOSED probe row and the cross-tenant probe rows are gone too.
      expect(
        await prisma.cashSession.count({ where: { tenantId: tenantAId, status: "CLOSED" } })
      ).toBe(0);
      // No movement was ever written by this slice, committed or otherwise.
      expect(await prisma.cashMovement.count()).toBe(0);
      expect(await prisma.cashMovement.count({ where: { tenantId: tenantAId } })).toBe(0);
      // The foreign tenant owns exactly its one fixture register and one session.
      expect(await prisma.cashRegister.count({ where: { tenantId: tenantBId } })).toBe(1);
      expect(await prisma.cashSession.count({ where: { tenantId: tenantBId } })).toBe(1);
      expect(
        await prisma.cashSession.count({ where: { tenantId: tenantBId, status: "CLOSED" } })
      ).toBe(0);
      // The rolled-back cross-tenant duplicate-name probe left no second row:
      // the name exists exactly once, in tenant A only.
      expect(
        await prisma.cashRegister.count({ where: { name: "Live Cash Duplicate Drawer" } })
      ).toBe(1);
      expect(
        await prisma.cashRegister.count({
          where: { name: "Live Cash Duplicate Drawer", tenantId: tenantBId },
        })
      ).toBe(0);
    }, 30_000);
  });

  /**
   * EPIC-12 POS-003 live-PostgreSQL evidence (D3).
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the `20260927000003_sale_completion` migration's applied DDL —
   * what the shared in-memory boundary cannot represent:
   *   1. the atomic completion: the returned completed sale with its payments,
   *      exactly one signed negative `SALE` movement per tracking line and NONE
   *      for a non-tracking line, the projection equal to the ledger's signed
   *      sum, the RECOMPUTED and frozen DEC-021 snapshot over a deliberately
   *      perturbed stored line, the `Decimal(14,2)` payment rows and exactly one
   *      `sale.completed` audit row carrying field NAMES only;
   *   2. the CASH payment path: exactly one `SALE` cash movement against the
   *      tenant's ONLY open session, and NONE when every payment is non-CASH;
   *   3. the two CASH-session rejections over HTTP (the absence, then the
   *      ambiguity on a second register), each persisting nothing;
   *   4. the idempotent replay: `200` with the same completed sale and no second
   *      effect, the same key with a different payment set a stable `409`, and a
   *      keyless replay the `DRAFT`-only `409`;
   *   5. the concurrent double completion: exactly one `201` and one stable
   *      `409` under a PROVEN header-row-lock overlap, with exactly one set of
   *      movements, payments and audit rows across both attempts;
   *   6. the applied schema claims: the effective `stock_movement_type` and
   *      `payment_method` label sets, the `payment` amount CHECK, the two
   *      CONDITIONAL `payment` triggers over a COMPLETED/CANCELLED sale while a
   *      DRAFT sale's payment stays reconcilable, and the
   *      `(tenant_id, operation, key)` unique with its tenant-scoped key;
   *   7. the byte-equivalent cross-tenant `404`, with the foreign sale and the
   *      audit count unchanged;
   *   8. zero residue: every raw probe rolled back and the fixture counts
   *      unchanged.
   *
   * The block owns a DEDICATED tenant, because the completion resolves the
   * tenant's SINGLE open cash session (DEC-020, resolution 4 of 2026-09-29) and
   * the earlier EPIC-12 cash block deliberately leaves several `OPEN` sessions
   * in tenant A — every CASH completion there would be unconditionally
   * ambiguous. This tenant starts with NO session at all, so the CASH cases
   * evolve the `OPEN` set themselves: the absence first, then exactly one
   * session, then the second register that makes it ambiguous.
   *
   * Every assertion is deterministic: no mock, no injected Prisma error, no
   * sleep and no retry, and every raw-SQL mutation runs inside an interactive
   * transaction that is always rolled back.
   */
  describe("EPIC-12 sale completion application-path isolation", () => {
    /** Marker error that forces an interactive transaction to roll back. */
    const SALE_COMPLETION_ROLLBACK_SENTINEL = "live-pg-sale-completion-rollback";

    /** The dedicated tenant that owns every completion fixture of this block. */
    let completionTenantId: string;
    let completionCookie: string;
    /** Global SEED-owned rates the line snapshots freeze (PRD §15). */
    let exemptRateId: string;
    let iva10RateId: string;
    /** Tenant items: two stock-tracking (EXEMPT / IVA_10) and one non-tracking. */
    let trackedExemptItemId: string;
    let trackedTaxedItemId: string;
    let nonTrackingItemId: string;
    /** Probe-only item: no HTTP completion ever references it. */
    let probeItemId: string;
    /** The two registers the CASH cases evolve: one session, then two. */
    let firstRegisterId: string;
    let secondRegisterId: string;
    /** Probe-only register: no case ever opens a session on it. */
    let probeRegisterId: string;
    /** Probe-only DRAFT sale: the raw DRAFT-payment trigger probe target. */
    let probeSaleId: string;
    /** Tenant A item funding the foreign draft of the cross-tenant case. */
    let foreignItemAId: string;
    /** Tenant A's real draft that the completion tenant must never resolve. */
    let foreignSaleAId: string;

    /** One ACTIVE tenant item through the REAL catalog command. */
    const createItem = async (
      cookie: string,
      name: string,
      overrides: Record<string, unknown> = {}
    ): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/catalog")
        .set("Cookie", cookie)
        .send({ kind: "SUPPLY", name, taxRateId: exemptRateId, ...overrides })
        .expect(201);
      return (created.body as { id: string }).id;
    };

    /**
     * One signed adjustment through the REAL inventory command: the funding path
     * that gives a tracking line a projection the completion's fixed `BLOCK`
     * policy can subtract from. It runs BEFORE a case captures its counts, so
     * every delta below is the completion's own effect.
     */
    const fund = (cookie: string, catalogItemId: string, quantity: string, requestId: string) =>
      supertest(serverUrl)
        .post("/inventory/stock/adjustments")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .send({ catalogItemId, quantity, reason: "Live completion funding" });

    /** One cash register over REAL HTTP. */
    const createRegister = async (cookie: string, name: string): Promise<string> => {
      const created = await supertest(serverUrl)
        .post("/cash/registers")
        .set("Cookie", cookie)
        .send({ name })
        .expect(201);
      return (created.body as CashRegisterDto).id;
    };

    /**
     * One cash session open over REAL HTTP, with a pinned request id. The
     * opening float is a fixed `0.00`: this block asserts the CASH MOVEMENT
     * amount a completion writes, never the drawer's opening balance, so the two
     * are deliberately independent.
     */
    const openSession = (cookie: string, registerId: string, requestId: string) =>
      supertest(serverUrl)
        .post("/cash/sessions")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .send({ registerId, openingAmount: "0.00" });

    /** One sale create over REAL HTTP. */
    const postSale = (cookie: string, body: Record<string, unknown>) =>
      supertest(serverUrl).post("/sales").set("Cookie", cookie).send(body);

    /**
     * The explicit completion command over REAL HTTP, with an optional pinned
     * request id and an optional `Idempotency-Key` header (DEC-024).
     */
    const complete = (
      cookie: string,
      saleId: string,
      payments: { method: string; amount: string }[],
      options: { requestId?: string; idempotencyKey?: string } = {}
    ) => {
      let request = supertest(serverUrl).post(`/sales/${saleId}/complete`).set("Cookie", cookie);
      if (options.requestId !== undefined) {
        request = request.set("X-Request-Id", options.requestId);
      }
      if (options.idempotencyKey !== undefined) {
        request = request.set("Idempotency-Key", options.idempotencyKey);
      }
      return request.send({ payments }).then((response) => response);
    };

    /**
     * Extracts the database message from Prisma's raw-query error wrapper
     * (`Raw query failed. Code: `23001`. Message: `...``). The captured text is
     * the database's own message, so an assertion can compare it EXACTLY instead
     * of matching a substring of the wrapper.
     */
    const databaseMessage = (error: unknown): string => {
      const text = error instanceof Error ? error.message : String(error);
      const match = /Message: `([\s\S]*?)`/.exec(text);
      // PostgreSQL renders a `RAISE EXCEPTION` message with a fixed `ERROR: `
      // severity prefix; stripping it leaves the exact text the trigger raises.
      return (match ? match[1] : text).replace(/^ERROR: /, "");
    };

    /** Runs `probe` and returns the exact database message of its rejection. */
    const captureDatabaseMessage = async (probe: () => Promise<unknown>): Promise<string> => {
      try {
        await probe();
      } catch (error) {
        return databaseMessage(error);
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `probe` and returns the PostgreSQL SQLSTATE and the exact message
     * Prisma surfaced for its rejection. Prisma wraps a raw `unique_violation`
     * as `P2010` and puts the SERVER's SQLSTATE in `meta.code` (`23505`) and the
     * server's DETAIL text (which names the violated KEY COLUMNS) in
     * `meta.message` — never the index name, which is why the rejecting index is
     * identified by catalogue introspection instead of by message text.
     */
    const captureRawRejection = async (
      probe: () => Promise<unknown>
    ): Promise<{ sqlState: string | undefined; message: string }> => {
      try {
        await probe();
      } catch (error) {
        const candidate = error as { meta?: { code?: unknown; message?: unknown } };
        return {
          sqlState: typeof candidate.meta?.code === "string" ? candidate.meta.code : undefined,
          message:
            typeof candidate.meta?.message === "string"
              ? candidate.meta.message
              : databaseMessage(error),
        };
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `work` inside an interactive transaction that is ALWAYS rolled back,
     * so a probe can seed throwaway rows and attempt a mutation without
     * persisting anything. An assertion failure inside `work` propagates and
     * fails the case instead of matching the rollback sentinel.
     */
    const inRolledBackTransaction = async (
      work: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<void> => {
      await expect(
        prisma.$transaction(async (tx) => {
          await work(tx);
          throw new Error(SALE_COMPLETION_ROLLBACK_SENTINEL);
        })
      ).rejects.toThrow(SALE_COMPLETION_ROLLBACK_SENTINEL);
    };

    /** Raw sale row at the migration's exact shape; returns the id. */
    const insertRawSale = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      status: "DRAFT" | "COMPLETED" | "CANCELLED"
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "sale" ("id", "tenant_id", "currency", "status")
        VALUES (${id}::uuid, ${tenantId}::uuid, 'PYG', ${status}::sale_status)
      `;
      return id;
    };

    /** Raw payment row at the migration's exact shape; returns the id. */
    const insertRawPayment = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      saleId: string,
      method: string,
      amount: string
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "payment" ("id", "tenant_id", "sale_id", "method", "amount")
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${saleId}::uuid,
          ${method}::payment_method, ${amount}::decimal
        )
      `;
      return id;
    };

    /** Raw idempotency row at the migration's exact shape. */
    const insertRawIdempotencyRecord = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      key: string,
      fingerprint: string,
      resultSaleId: string
    ): Promise<void> => {
      await tx.$executeRaw`
        INSERT INTO "idempotency_record" (
          "tenant_id", "operation", "key", "fingerprint", "result_sale_id"
        )
        VALUES (
          ${tenantId}::uuid, 'sale.complete', ${key}, ${fingerprint}, ${resultSaleId}::uuid
        )
      `;
    };

    /** Raw `DECIMAL(10,3)` projection text, or `null` when the item has no row. */
    const rawBalanceText = async (
      tenantId: string,
      catalogItemId: string
    ): Promise<string | null> => {
      const rows = await prisma.$queryRaw<{ quantity: string }[]>`
        SELECT "quantity"::text AS quantity FROM "stock_balance"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
      `;
      return rows[0]?.quantity ?? null;
    };

    /** Raw SIGNED sum of one item's movements at the projection's exact scale. */
    const rawLedgerSum = async (tenantId: string, catalogItemId: string): Promise<string> => {
      const rows = await prisma.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(sum("quantity"), 0)::numeric(10,3)::text AS total
        FROM "stock_movement"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
      `;
      return rows[0]?.total ?? "0.000";
    };

    /** Raw `SALE` movements of one item, at the column's exact scale. */
    const saleMovements = async (
      tenantId: string,
      catalogItemId: string
    ): Promise<{ quantity: string; reason: string }[]> => {
      return prisma.$queryRaw<{ quantity: string; reason: string }[]>`
        SELECT "quantity"::text AS quantity, "reason" AS reason
        FROM "stock_movement"
        WHERE "tenant_id" = ${tenantId}::uuid AND "catalog_item_id" = ${catalogItemId}::uuid
          AND "type" = 'SALE'::stock_movement_type
        ORDER BY "created_at" ASC, "id" ASC
      `;
    };

    /**
     * The stored `sale_line` columns of one sale, at their OWN exact scales, so
     * the frozen DEC-021 snapshot is asserted against real PostgreSQL rather
     * than the HTTP projection alone.
     */
    const rawStoredLines = (
      saleId: string
    ): Promise<
      {
        catalog_item_id: string;
        rate_code: string;
        unit_price: string;
        quantity: string;
        line_total: string;
        taxable_base: string;
        tax_amount: string;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "catalog_item_id"::text AS catalog_item_id, "rate_code" AS rate_code,
          "unit_price"::text AS unit_price, "quantity"::text AS quantity,
          "line_total"::text AS line_total, "taxable_base"::text AS taxable_base,
          "tax_amount"::text AS tax_amount
        FROM "sale_line" WHERE "sale_id" = ${saleId}::uuid
        ORDER BY "catalog_item_id"::text ASC
      `;

    /**
     * The stored `payment` rows of one sale, read from PostgreSQL at the
     * column's own exact scale, so the amounts are asserted against real
     * `Decimal(14,2)` state rather than the HTTP projection alone.
     */
    const rawPayments = (
      saleId: string
    ): Promise<{ tenant_id: string; sale_id: string; method: string; amount: string }[]> =>
      prisma.$queryRaw`
        SELECT
          "tenant_id"::text AS tenant_id, "sale_id"::text AS sale_id,
          "method"::text AS method, "amount"::text AS amount
        FROM "payment"
        WHERE "sale_id" = ${saleId}::uuid
        ORDER BY "amount" ASC
      `;

    /** Every stored `cash_movement` of one tenant at the columns' exact shapes. */
    const rawCashMovements = (
      tenantId: string
    ): Promise<
      {
        tenant_id: string;
        register_id: string;
        session_id: string;
        type: string;
        amount: string;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "tenant_id"::text AS tenant_id, "register_id"::text AS register_id,
          "session_id"::text AS session_id, "type"::text AS type,
          "amount"::text AS amount
        FROM "cash_movement"
        WHERE "tenant_id" = ${tenantId}::uuid
        ORDER BY "created_at" ASC, "id" ASC
      `;

    /**
     * Every table a completion can write, counted so a rejected attempt can
     * assert that NOTHING was persisted for ANY of them. The counts are GLOBAL:
     * a row written anywhere would fail the comparison.
     */
    const readResidue = async () => ({
      stockMovements: await prisma.stockMovement.count(),
      stockBalances: await prisma.stockBalance.count(),
      cashMovements: await prisma.cashMovement.count(),
      payments: await prisma.payment.count(),
      idempotencyRecords: await prisma.idempotencyRecord.count(),
      audits: await prisma.auditLog.count(),
    });

    beforeAll(async () => {
      // The `sales` and `cash` grants are explicit (DEC-026): plan mappings
      // never grant access, so the dedicated tenant must hold both direct
      // tenant_entitlement rows before any route is reachable.
      const completionTenant = await prisma.tenant.create({
        data: { slug: "live-completion", name: "Tenant Completion" },
      });
      completionTenantId = completionTenant.id;

      const ownerRole = await prisma.role.findUnique({ where: { code: "OWNER" } });
      if (!ownerRole) {
        throw new Error("Reference seed did not create OWNER role");
      }
      const completionOwner = await prisma.userProfile.create({
        data: {
          email: "owner-completion@live.test",
          displayName: "Owner Completion",
          status: "active",
        },
      });
      await prisma.tenantMembership.create({
        data: {
          tenantId: completionTenant.id,
          userProfileId: completionOwner.id,
          roleId: ownerRole.id,
          status: "ACTIVE",
        },
      });
      const session = await app.get(SessionService).issue(completionOwner.id);
      completionCookie = `${STAFF_SESSION_COOKIE}=${session.token}`;

      for (const code of ["sales", "cash"]) {
        const feature = await prisma.featureCode.upsert({
          where: { code },
          create: { code },
          update: {},
        });
        await prisma.tenantEntitlement.upsert({
          where: {
            tenantId_featureCodeId: { tenantId: completionTenant.id, featureCodeId: feature.id },
          },
          create: { tenantId: completionTenant.id, featureCodeId: feature.id },
          update: {},
        });
      }

      // The rate rows are SEED-owned, so resolving them proves the reference
      // seed really ran against this database (PRD §15).
      const rates = await prisma.taxRate.findMany();
      const rateIdsByCode = new Map(rates.map((rate) => [rate.code, rate.id]));
      const requireRate = (code: string): string => {
        const id = rateIdsByCode.get(code);
        if (!id) {
          throw new Error(`Reference seed did not create the global ${code} tax rate`);
        }
        return id;
      };
      exemptRateId = requireRate("EXEMPT");
      iva10RateId = requireRate("IVA_10");

      // Every case owns its fixtures: the development database seeds no catalog
      // item, no register and no customer, so this block creates what it
      // references.
      trackedExemptItemId = await createItem(completionCookie, "Live Completion Exempt Item", {
        referencePriceAmount: "1000.00",
        referencePriceCurrency: "PYG",
      });
      trackedTaxedItemId = await createItem(completionCookie, "Live Completion Taxed Item", {
        taxRateId: iva10RateId,
        referencePriceAmount: "1100.00",
        referencePriceCurrency: "PYG",
      });
      nonTrackingItemId = await createItem(completionCookie, "Live Completion Non-Tracking Item", {
        tracksStock: false,
        referencePriceAmount: "500.00",
        referencePriceCurrency: "PYG",
      });
      probeItemId = await createItem(completionCookie, "Live Completion Probe Item", {
        referencePriceAmount: "100.00",
        referencePriceCurrency: "PYG",
      });
      foreignItemAId = await createItem(ownerACookie, "Live Completion Foreign Item A", {
        referencePriceAmount: "1000.00",
        referencePriceCurrency: "PYG",
      });

      // The two registers the CASH cases evolve, plus the probe-only register
      // that never carries a session.
      firstRegisterId = await createRegister(completionCookie, "Live Completion Drawer One");
      secondRegisterId = await createRegister(completionCookie, "Live Completion Drawer Two");
      probeRegisterId = await createRegister(completionCookie, "Live Completion Probe Drawer");

      // The probe-only DRAFT: the raw DRAFT-payment trigger probes target it, so
      // its `DRAFT` status and ZERO payment rows are evidence that those probes
      // rolled back.
      const probeSale = await postSale(completionCookie, {
        lines: [{ catalogItemId: probeItemId, quantity: "1.000" }],
      }).expect(201);
      probeSaleId = (probeSale.body as SaleDto).id;

      // The dedicated tenant starts with NO cash session at all: the CASH cases
      // evolve the `OPEN` set from zero, so the absence and the ambiguity are
      // both observable without touching another block's fixtures.
      expect(await prisma.cashSession.count({ where: { tenantId: completionTenantId } })).toBe(0);
    }, 60_000);

    it("completes a draft atomically: negative SALE movements, ledger-equal projection, the recomputed DEC-021 snapshot, the payments and one sale.completed audit row", async () => {
      // Funding FIRST, so every count below is captured after the funding rows
      // exist and the deltas are the completion's own effect.
      await fund(
        completionCookie,
        trackedExemptItemId,
        "10.000",
        "live-pg-completion-fund-atomic-1"
      ).expect(201);
      await fund(
        completionCookie,
        trackedTaxedItemId,
        "10.000",
        "live-pg-completion-fund-atomic-2"
      ).expect(201);

      const created = await postSale(completionCookie, {
        lines: [
          { catalogItemId: trackedExemptItemId, quantity: "2.000" },
          { catalogItemId: trackedTaxedItemId, quantity: "1.000" },
          { catalogItemId: nonTrackingItemId, quantity: "3.000" },
        ],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      expect((created.body as SaleDto).status).toBe("DRAFT");
      expect((created.body as SaleDto).total).toBe("4600.00");

      // The create path already froze these values, so the stored snapshot is
      // DELIBERATELY perturbed: the completion must RECOMPUTE it from the frozen
      // inputs (`unitPrice`, `quantity`, `rateCode`) instead of trusting the
      // stored columns, and its payment-sum gate runs against the recomputed
      // total, so a stored-only snapshot could not pass it either.
      const tampered = await prisma.$executeRaw`
        UPDATE "sale_line"
        SET "line_total" = '1.00', "taxable_base" = '1.00', "tax_amount" = '0.00'
        WHERE "sale_id" = ${saleId}::uuid
      `;
      expect(tampered).toBe(3);

      const residueBefore = await readResidue();
      const requestId = "live-pg-completion-atomic";

      const response = await complete(
        completionCookie,
        saleId,
        [
          { method: "CARD", amount: "3000.00" },
          { method: "QR", amount: "1600.00" },
        ],
        { requestId }
      );
      expect(response.status).toBe(201);
      const body = response.body as CompletedSaleDto;
      expect(Object.keys(body).sort()).toEqual(COMPLETED_SALE_DTO_KEYS);
      expect(body.tenantId).toBe(completionTenantId);
      expect(body.customerId).toBeNull();
      expect(body.currency).toBe("PYG");
      expect(body.status).toBe("COMPLETED");
      expect(body.replay).toBe(false);
      expect(body.lines).toHaveLength(3);
      for (const line of body.lines) {
        expect(Object.keys(line).sort()).toEqual(SALE_LINE_DTO_KEYS);
      }
      expect(body.total).toBe("4600.00");
      expect(body.payments).toHaveLength(2);
      for (const payment of body.payments) {
        expect(Object.keys(payment).sort()).toEqual(SALE_PAYMENT_DTO_KEYS);
      }
      expect(body.payments.map((payment) => `${payment.method}:${payment.amount}`).sort()).toEqual(
        ["CARD:3000.00", "QR:1600.00"].sort()
      );
      // No Prisma column name crosses the HTTP boundary.
      expect(response.text).not.toContain("payment_method");
      expect(response.text).not.toContain("tenant_id");
      expect(response.text).not.toContain("sale_id");

      // Exactly ONE signed NEGATIVE `SALE` movement per TRACKING line, at the
      // ledger's own scale, and NONE for the non-tracking line.
      expect(await saleMovements(completionTenantId, trackedExemptItemId)).toEqual([
        { quantity: "-2.000", reason: SALE_COMPLETION_MOVEMENT_REASON },
      ]);
      expect(await saleMovements(completionTenantId, trackedTaxedItemId)).toEqual([
        { quantity: "-1.000", reason: SALE_COMPLETION_MOVEMENT_REASON },
      ]);
      expect(await saleMovements(completionTenantId, nonTrackingItemId)).toEqual([]);
      // The movement TYPE itself is the additive enum value, read from the
      // stored column rather than inferred from the response: the funding rows
      // carry `ADJUSTMENT`, so the probe is scoped to the completion's OWN
      // movements by their fixed reason.
      const types = await prisma.$queryRaw<{ type: string }[]>`
        SELECT DISTINCT "type"::text AS type FROM "stock_movement"
        WHERE "tenant_id" = ${completionTenantId}::uuid
          AND "catalog_item_id" IN (${trackedExemptItemId}::uuid, ${trackedTaxedItemId}::uuid)
          AND "reason" = ${SALE_COMPLETION_MOVEMENT_REASON}
      `;
      expect(types).toEqual([{ type: "SALE" }]);

      // The projection equals the ledger's SIGNED sum for each tracking item
      // (10 - 2 and 10 - 1) and there is ONE row per `(tenant, item)`; the
      // non-tracking item has no projection and no ledger row at all.
      for (const [itemId, expected] of [
        [trackedExemptItemId, "8.000"],
        [trackedTaxedItemId, "9.000"],
      ] as const) {
        expect(await rawBalanceText(completionTenantId, itemId)).toBe(expected);
        expect(await rawLedgerSum(completionTenantId, itemId)).toBe(
          await rawBalanceText(completionTenantId, itemId)
        );
        expect(
          await prisma.stockBalance.count({
            where: { tenantId: completionTenantId, catalogItemId: itemId },
          })
        ).toBe(1);
      }
      expect(await rawBalanceText(completionTenantId, nonTrackingItemId)).toBeNull();
      expect(await rawLedgerSum(completionTenantId, nonTrackingItemId)).toBe("0.000");
      expect(
        await prisma.stockBalance.count({
          where: { tenantId: completionTenantId, catalogItemId: nonTrackingItemId },
        })
      ).toBe(0);

      // The RECOMPUTED and FROZEN DEC-021 snapshot over the real columns: the
      // perturbed values are GONE and every line carries
      //   lineTotal   = round(unitPrice * quantity)
      //   taxableBase = round(lineTotal / (1 + rate/100))
      //   taxAmount   = lineTotal - taxableBase
      // at the PYG minor unit (0 decimals), with `base + tax === total`.
      const storedByItem = new Map(
        (await rawStoredLines(saleId)).map((row) => [row.catalog_item_id, row])
      );
      expect(storedByItem.size).toBe(3);
      expect(storedByItem.get(trackedExemptItemId)).toEqual({
        catalog_item_id: trackedExemptItemId,
        rate_code: "EXEMPT",
        unit_price: "1000.00",
        quantity: "2.000",
        line_total: "2000.00",
        taxable_base: "2000.00",
        tax_amount: "0.00",
      });
      expect(storedByItem.get(trackedTaxedItemId)).toEqual({
        catalog_item_id: trackedTaxedItemId,
        rate_code: "IVA_10",
        unit_price: "1100.00",
        quantity: "1.000",
        line_total: "1100.00",
        taxable_base: "1000.00",
        tax_amount: "100.00",
      });
      expect(storedByItem.get(nonTrackingItemId)).toEqual({
        catalog_item_id: nonTrackingItemId,
        rate_code: "EXEMPT",
        unit_price: "500.00",
        quantity: "3.000",
        line_total: "1500.00",
        taxable_base: "1500.00",
        tax_amount: "0.00",
      });

      // The payment rows are REAL `Decimal(14,2)` rows of THIS sale, in the
      // caller's tenant.
      expect(await rawPayments(saleId)).toEqual([
        { tenant_id: completionTenantId, sale_id: saleId, method: "QR", amount: "1600.00" },
        { tenant_id: completionTenantId, sale_id: saleId, method: "CARD", amount: "3000.00" },
      ]);

      // Exactly ONE co-committed `sale.completed` audit row, carrying ids and
      // field NAMES only: no payment METHOD and no AMOUNT reaches the trail.
      const audits = await prisma.auditLog.findMany({ where: { requestId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "sale.completed",
        targetType: "sale",
        targetId: saleId,
        tenantId: completionTenantId,
      });
      const metadata = audits[0].metadata as { schemaVersion: number; changedFields: string[] };
      expect(Object.keys(metadata).sort()).toEqual(["changedFields", "schemaVersion"]);
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual(["status", "lines", "payments"]);
      const serializedMetadata = JSON.stringify(metadata);
      for (const method of ["CASH", "CARD", "BANK_TRANSFER", "QR", "CHECK", "OTHER"]) {
        expect(serializedMetadata, method).not.toContain(method);
      }
      for (const amount of ["3000.00", "1600.00", "4600.00", "2000.00", "1100.00", "1500.00"]) {
        expect(serializedMetadata, amount).not.toContain(amount);
      }
      expect(serializedMetadata).not.toContain(saleId);
      expect(serializedMetadata).not.toContain(trackedExemptItemId);

      // The command's complete durable effect above the pre-command counts: two
      // movements, two payment rows and exactly ONE audit row — and NO cash
      // movement and NO idempotency record, because every payment was non-CASH
      // and no key was supplied. Both tracking items were ALREADY funded, so
      // their projection row existed and the completion UPDATED it in place
      // rather than inserting one: the balance delta is ZERO, and the
      // read-modify-write is proven by the exact projections asserted above.
      const residueAfter = await readResidue();
      expect(residueAfter.stockMovements).toBe(residueBefore.stockMovements + 2);
      expect(residueAfter.stockBalances).toBe(residueBefore.stockBalances);
      expect(residueAfter.payments).toBe(residueBefore.payments + 2);
      expect(residueAfter.audits).toBe(residueBefore.audits + 1);
      expect(residueAfter.cashMovements).toBe(residueBefore.cashMovements);
      expect(residueAfter.idempotencyRecords).toBe(residueBefore.idempotencyRecords);
      expect(await prisma.sale.findUnique({ where: { id: saleId } })).toMatchObject({
        tenantId: completionTenantId,
        status: "COMPLETED",
        currency: "PYG",
      });
    }, 30_000);

    it("rejects a CASH completion with NO open session with the stable 409 naming the absence and persists nothing", async () => {
      // The dedicated tenant holds no session at all yet: the zero-session
      // precondition is read from the REAL table, never assumed.
      expect(await prisma.cashSession.count({ where: { tenantId: completionTenantId } })).toBe(0);

      await fund(
        completionCookie,
        trackedExemptItemId,
        "5.000",
        "live-pg-completion-fund-no-session"
      ).expect(201);
      const created = await postSale(completionCookie, {
        lines: [{ catalogItemId: trackedExemptItemId, quantity: "1.000" }],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      expect((created.body as SaleDto).total).toBe("1000.00");

      const balanceBefore = await rawBalanceText(completionTenantId, trackedExemptItemId);
      expect(balanceBefore).not.toBeNull();
      const movementsBefore = await saleMovements(completionTenantId, trackedExemptItemId);
      const residueBefore = await readResidue();
      const requestId = "live-pg-completion-no-session";

      const response = await complete(
        completionCookie,
        saleId,
        [{ method: "CASH", amount: "1000.00" }],
        { requestId }
      );
      expect(response.status).toBe(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((response.body as { error: { message: string } }).error.message).toBe(
        SALE_CASH_SESSION_REQUIRED_MESSAGE
      );
      // A DIFFERENT message from the ambiguity below: the two outcomes are
      // separable over the wire.
      expect(SALE_CASH_SESSION_REQUIRED_MESSAGE).not.toBe(SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE);

      // Zero cash movements, zero payments, zero balance change, the sale still
      // DRAFT and NOT ONE audit row.
      expect(await prisma.sale.findUnique({ where: { id: saleId } })).toMatchObject({
        status: "DRAFT",
      });
      expect(await prisma.payment.count({ where: { saleId } })).toBe(0);
      expect(await rawCashMovements(completionTenantId)).toEqual([]);
      expect(await saleMovements(completionTenantId, trackedExemptItemId)).toEqual(movementsBefore);
      expect(await rawBalanceText(completionTenantId, trackedExemptItemId)).toBe(balanceBefore);
      expect(await readResidue()).toEqual(residueBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
    }, 30_000);

    it("writes exactly one SALE cash movement against the tenant's only open session, and none for an all-non-CASH payment set", async () => {
      await fund(
        completionCookie,
        trackedExemptItemId,
        "5.000",
        "live-pg-completion-fund-cash"
      ).expect(201);

      // Exactly ONE open session, opened over REAL HTTP with a pinned request
      // id: the server-side resolution has a single drawer to attribute to.
      const opened = await openSession(
        completionCookie,
        firstRegisterId,
        "live-pg-completion-session-1"
      ).expect(201);
      const session = opened.body as CashSessionDto;
      expect(Object.keys(session).sort()).toEqual(CASH_SESSION_DTO_KEYS);
      expect(session.status).toBe("OPEN");
      expect(session.registerId).toBe(firstRegisterId);
      // The session was opened and never closed by this block, so the three
      // EPIC-13 CASH-003 close-result amounts are present and `null` (DEC-031).
      expect(session.expectedAmount).toBeNull();
      expect(session.countedAmount).toBeNull();
      expect(session.differenceAmount).toBeNull();
      const openSessions = await prisma.cashSession.findMany({
        where: { tenantId: completionTenantId, status: "OPEN" },
      });
      expect(openSessions).toHaveLength(1);
      expect(openSessions[0].id).toBe(session.id);
      expect(openSessions[0].registerId).toBe(firstRegisterId);

      const created = await postSale(completionCookie, {
        lines: [{ catalogItemId: trackedExemptItemId, quantity: "2.500" }],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      expect((created.body as SaleDto).total).toBe("2500.00");

      const response = await complete(
        completionCookie,
        saleId,
        [
          { method: "CASH", amount: "1600.00" },
          { method: "CARD", amount: "900.00" },
        ],
        { requestId: "live-pg-completion-cash" }
      );
      expect(response.status).toBe(201);
      const body = response.body as CompletedSaleDto;
      expect(body.status).toBe("COMPLETED");
      expect(body.total).toBe("2500.00");
      expect(body.payments.map((payment) => `${payment.method}:${payment.amount}`).sort()).toEqual(
        ["CASH:1600.00", "CARD:900.00"].sort()
      );

      // Exactly ONE `SALE` cash movement — for the CASH payment ONLY — and its
      // stored `session_id`/`register_id` are the tenant's ONLY open session and
      // its register, resolved server-side from the real `cash_session` row.
      expect(await rawCashMovements(completionTenantId)).toEqual([
        {
          tenant_id: completionTenantId,
          register_id: firstRegisterId,
          session_id: session.id,
          type: "SALE",
          amount: "1600.00",
        },
      ]);
      expect(
        await prisma.cashSession.count({
          where: { tenantId: completionTenantId, status: "OPEN", id: session.id },
        })
      ).toBe(1);
      // The CASH amount is the payment row's own amount, not the sale total.
      expect(await prisma.payment.count({ where: { saleId } })).toBe(2);

      // A completion whose payments are ALL non-CASH writes NO cash movement.
      // The line is non-tracking, so this case depends on no stock projection.
      const cashMovementsBefore = await prisma.cashMovement.count();
      const second = await postSale(completionCookie, {
        lines: [{ catalogItemId: nonTrackingItemId, quantity: "1.000" }],
      }).expect(201);
      const secondSaleId = (second.body as SaleDto).id;
      expect((second.body as SaleDto).total).toBe("500.00");
      const secondResponse = await complete(
        completionCookie,
        secondSaleId,
        [
          { method: "CARD", amount: "300.00" },
          { method: "QR", amount: "200.00" },
        ],
        { requestId: "live-pg-completion-non-cash" }
      );
      expect(secondResponse.status).toBe(201);
      expect((secondResponse.body as CompletedSaleDto).status).toBe("COMPLETED");
      expect((secondResponse.body as CompletedSaleDto).payments).toHaveLength(2);
      expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
      expect(await rawCashMovements(completionTenantId)).toHaveLength(1);
      // The non-tracking line wrote no stock movement either.
      expect(await saleMovements(completionTenantId, nonTrackingItemId)).toEqual([]);
    }, 30_000);

    it("rejects a CASH completion with a SECOND open session on a second register as the distinct ambiguity 409 and persists nothing", async () => {
      // A second `OPEN` session on a SECOND register: the sale carries no
      // register reference, so the tenant no longer has one drawer to attribute
      // the cash to and the completion is the AMBIGUITY `409`.
      const second = await openSession(
        completionCookie,
        secondRegisterId,
        "live-pg-completion-session-2"
      ).expect(201);
      const secondSession = second.body as CashSessionDto;
      expect(secondSession.status).toBe("OPEN");
      expect(secondSession.registerId).toBe(secondRegisterId);
      expect(secondSession.expectedAmount).toBeNull();
      expect(secondSession.countedAmount).toBeNull();
      expect(secondSession.differenceAmount).toBeNull();
      expect(
        await prisma.cashSession.count({ where: { tenantId: completionTenantId, status: "OPEN" } })
      ).toBe(2);

      await fund(
        completionCookie,
        trackedTaxedItemId,
        "4.000",
        "live-pg-completion-fund-ambiguous"
      ).expect(201);
      const created = await postSale(completionCookie, {
        lines: [{ catalogItemId: trackedTaxedItemId, quantity: "1.000" }],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      expect((created.body as SaleDto).total).toBe("1100.00");

      const balanceBefore = await rawBalanceText(completionTenantId, trackedTaxedItemId);
      expect(balanceBefore).not.toBeNull();
      const movementsBefore = await saleMovements(completionTenantId, trackedTaxedItemId);
      const residueBefore = await readResidue();
      const requestId = "live-pg-completion-ambiguous";

      const response = await complete(
        completionCookie,
        saleId,
        [{ method: "CASH", amount: "1100.00" }],
        { requestId }
      );
      expect(response.status).toBe(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((response.body as { error: { message: string } }).error.message).toBe(
        SALE_CASH_SESSIONS_AMBIGUOUS_MESSAGE
      );

      // Zero cash movements, zero payments, zero balance change, the sale still
      // DRAFT and NOT ONE audit row.
      expect(await prisma.sale.findUnique({ where: { id: saleId } })).toMatchObject({
        status: "DRAFT",
      });
      expect(await prisma.payment.count({ where: { saleId } })).toBe(0);
      expect(await rawCashMovements(completionTenantId)).toHaveLength(1);
      expect(await saleMovements(completionTenantId, trackedTaxedItemId)).toEqual(movementsBefore);
      expect(await rawBalanceText(completionTenantId, trackedTaxedItemId)).toBe(balanceBefore);
      expect(await readResidue()).toEqual(residueBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
    }, 30_000);

    it("returns the prior completed sale for an identical keyed replay, and the two stable 409s for a different payment set and a keyless replay", async () => {
      await fund(
        completionCookie,
        trackedExemptItemId,
        "3.000",
        "live-pg-completion-fund-replay"
      ).expect(201);
      const created = await postSale(completionCookie, {
        lines: [{ catalogItemId: trackedExemptItemId, quantity: "1.000" }],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      const idempotencyKey = "live-pg-completion-replay-key";
      const payments = [{ method: "CARD", amount: "1000.00" }];

      const first = await complete(completionCookie, saleId, payments, {
        requestId: "live-pg-completion-replay-first",
        idempotencyKey,
      });
      expect(first.status).toBe(201);
      const firstBody = first.body as CompletedSaleDto;
      expect(firstBody.status).toBe("COMPLETED");
      expect(firstBody.replay).toBe(false);
      expect(Object.keys(firstBody).sort()).toEqual(COMPLETED_SALE_DTO_KEYS);

      // The keyed completion stored exactly ONE record for the real replay key:
      // the tenant-scoped `(tenant_id, operation, key)` row with a 64-character
      // SHA-256 fingerprint and the sale it produced.
      const records = await prisma.idempotencyRecord.findMany({
        where: { tenantId: completionTenantId, operation: "sale.complete", key: idempotencyKey },
      });
      expect(records).toHaveLength(1);
      expect(records[0].resultSaleId).toBe(saleId);
      expect(records[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);

      const residueAfterFirst = await readResidue();

      // The SAME key with the SAME body is the stored prior result: `200` with
      // the SAME completed sale, distinguished only by the `replay` flag.
      const replay = await complete(completionCookie, saleId, payments, {
        requestId: "live-pg-completion-replay-second",
        idempotencyKey,
      });
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ ...firstBody, replay: true });
      // The replay wrote NOTHING: no second movement, payment or audit row.
      expect(await readResidue()).toEqual(residueAfterFirst);
      expect(
        await prisma.auditLog.count({ where: { action: "sale.completed", targetId: saleId } })
      ).toBe(1);

      // The SAME key with a DIFFERENT payment set (same total, DIFFERENT
      // fingerprint) is the stable conflict and persists nothing.
      const conflictRequestId = "live-pg-completion-replay-conflict";
      const conflict = await complete(
        completionCookie,
        saleId,
        [{ method: "QR", amount: "1000.00" }],
        { requestId: conflictRequestId, idempotencyKey }
      );
      expect(conflict.status).toBe(409);
      expect((conflict.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((conflict.body as { error: { message: string } }).error.message).toBe(
        SALE_IDEMPOTENCY_KEY_CONFLICT_MESSAGE
      );
      expect(await readResidue()).toEqual(residueAfterFirst);
      expect(await prisma.auditLog.count({ where: { requestId: conflictRequestId } })).toBe(0);

      // A replay WITHOUT a key is the `DRAFT`-only `409`: idempotency is the
      // caller's opt-in, never a default of the command.
      const keylessRequestId = "live-pg-completion-replay-keyless";
      const keyless = await complete(completionCookie, saleId, payments, {
        requestId: keylessRequestId,
      });
      expect(keyless.status).toBe(409);
      expect((keyless.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((keyless.body as { error: { message: string } }).error.message).toBe(
        SALE_NOT_EDITABLE_MESSAGE
      );
      expect(await readResidue()).toEqual(residueAfterFirst);
      expect(await prisma.auditLog.count({ where: { requestId: keylessRequestId } })).toBe(0);
      expect(await prisma.payment.count({ where: { saleId } })).toBe(1);
    }, 30_000);

    it("admits exactly ONE of two concurrent keyed completions of the SAME draft under a proven header-row-lock overlap", async () => {
      await fund(
        completionCookie,
        trackedExemptItemId,
        "6.000",
        "live-pg-completion-fund-race-1"
      ).expect(201);
      await fund(
        completionCookie,
        trackedTaxedItemId,
        "6.000",
        "live-pg-completion-fund-race-2"
      ).expect(201);
      const created = await postSale(completionCookie, {
        lines: [
          { catalogItemId: trackedExemptItemId, quantity: "1.000" },
          { catalogItemId: trackedTaxedItemId, quantity: "1.000" },
        ],
      }).expect(201);
      const saleId = (created.body as SaleDto).id;
      expect((created.body as SaleDto).total).toBe("2100.00");

      const firstRequestId = "live-pg-completion-race-1";
      const secondRequestId = "live-pg-completion-race-2";
      const payments = [{ method: "CARD", amount: "2100.00" }];
      const movementsBefore = {
        exempt: await saleMovements(completionTenantId, trackedExemptItemId),
        taxed: await saleMovements(completionTenantId, trackedTaxedItemId),
      };
      const residueBefore = await readResidue();

      // Deterministic overlap: a dedicated transaction holds the sale HEADER
      // row lock (`SELECT ... FOR UPDATE`), which is the exact row the command
      // locks FIRST, so BOTH completions park on that single row before either
      // can read the idempotency record, the status or an item. The FOR UPDATE
      // header lock is a ROW lock, so the barrier is the tuple-lock waiter count
      // `waitForRowLockWaiters` over the row's `(relation, page, tuple)`: a
      // waiter registers a `tuple` lock on THAT exact tuple while it blocks, so
      // an unrelated lock waiter (a relation, advisory or other-row lock) can
      // never satisfy it. The interleaving is decided by the database boundary,
      // never by wall-clock timing, and an unproven overlap throws.
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
            SELECT "id" FROM "sale"
            WHERE "tenant_id" = ${completionTenantId}::uuid AND "id" = ${saleId}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;
      // The row lock is held now, so the ctid cannot move under the racers.
      const ctid = await readRowCtid(prisma, "sale", saleId);

      const racers = [
        complete(completionCookie, saleId, payments, {
          requestId: firstRequestId,
          idempotencyKey: "live-pg-completion-race-key-1",
        }),
        complete(completionCookie, saleId, payments, {
          requestId: secondRequestId,
          idempotencyKey: "live-pg-completion-race-key-2",
        }),
      ];

      try {
        await waitForRowLockWaiters(prisma, "sale", ctid.page, ctid.tuple, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      // The database guarantees this outcome for EVERY interleaving: the winner
      // commits `COMPLETED` inside its transaction, and the loser's post-lock
      // read sees the committed status and is rejected by the `DRAFT` gate. The
      // assertions never depend on WHICH request won, and there is no sleep and
      // no retry that could hide a double completion.
      const admitted = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected[0].body as { error: { message: string } }).error.message).toBe(
        SALE_NOT_EDITABLE_MESSAGE
      );
      expect((admitted[0].body as CompletedSaleDto).status).toBe("COMPLETED");
      expect((admitted[0].body as CompletedSaleDto).replay).toBe(false);
      expect((admitted[0].body as CompletedSaleDto).payments).toHaveLength(1);

      // Exactly ONE movement per line — NEVER two sets — and each projection is
      // exactly its own ledger's signed sum.
      expect(await saleMovements(completionTenantId, trackedExemptItemId)).toEqual([
        ...movementsBefore.exempt,
        { quantity: "-1.000", reason: SALE_COMPLETION_MOVEMENT_REASON },
      ]);
      expect(await saleMovements(completionTenantId, trackedTaxedItemId)).toEqual([
        ...movementsBefore.taxed,
        { quantity: "-1.000", reason: SALE_COMPLETION_MOVEMENT_REASON },
      ]);
      for (const itemId of [trackedExemptItemId, trackedTaxedItemId]) {
        expect(await rawLedgerSum(completionTenantId, itemId)).toBe(
          await rawBalanceText(completionTenantId, itemId)
        );
      }

      // Exactly ONE set of effects across BOTH attempts: two movements, the ONE
      // submitted payment, ONE audit row and exactly ONE idempotency record (the
      // loser rolled its own back). Both items were already funded, so the
      // completion UPDATED the existing projection rows in place: the balance
      // delta is ZERO and the exact projections are asserted against the ledger
      // sum above.
      const residueAfter = await readResidue();
      expect(residueAfter.stockMovements).toBe(residueBefore.stockMovements + 2);
      expect(residueAfter.stockBalances).toBe(residueBefore.stockBalances);
      expect(residueAfter.payments).toBe(residueBefore.payments + 1);
      expect(residueAfter.audits).toBe(residueBefore.audits + 1);
      expect(residueAfter.idempotencyRecords).toBe(residueBefore.idempotencyRecords + 1);
      expect(residueAfter.cashMovements).toBe(residueBefore.cashMovements);
      expect(await prisma.payment.count({ where: { saleId } })).toBe(1);
      expect(
        await prisma.idempotencyRecord.count({
          where: {
            tenantId: completionTenantId,
            operation: "sale.complete",
            key: { in: ["live-pg-completion-race-key-1", "live-pg-completion-race-key-2"] },
          },
        })
      ).toBe(1);

      const raceAudits = await prisma.auditLog.findMany({
        where: { requestId: { in: [firstRequestId, secondRequestId] } },
      });
      expect(raceAudits).toHaveLength(1);
      expect(raceAudits[0]).toMatchObject({
        action: "sale.completed",
        targetType: "sale",
        targetId: saleId,
        tenantId: completionTenantId,
      });
      expect(await prisma.sale.findUnique({ where: { id: saleId } })).toMatchObject({
        status: "COMPLETED",
      });
    }, 60_000);

    it("proves the applied enum labels, the payment CHECK, the two CONDITIONAL payment triggers and the (tenant_id, operation, key) unique", async () => {
      const paymentsBefore = await prisma.payment.count();
      const recordsBefore = await prisma.idempotencyRecord.count();

      // The EFFECTIVE `stock_movement_type` label set: POS-003 appended `SALE`
      // ADDITIVELY after ADJUSTMENT and PURCHASE, so both keep their original
      // sort positions; the reserved TRANSFER_* and *_REVERSAL compensations
      // stay absent.
      const movementEnum = await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_enum AS e
        JOIN pg_type AS t ON t.oid = e.enumtypid
        WHERE t.typname = 'stock_movement_type'
        ORDER BY e.enumsortorder ASC
      `;
      expect(movementEnum.map((row) => row.enumlabel)).toEqual(["ADJUSTMENT", "PURCHASE", "SALE"]);

      // The APPLIED `payment_method` labels: exactly the six PRD §19 values, in
      // the migration's order.
      const methodEnum = await prisma.$queryRaw<{ enumlabel: string }[]>`
        SELECT e.enumlabel
        FROM pg_enum AS e
        JOIN pg_type AS t ON t.oid = e.enumtypid
        WHERE t.typname = 'payment_method'
        ORDER BY e.enumsortorder ASC
      `;
      expect(methodEnum.map((row) => row.enumlabel)).toEqual([
        "CASH",
        "CARD",
        "BANK_TRANSFER",
        "QR",
        "CHECK",
        "OTHER",
      ]);

      // The `payment` table carries exactly the ONE positive-amount CHECK.
      const checkRows = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT c.conname
        FROM pg_constraint AS c
        JOIN pg_class AS t ON t.oid = c.conrelid
        WHERE t.relname = 'payment' AND c.contype = 'c'
      `;
      expect(checkRows.map((row) => row.conname)).toEqual(["payment_amount_positive"]);

      // A zero and a negative amount are both rejected by that CHECK from raw
      // SQL, so the application is never the first line of defence.
      for (const amount of ["0.000", "-1.00"]) {
        await inRolledBackTransaction(async (tx) => {
          const saleId = await insertRawSale(tx, completionTenantId, "DRAFT");
          const message = await captureDatabaseMessage(() =>
            insertRawPayment(tx, completionTenantId, saleId, "CARD", amount)
          );
          expect(message, amount).toContain("payment_amount_positive");
        });
      }

      // The two APPLIED triggers: a `BEFORE DELETE ROW` and a `BEFORE UPDATE
      // ROW` trigger, each on its OWN event, and no third trigger on the table.
      const triggers = await prisma.$queryRaw<{ tgname: string; tgtype: number }[]>`
        SELECT t.tgname, t.tgtype::int AS tgtype
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        WHERE c.relname = 'payment' AND NOT t.tgisinternal
      `;
      expect(triggers.map((row) => row.tgname).sort()).toEqual(
        [
          "payment_no_delete_when_completed_or_cancelled_trigger",
          "payment_no_update_when_completed_or_cancelled_trigger",
        ].sort()
      );
      const triggerByName = new Map(triggers.map((row) => [row.tgname, row]));
      const deleteTrigger = triggerByName.get(
        "payment_no_delete_when_completed_or_cancelled_trigger"
      );
      const updateTrigger = triggerByName.get(
        "payment_no_update_when_completed_or_cancelled_trigger"
      );
      if (!deleteTrigger || !updateTrigger) {
        throw new Error("The two conditional payment triggers are missing");
      }
      expect(deleteTrigger.tgtype & 1).toBe(1); // ROW
      expect(deleteTrigger.tgtype & 2).toBe(2); // BEFORE
      expect(deleteTrigger.tgtype & 8).toBe(8); // DELETE
      expect(deleteTrigger.tgtype & 16).toBe(0); // NOT UPDATE
      expect(updateTrigger.tgtype & 1).toBe(1); // ROW
      expect(updateTrigger.tgtype & 2).toBe(2); // BEFORE
      expect(updateTrigger.tgtype & 8).toBe(0); // NOT DELETE
      expect(updateTrigger.tgtype & 16).toBe(16); // UPDATE

      // The trigger FUNCTIONS carry the CONDITIONAL predicate: each reads its
      // OWNING sale's status in the same tenant and raises `restrict_violation`
      // only for a settled sale. This is deliberately NOT the unconditional
      // shape the cash and sale tables use elsewhere.
      const functions = await prisma.$queryRaw<{ proname: string; prosrc: string }[]>`
        SELECT p.proname, p.prosrc
        FROM pg_proc AS p
        WHERE p.proname IN (
          'payment_no_delete_when_completed_or_cancelled',
          'payment_no_update_when_completed_or_cancelled'
        )
      `;
      const sourceByName = new Map(
        functions.map((row) => [row.proname, row.prosrc.replace(/\s+/g, " ")])
      );
      for (const [proname, message] of [
        [
          "payment_no_delete_when_completed_or_cancelled",
          "a payment of a completed or cancelled sale cannot be deleted",
        ],
        [
          "payment_no_update_when_completed_or_cancelled",
          "a payment of a completed or cancelled sale is immutable",
        ],
      ] as const) {
        const source = sourceByName.get(proname);
        expect(source, proname).toContain('OLD."sale_id"');
        expect(source, proname).toContain('OLD."tenant_id"');
        expect(source, proname).toContain("IN ('COMPLETED', 'CANCELLED')");
        expect(source, proname).toContain("ERRCODE = 'restrict_violation'");
        expect(source, proname).toContain(message);
      }

      // A raw DELETE and a raw UPDATE of a payment whose sale is COMPLETED or
      // CANCELLED are both refused with the EXACT trigger message, so a
      // confirmed payment is immutable rather than merely undeletable.
      for (const status of ["COMPLETED", "CANCELLED"] as const) {
        await inRolledBackTransaction(async (tx) => {
          const saleId = await insertRawSale(tx, completionTenantId, status);
          const paymentId = await insertRawPayment(tx, completionTenantId, saleId, "CARD", "10.00");
          expect(
            await captureDatabaseMessage(
              () => tx.$executeRaw`DELETE FROM "payment" WHERE "id" = ${paymentId}::uuid`
            )
          ).toBe("a payment of a completed or cancelled sale cannot be deleted");
        });

        await inRolledBackTransaction(async (tx) => {
          const saleId = await insertRawSale(tx, completionTenantId, status);
          const paymentId = await insertRawPayment(tx, completionTenantId, saleId, "CARD", "10.00");
          expect(
            await captureDatabaseMessage(
              () =>
                tx.$executeRaw`UPDATE "payment" SET "amount" = '1.00' WHERE "id" = ${paymentId}::uuid`
            )
          ).toBe("a payment of a completed or cancelled sale is immutable");
        });
      }

      // A DRAFT sale's payment stays fully RECONCILABLE: the SAME update and the
      // SAME delete both succeed on the block's probe-only draft, which is what
      // makes the trigger CONDITIONAL on the owning sale's status.
      await inRolledBackTransaction(async (tx) => {
        const paymentId = await insertRawPayment(
          tx,
          completionTenantId,
          probeSaleId,
          "CARD",
          "10.00"
        );
        expect(
          await tx.$executeRaw`UPDATE "payment" SET "amount" = '1.00' WHERE "id" = ${paymentId}::uuid`
        ).toBe(1);
        expect(await tx.$executeRaw`DELETE FROM "payment" WHERE "id" = ${paymentId}::uuid`).toBe(1);
      });

      // The APPLIED replay key: UNIQUE on (tenant_id, operation, key) and
      // UNCONDITIONAL, with a covering-index assertion proving no OTHER unique
      // index covers those three columns in that order.
      const indexRows = await prisma.$queryRaw<
        {
          is_unique: boolean;
          is_primary: boolean;
          key_1: string;
          key_2: string;
          key_3: string;
          predicate: string | null;
        }[]
      >`
        SELECT
          i.indisunique AS is_unique,
          i.indisprimary AS is_primary,
          pg_get_indexdef(i.indexrelid, 1, true) AS key_1,
          pg_get_indexdef(i.indexrelid, 2, true) AS key_2,
          pg_get_indexdef(i.indexrelid, 3, true) AS key_3,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        WHERE c.relname = 'idempotency_record_tenant_id_operation_key_key'
      `;
      expect(indexRows).toHaveLength(1);
      expect(indexRows[0]).toMatchObject({
        is_unique: true,
        is_primary: false,
        key_1: "tenant_id",
        key_2: "operation",
        key_3: "key",
        predicate: null,
      });

      const covering = await prisma.$queryRaw<{ relname: string }[]>`
        SELECT c.relname
        FROM pg_index AS i
        JOIN pg_class AS c ON c.oid = i.indexrelid
        JOIN pg_class AS t ON t.oid = i.indrelid
        WHERE t.relname = 'idempotency_record' AND i.indisunique
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'tenant_id'
          AND pg_get_indexdef(i.indexrelid, 2, true) = 'operation'
          AND pg_get_indexdef(i.indexrelid, 3, true) = 'key'
      `;
      expect(covering.map((row) => row.relname)).toEqual([
        "idempotency_record_tenant_id_operation_key_key",
      ]);

      const probeKey = "live-pg-completion-raw-probe-key";
      await inRolledBackTransaction(async (tx) => {
        const saleId = await insertRawSale(tx, completionTenantId, "COMPLETED");
        await insertRawIdempotencyRecord(tx, completionTenantId, probeKey, "a".repeat(64), saleId);
        const rejection = await captureRawRejection(() =>
          insertRawIdempotencyRecord(tx, completionTenantId, probeKey, "b".repeat(64), saleId)
        );
        expect(rejection.sqlState).toBe("23505");
        expect(rejection.message).toContain("Key (tenant_id, operation, key)=(");
        expect(rejection.message).toContain("already exists.");
      });

      // The SAME key in ANOTHER tenant is a DIFFERENT record: the key scope is
      // the tenant, never global.
      await inRolledBackTransaction(async (tx) => {
        const tenantASale = await insertRawSale(tx, tenantAId, "COMPLETED");
        await insertRawIdempotencyRecord(tx, tenantAId, probeKey, "c".repeat(64), tenantASale);
        const stored = await tx.$queryRaw<{ tenant_id: string; key: string }[]>`
          SELECT "tenant_id"::text AS tenant_id, "key" AS key
          FROM "idempotency_record"
          WHERE "operation" = 'sale.complete' AND "key" = ${probeKey}
        `;
        expect(stored).toEqual([{ tenant_id: tenantAId, key: probeKey }]);
      });

      // Every probe rolled back: no probe payment row and no probe idempotency
      // record survived.
      expect(await prisma.payment.count()).toBe(paymentsBefore);
      expect(await prisma.idempotencyRecord.count()).toBe(recordsBefore);
    }, 30_000);

    it("masks another tenant's sale as one byte-equivalent 404 on complete, leaving the foreign draft and the audit count unchanged", async () => {
      // Tenant A owns a REAL draft the completion tenant must never resolve.
      const foreign = await postSale(ownerACookie, {
        lines: [{ catalogItemId: foreignItemAId, quantity: "1.000" }],
      }).expect(201);
      const foreignBody = foreign.body as SaleDto;
      expect(foreignBody.tenantId).toBe(tenantAId);
      expect(foreignBody.status).toBe("DRAFT");
      foreignSaleAId = foreignBody.id;

      const residueBefore = await readResidue();
      const payments = [{ method: "CARD", amount: "1000.00" }];

      const foreignResponse = await complete(completionCookie, foreignBody.id, payments, {
        requestId: COMPLETION_NOT_FOUND_REQUEST_ID,
      });
      const missingResponse = await complete(completionCookie, randomUUID(), payments, {
        requestId: COMPLETION_NOT_FOUND_REQUEST_ID,
      });

      expect(foreignResponse.status).toBe(404);
      expect(missingResponse.status).toBe(404);
      expect((foreignResponse.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect((foreignResponse.body as { error: { message: string } }).error.message).toBe(
        SALE_NOT_FOUND_MESSAGE
      );
      // Byte-equivalence: a foreign tenant UUID is indistinguishable from a
      // non-existent one, echoed correlation included.
      expect(foreignResponse.text).toBe(missingResponse.text);
      expect(foreignResponse.text).not.toContain(foreignBody.id);
      expect(foreignResponse.text).not.toContain(tenantAId);
      expect(foreignResponse.text).not.toContain(foreignItemAId);

      // The foreign draft survived with its own line set, no payment row, no
      // movement and no audit row trailing either masked attempt.
      expect(await prisma.sale.findUnique({ where: { id: foreignBody.id } })).toMatchObject({
        tenantId: tenantAId,
        status: "DRAFT",
        currency: "PYG",
      });
      expect(await prisma.saleLine.count({ where: { saleId: foreignBody.id } })).toBe(1);
      expect(await prisma.payment.count({ where: { saleId: foreignBody.id } })).toBe(0);
      expect(await saleMovements(tenantAId, foreignItemAId)).toEqual([]);
      expect(await rawBalanceText(tenantAId, foreignItemAId)).toBeNull();
      expect(await readResidue()).toEqual(residueBefore);
      expect(
        await prisma.auditLog.count({ where: { requestId: COMPLETION_NOT_FOUND_REQUEST_ID } })
      ).toBe(0);
    }, 30_000);

    it("leaves no residue: every raw probe rolled back and the fixture counts unchanged", async () => {
      // The probe-only item is never referenced by an HTTP completion, so any
      // movement or projection on it could only come from a raw probe that
      // failed to roll back.
      expect(
        await prisma.stockMovement.count({
          where: { tenantId: completionTenantId, catalogItemId: probeItemId },
        })
      ).toBe(0);
      expect(
        await prisma.stockBalance.count({
          where: { tenantId: completionTenantId, catalogItemId: probeItemId },
        })
      ).toBe(0);
      // The probe-only register never carried a session or a movement...
      expect(await prisma.cashSession.count({ where: { registerId: probeRegisterId } })).toBe(0);
      expect(await prisma.cashMovement.count({ where: { registerId: probeRegisterId } })).toBe(0);
      // ...and the probe-only draft is still an untaken draft: the raw
      // DRAFT-payment probes deleted their throwaway payment and rolled back.
      expect(await prisma.sale.findUnique({ where: { id: probeSaleId } })).toMatchObject({
        tenantId: completionTenantId,
        status: "DRAFT",
      });
      expect(await prisma.payment.count({ where: { saleId: probeSaleId } })).toBe(0);
      // A payment row is only ever written by a completion, which commits its
      // status flip in the SAME transaction, so every stored payment belongs to
      // a COMPLETED sale — the raw DRAFT-payment probe left nothing.
      const draftPayments = await prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM "payment" AS p
        JOIN "sale" AS s ON s."tenant_id" = p."tenant_id" AND s."id" = p."sale_id"
        WHERE s."status" <> 'COMPLETED'
      `;
      expect(draftPayments[0]?.count).toBe(0);
      // The raw idempotency probes rolled back, and every stored record still
      // points at the COMPLETED `sale.complete` result it produced.
      expect(
        await prisma.idempotencyRecord.count({ where: { key: "live-pg-completion-raw-probe-key" } })
      ).toBe(0);
      const inconsistentRecords = await prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM "idempotency_record" AS r
        JOIN "sale" AS s ON s."tenant_id" = r."tenant_id" AND s."id" = r."result_sale_id"
        WHERE r."operation" <> 'sale.complete' OR s."status" <> 'COMPLETED'
      `;
      expect(inconsistentRecords[0]?.count).toBe(0);
      // The fixture counts asserted when the block started are unchanged: the
      // dedicated tenant opened exactly the two fixture sessions of the CASH
      // cases and owns its three fixture registers, no more and no fewer.
      expect(await prisma.cashSession.count({ where: { tenantId: completionTenantId } })).toBe(2);
      expect(
        await prisma.cashSession.count({ where: { tenantId: completionTenantId, status: "OPEN" } })
      ).toBe(2);
      expect(await prisma.cashRegister.count({ where: { tenantId: completionTenantId } })).toBe(3);
      expect(await prisma.cashMovement.count({ where: { tenantId: completionTenantId } })).toBe(1);
      // The tenant's ledger and its projection are still in agreement for every
      // item the block ever funded, and the non-tracking item still has none.
      for (const itemId of [trackedExemptItemId, trackedTaxedItemId]) {
        expect(await rawLedgerSum(completionTenantId, itemId)).toBe(
          await rawBalanceText(completionTenantId, itemId)
        );
      }
      expect(await rawBalanceText(completionTenantId, nonTrackingItemId)).toBeNull();
      // The foreign tenant's draft of the cross-tenant case is still an untaken,
      // unpaid draft: neither masked attempt resolved or mutated it.
      expect(await prisma.sale.findUnique({ where: { id: foreignSaleAId } })).toMatchObject({
        tenantId: tenantAId,
        status: "DRAFT",
      });
      expect(await prisma.payment.count({ where: { saleId: foreignSaleAId } })).toBe(0);
      expect(await saleMovements(tenantAId, foreignItemAId)).toEqual([]);
    }, 30_000);
  });

  /**
   * EPIC-13 CASH-002 live-PostgreSQL evidence.
   *
   * Proves at the REAL boundary — the booted AppModule, the real guard chain,
   * real HTTP and the applied `20260930000002_cash_movement_commands` DDL — what
   * the shared in-memory boundary cannot represent:
   *   1. the six accepted standalone kinds each appending exactly ONE immutable
   *      `cash_movement` row and exactly ONE co-committed `cash.movement.created`
   *      audit row carrying field NAMES only, exposed through the allowlisted DTO
   *      and nothing else;
   *   2. the reason rule (DEC-032): `INCOME` may omit it, the other five kinds
   *      reject a missing and a whitespace-only reason;
   *   3. the direction rule (DEC-030): required exactly for `ADJUSTMENT` and
   *      forbidden for every other kind;
   *   4. `SALE` is not addressable through the command (POS-003 owns it);
   *   5. zero, negative and non-money amounts are rejected before any write;
   *   6. a foreign-tenant session and an unknown session are ONE byte-equivalent
   *      `404`, and a CLOSED session is the stable `409`, each persisting
   *      nothing;
   *   7. the database's own exclusivity: a raw `ADJUSTMENT` with a NULL direction
   *      and a raw `INCOME` with a direction are both refused by
   *      `cash_movement_direction_required`;
   *   8. the command is INERT with respect to Sales and stock;
   *   9. zero residue: every raw probe rolled back and the fixture counts
   *      unchanged.
   *
   * The block owns a DEDICATED tenant with the `cash` entitlement, its own owner
   * cookie, its own register and its own OPEN session, because the earlier cash
   * blocks deliberately mutate the OPEN-session sets of tenants A and B. Every
   * assertion is deterministic: no mock, no injected Prisma error, no sleep and
   * no retry, and every raw mutation that is meant to be refused runs inside its
   * OWN interactive transaction that is always rolled back.
   */
  describe("EPIC-13 cash movement command application-path isolation", () => {
    /** Marker error that forces an interactive transaction to roll back. */
    const CASH_MOVEMENT_ROLLBACK_SENTINEL = "live-pg-cash-movement-rollback";

    /**
     * The exact number of `cash_movement` rows this block COMMITS: the six
     * accepted kinds, the reasonless `INCOME`, the explicit `ADJUSTMENT`, the
     * inert kind and the idempotency `INCOME` whose retry appends nothing.
     */
    const CASH_MOVEMENT_COMMITTED_COUNT = 10;

    /**
     * Stable `409` wire message for a standalone movement against a session that
     * is not `OPEN`, mirrored as a literal so the live suite asserts the
     * byte-exact body the application emits rather than importing the production
     * constant.
     */
    const CASH_MOVEMENT_SESSION_NOT_OPEN_MESSAGE = "This cash session is not open.";

    /** The dedicated tenant that owns every movement fixture of this block. */
    let movementTenantId: string;
    let movementCookie: string;
    /** The dedicated tenant's ONE fixture register and its ONE OPEN session. */
    let movementRegisterId: string;
    let movementSessionId: string;
    /** The opener the raw CLOSED fixture stores (the tenant's ACTIVE membership). */
    let movementMembershipId: string;
    /** Probe-only register: no HTTP case ever resolves a session on it. */
    let movementProbeRegisterId: string;
    /** Register whose only session is the committed CLOSED fixture row. */
    let movementClosedRegisterId: string;
    let movementClosedSessionId: string;
    /** Tenant A's own committed OPEN session, the foreign id of the 404 case. */
    let foreignMovementSessionId: string;

    /** One movement create over REAL HTTP; the key is fresh unless pinned. */
    const createMovement = (
      cookie: string,
      body: Record<string, unknown>,
      requestId: string,
      idempotencyKey: string = randomUUID()
    ): supertest.Test =>
      supertest(serverUrl)
        .post("/cash/movements")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .set("Idempotency-Key", idempotencyKey)
        .send(body);

    /**
     * Extracts the database message from Prisma's raw-query error wrapper
     * (`Raw query failed. Code: `23514`. Message: `...``). The captured text is
     * the database's own message, so an assertion can compare it EXACTLY instead
     * of matching a substring of the wrapper.
     */
    const databaseMessage = (error: unknown): string => {
      const text = error instanceof Error ? error.message : String(error);
      const match = /Message: `([\s\S]*?)`/.exec(text);
      // PostgreSQL renders a statement error with a fixed `ERROR: ` severity
      // prefix; stripping it leaves the exact text the server raised.
      return (match ? match[1] : text).replace(/^ERROR: /, "");
    };

    /** Runs `probe` and returns the exact database message of its rejection. */
    const captureDatabaseMessage = async (probe: () => Promise<unknown>): Promise<string> => {
      try {
        await probe();
      } catch (error) {
        return databaseMessage(error);
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `work` inside an interactive transaction that is ALWAYS rolled back,
     * so a probe can seed throwaway rows and attempt a mutation without
     * persisting anything. An assertion failure inside `work` propagates and
     * fails the case instead of matching the rollback sentinel.
     */
    const inRolledBackTransaction = async (
      work: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<void> => {
      await expect(
        prisma.$transaction(async (tx) => {
          await work(tx);
          throw new Error(CASH_MOVEMENT_ROLLBACK_SENTINEL);
        })
      ).rejects.toThrow(CASH_MOVEMENT_ROLLBACK_SENTINEL);
    };

    /** Raw session insert at the migration's exact shape; returns the id. */
    const insertRawSession = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      registerId: string,
      openedByMembershipId: string,
      openingAmount: string,
      status: "OPEN" | "CLOSED" = "OPEN"
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_session" (
          "id", "tenant_id", "register_id", "status", "opened_by_membership_id", "opening_amount"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid,
          ${status}::cash_session_status, ${openedByMembershipId}::uuid,
          ${openingAmount}::decimal
        )
      `;
      return id;
    };

    /**
     * Raw movement insert at the migration's exact shape, direction included.
     * The direction is the EPIC-13 CASH-002 column and is REQUIRED for an
     * `ADJUSTMENT` and forbidden for every other kind, so the two exclusivity
     * probes below can each violate one half of the constraint.
     */
    const insertRawMovement = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      registerId: string,
      sessionId: string,
      amount: string,
      type: string,
      reason: string | null,
      direction: string | null
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_movement" (
          "id", "tenant_id", "register_id", "session_id", "type", "amount", "reason", "direction"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${sessionId}::uuid,
          ${type}::cash_movement_type, ${amount}::decimal, ${reason},
          ${direction}::cash_movement_direction
        )
      `;
      return id;
    };

    /**
     * The STORED columns of one movement row, read from PostgreSQL at their OWN
     * exact shapes, so the amount and the direction are asserted against real
     * database state rather than the HTTP projection alone.
     */
    const rawStoredMovement = (
      id: string
    ): Promise<
      {
        tenant_id: string;
        register_id: string;
        session_id: string;
        type: string;
        direction: string | null;
        amount: string;
        reason: string | null;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "tenant_id"::text AS tenant_id, "register_id"::text AS register_id,
          "session_id"::text AS session_id, "type"::text AS type,
          "direction"::text AS direction, "amount"::text AS amount, "reason" AS reason
        FROM "cash_movement" WHERE "id" = ${id}::uuid
      `;

    /** Every stored `cash_movement` row of the dedicated tenant. */
    const rawTenantMovements = (): Promise<
      {
        tenant_id: string;
        register_id: string;
        session_id: string;
        type: string;
        direction: string | null;
        amount: string;
        reason: string | null;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "tenant_id"::text AS tenant_id, "register_id"::text AS register_id,
          "session_id"::text AS session_id, "type"::text AS type,
          "direction"::text AS direction, "amount"::text AS amount, "reason" AS reason
        FROM "cash_movement"
        WHERE "tenant_id" = ${movementTenantId}::uuid
        ORDER BY "created_at" ASC, "id" ASC
      `;

    /**
     * The tables a movement create must never touch, counted GLOBALLY so a row
     * written anywhere fails the comparison.
     */
    const readInertCounts = async () => ({
      sales: await prisma.sale.count(),
      saleLines: await prisma.saleLine.count(),
      stockMovements: await prisma.stockMovement.count(),
      stockBalances: await prisma.stockBalance.count(),
      payments: await prisma.payment.count(),
      cashSessions: await prisma.cashSession.count(),
    });

    beforeAll(async () => {
      // The `cash` grant is explicit (DEC-026): plan mappings never grant
      // access, so the dedicated tenant must hold a direct tenant_entitlement
      // row before the movement route is reachable.
      const movementTenant = await prisma.tenant.create({
        data: { slug: "live-movement", name: "Tenant Movement" },
      });
      movementTenantId = movementTenant.id;

      const ownerRole = await prisma.role.findUnique({ where: { code: "OWNER" } });
      if (!ownerRole) {
        throw new Error("Reference seed did not create OWNER role");
      }
      const movementOwner = await prisma.userProfile.create({
        data: {
          email: "owner-movement@live.test",
          displayName: "Owner Movement",
          status: "active",
        },
      });
      const membership = await prisma.tenantMembership.create({
        data: {
          tenantId: movementTenant.id,
          userProfileId: movementOwner.id,
          roleId: ownerRole.id,
          status: "ACTIVE",
        },
      });
      movementMembershipId = membership.id;
      const session = await app.get(SessionService).issue(movementOwner.id);
      movementCookie = `${STAFF_SESSION_COOKIE}=${session.token}`;

      const cashFeature = await prisma.featureCode.upsert({
        where: { code: "cash" },
        create: { code: "cash" },
        update: {},
      });
      await prisma.tenantEntitlement.upsert({
        where: {
          tenantId_featureCodeId: { tenantId: movementTenant.id, featureCodeId: cashFeature.id },
        },
        create: { tenantId: movementTenant.id, featureCodeId: cashFeature.id },
        update: {},
      });

      // The block's OWN register and OPEN session, created over REAL HTTP.
      const register = await supertest(serverUrl)
        .post("/cash/registers")
        .set("Cookie", movementCookie)
        .set("X-Request-Id", "live-pg-movement-fixture-register")
        .send({ name: "Live Movement Drawer" })
        .expect(201);
      movementRegisterId = (register.body as CashRegisterDto).id;
      const opened = await supertest(serverUrl)
        .post("/cash/sessions")
        .set("Cookie", movementCookie)
        .set("X-Request-Id", "live-pg-movement-fixture-session")
        .send({ registerId: movementRegisterId, openingAmount: "0.00" })
        .expect(201);
      movementSessionId = (opened.body as CashSessionDto).id;

      // Probe-only register: the raw exclusivity probes seed their throwaway
      // session on it, so a surviving session or movement there could only come
      // from a probe that failed to roll back.
      const probeRegister = await supertest(serverUrl)
        .post("/cash/registers")
        .set("Cookie", movementCookie)
        .set("X-Request-Id", "live-pg-movement-fixture-probe-register")
        .send({ name: "Live Movement Probe Drawer" })
        .expect(201);
      movementProbeRegisterId = (probeRegister.body as CashRegisterDto).id;

      // The CLOSED-session fixture: the row is raw-inserted and COMMITTED on
      // its OWN register, where it sits outside the one-OPEN partial index. The
      // EPIC-13 CASH-003 close command now reaches `CLOSED` over HTTP, but this
      // block deliberately does NOT close one of its own sessions: the fixture
      // must stay independent of the close route (and of the close block that
      // runs last), so the command's CLOSED rejection is proven against a row
      // this block wrote itself.
      const closedRegister = await supertest(serverUrl)
        .post("/cash/registers")
        .set("Cookie", movementCookie)
        .set("X-Request-Id", "live-pg-movement-fixture-closed-register")
        .send({ name: "Live Movement Closed Drawer" })
        .expect(201);
      movementClosedRegisterId = (closedRegister.body as CashRegisterDto).id;
      movementClosedSessionId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "cash_session" (
          "id", "tenant_id", "register_id", "status", "opened_by_membership_id", "opening_amount"
        )
        VALUES (
          ${movementClosedSessionId}::uuid, ${movementTenantId}::uuid,
          ${movementClosedRegisterId}::uuid, 'CLOSED'::cash_session_status,
          ${movementMembershipId}::uuid, '0.00'::decimal
        )
      `;

      // A REAL foreign OPEN session: tenant A's own committed drawer, resolved
      // server-side only through tenant A's own request.
      const foreignRegister = await supertest(serverUrl)
        .post("/cash/registers")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", "live-pg-movement-fixture-foreign-register")
        .send({ name: "Live Movement Foreign Drawer" })
        .expect(201);
      const foreign = await supertest(serverUrl)
        .post("/cash/sessions")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", "live-pg-movement-fixture-foreign-session")
        .send({ registerId: (foreignRegister.body as CashRegisterDto).id, openingAmount: "0.00" })
        .expect(201);
      foreignMovementSessionId = (foreign.body as CashSessionDto).id;

      // The fixtures really are distinct tenants and the block starts clean.
      expect(movementTenantId).not.toBe(tenantAId);
      expect(await prisma.cashMovement.count({ where: { tenantId: movementTenantId } })).toBe(0);
    }, 60_000);

    it("creates exactly one movement and one cash.movement.created audit row for each accepted kind, through the allowlisted DTO only", async () => {
      const accepted = [
        { type: "REFUND", reason: "Live movement refund", direction: null, amount: "12.34" },
        { type: "INCOME", reason: null, direction: null, amount: "56.78" },
        { type: "EXPENSE", reason: "Live movement expense", direction: null, amount: "9.90" },
        {
          type: "WITHDRAWAL",
          reason: "Live movement withdrawal",
          direction: null,
          amount: "100.00",
        },
        { type: "DEPOSIT", reason: "Live movement deposit", direction: null, amount: "250.50" },
        {
          type: "ADJUSTMENT",
          reason: "Live movement adjustment",
          direction: "INCREASE",
          amount: "3.21",
        },
      ] as const;

      for (const scenario of accepted) {
        const requestId = `live-pg-movement-accept-${scenario.type.toLowerCase()}`;
        const movementsBefore = await prisma.cashMovement.count({
          where: { tenantId: movementTenantId },
        });
        const auditsBefore = await prisma.auditLog.count();

        const body: Record<string, unknown> = {
          sessionId: movementSessionId,
          type: scenario.type,
          amount: scenario.amount,
        };
        if (scenario.reason !== null) {
          body.reason = scenario.reason;
        }
        if (scenario.direction !== null) {
          body.direction = scenario.direction;
        }

        const response = await createMovement(movementCookie, body, requestId);
        expect(response.status, scenario.type).toBe(201);
        const created = response.body as CashMovementDto;
        // The allowlisted projection: exact key set, no `tenantId` and no Prisma
        // column name crossing the boundary.
        expect(Object.keys(created).sort(), scenario.type).toEqual(CASH_MOVEMENT_DTO_KEYS);
        expect(Object.keys(created), scenario.type).not.toContain("tenantId");
        expect(created.registerId, scenario.type).toBe(movementRegisterId);
        expect(created.sessionId, scenario.type).toBe(movementSessionId);
        expect(created.type, scenario.type).toBe(scenario.type);
        expect(created.direction, scenario.type).toBe(scenario.direction);
        expect(created.amount, scenario.type).toBe(scenario.amount);
        expect(created.reason, scenario.type).toBe(scenario.reason);
        expect(response.text, scenario.type).not.toContain("tenant_id");
        expect(response.text, scenario.type).not.toContain("register_id");

        // The REAL stored row: the dedicated tenant, the server-resolved
        // register/session pair, the kind, the explicit direction and the
        // POSITIVE exact-scale amount.
        expect(await rawStoredMovement(created.id), scenario.type).toEqual([
          {
            tenant_id: movementTenantId,
            register_id: movementRegisterId,
            session_id: movementSessionId,
            type: scenario.type,
            direction: scenario.direction,
            amount: scenario.amount,
            reason: scenario.reason,
          },
        ]);

        // Exactly ONE co-committed `cash.movement.created` audit row carrying
        // ids and field NAMES only.
        const audits = await prisma.auditLog.findMany({ where: { requestId } });
        expect(audits, scenario.type).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action: "cash.movement.created",
          targetType: "cash_movement",
          targetId: created.id,
          tenantId: movementTenantId,
        });
        const metadata = audits[0].metadata as {
          schemaVersion: number;
          changedFields: string[];
        };
        expect(Object.keys(metadata).sort(), scenario.type).toEqual([
          "changedFields",
          "schemaVersion",
        ]);
        expect(metadata.schemaVersion, scenario.type).toBe(1);
        const expectedChangedFields = ["sessionId", "type", "amount"];
        if (scenario.reason !== null) {
          expectedChangedFields.push("reason");
        }
        if (scenario.direction !== null) {
          expectedChangedFields.push("direction");
        }
        expect(metadata.changedFields, scenario.type).toEqual(expectedChangedFields);
        const serialized = JSON.stringify(metadata);
        expect(serialized, scenario.type).not.toContain(created.id);
        expect(serialized, scenario.type).not.toContain(movementSessionId);
        expect(serialized, scenario.type).not.toContain(movementRegisterId);
        expect(serialized, scenario.type).not.toContain(scenario.amount);
        if (scenario.reason !== null) {
          expect(serialized, scenario.type).not.toContain(scenario.reason);
        }
        if (scenario.direction !== null) {
          expect(serialized, scenario.type).not.toContain(scenario.direction);
        }

        // The delta is exactly the command's own effect: one movement and one
        // audit row, and exactly one movement of that kind on the session.
        expect(
          await prisma.cashMovement.count({ where: { tenantId: movementTenantId } }),
          scenario.type
        ).toBe(movementsBefore + 1);
        expect(await prisma.auditLog.count(), scenario.type).toBe(auditsBefore + 1);
        expect(
          await prisma.cashMovement.count({
            where: {
              registerId: movementRegisterId,
              sessionId: movementSessionId,
              type: scenario.type,
            },
          }),
          scenario.type
        ).toBe(1);
      }
    }, 60_000);

    it("admits INCOME with no reason while the five reason-required kinds reject a missing and a whitespace-only reason, persisting nothing", async () => {
      const movementsBefore = await prisma.cashMovement.count({
        where: { tenantId: movementTenantId },
      });
      const auditsBefore = await prisma.auditLog.count();

      // INCOME is the ONE accepted kind whose reason is optional (DEC-032).
      const incomeRequestId = "live-pg-movement-reason-income";
      const income = await createMovement(
        movementCookie,
        { sessionId: movementSessionId, type: "INCOME", amount: "7.00" },
        incomeRequestId
      );
      expect(income.status).toBe(201);
      const incomeBody = income.body as CashMovementDto;
      expect(incomeBody.reason).toBeNull();
      expect(incomeBody.direction).toBeNull();
      expect(await prisma.auditLog.count({ where: { requestId: incomeRequestId } })).toBe(1);

      const rejected: { label: string; requestId: string; body: Record<string, unknown> }[] = [];
      for (const type of ["REFUND", "EXPENSE", "WITHDRAWAL", "DEPOSIT", "ADJUSTMENT"]) {
        // ADJUSTMENT's direction is supplied so the REASON is the only rejected
        // field and the two rules stay separable.
        const direction = type === "ADJUSTMENT" ? { direction: "INCREASE" } : {};
        rejected.push({
          label: `${type} missing reason`,
          requestId: `live-pg-movement-reason-missing-${type.toLowerCase()}`,
          body: { sessionId: movementSessionId, type, amount: "5.00", ...direction },
        });
        rejected.push({
          label: `${type} whitespace-only reason`,
          requestId: `live-pg-movement-reason-blank-${type.toLowerCase()}`,
          body: { sessionId: movementSessionId, type, amount: "5.00", reason: "   ", ...direction },
        });
      }

      for (const scenario of rejected) {
        const response = await createMovement(movementCookie, scenario.body, scenario.requestId);
        expect(response.status, scenario.label).toBe(400);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe(
          "VALIDATION_FAILED"
        );
        // Value-free: neither the session nor the tenant echoes back.
        expect(response.text, scenario.label).not.toContain(movementSessionId);
        expect(response.text, scenario.label).not.toContain(movementTenantId);
      }

      // Nothing persisted by ANY rejection; exactly ONE movement and ONE audit
      // row from the admitted reasonless INCOME.
      expect(await prisma.cashMovement.count({ where: { tenantId: movementTenantId } })).toBe(
        movementsBefore + 1
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: rejected.map((scenario) => scenario.requestId) } },
        })
      ).toBe(0);
    }, 30_000);

    it("requires a direction exactly for ADJUSTMENT, forbids it on every other kind and rejects SALE, persisting nothing", async () => {
      const movementsBefore = await prisma.cashMovement.count({
        where: { tenantId: movementTenantId },
      });
      const auditsBefore = await prisma.auditLog.count();

      const rejected: { label: string; requestId: string; body: Record<string, unknown> }[] = [
        {
          label: "ADJUSTMENT without a direction",
          requestId: "live-pg-movement-direction-missing",
          body: {
            sessionId: movementSessionId,
            type: "ADJUSTMENT",
            amount: "5.00",
            reason: "Live movement adjustment",
          },
        },
        ...(["REFUND", "INCOME", "EXPENSE", "WITHDRAWAL", "DEPOSIT"] as const).map((type) => ({
          label: `${type} with a direction`,
          requestId: `live-pg-movement-direction-forbidden-${type.toLowerCase()}`,
          body: {
            sessionId: movementSessionId,
            type,
            amount: "5.00",
            reason: "Live movement with a direction",
            direction: "INCREASE",
          },
        })),
        {
          label: "SALE is not addressable through the command",
          requestId: "live-pg-movement-sale-rejected",
          body: {
            sessionId: movementSessionId,
            type: "SALE",
            amount: "5.00",
            reason: "Live movement sale",
          },
        },
      ];

      for (const scenario of rejected) {
        const response = await createMovement(movementCookie, scenario.body, scenario.requestId);
        expect(response.status, scenario.label).toBe(400);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe(
          "VALIDATION_FAILED"
        );
      }

      // The accepted control: an ADJUSTMENT WITH its explicit DECREASE direction
      // is admitted, so the rejection above is about the RULE and not about the
      // body shape.
      const acceptedRequestId = "live-pg-movement-direction-decrease";
      const accepted = await createMovement(
        movementCookie,
        {
          sessionId: movementSessionId,
          type: "ADJUSTMENT",
          amount: "5.00",
          reason: "Live movement decrease",
          direction: "DECREASE",
        },
        acceptedRequestId
      );
      expect(accepted.status).toBe(201);
      const acceptedBody = accepted.body as CashMovementDto;
      expect(acceptedBody.type).toBe("ADJUSTMENT");
      expect(acceptedBody.direction).toBe("DECREASE");

      expect(await prisma.cashMovement.count({ where: { tenantId: movementTenantId } })).toBe(
        movementsBefore + 1
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: rejected.map((scenario) => scenario.requestId) } },
        })
      ).toBe(0);
    }, 30_000);

    it("rejects zero, negative and non-money amounts before any write", async () => {
      const movementsBefore = await prisma.cashMovement.count({
        where: { tenantId: movementTenantId },
      });
      const auditsBefore = await prisma.auditLog.count();

      const rejectedAmounts = [
        { label: "zero", amount: "0", requestId: "live-pg-movement-amount-zero" },
        { label: "scaled zero", amount: "0.00", requestId: "live-pg-movement-amount-zero-scaled" },
        { label: "negative", amount: "-1.00", requestId: "live-pg-movement-amount-negative" },
        {
          label: "small negative",
          amount: "-0.01",
          requestId: "live-pg-movement-amount-negative-small",
        },
        { label: "non-numeric", amount: "abc", requestId: "live-pg-movement-amount-non-numeric" },
        { label: "scientific", amount: "1e3", requestId: "live-pg-movement-amount-scientific" },
        {
          label: "three decimals",
          amount: "1.234",
          requestId: "live-pg-movement-amount-three-decimals",
        },
        { label: "comma separator", amount: "1,00", requestId: "live-pg-movement-amount-comma" },
        { label: "empty", amount: "", requestId: "live-pg-movement-amount-empty" },
      ];

      for (const scenario of rejectedAmounts) {
        const response = await createMovement(
          movementCookie,
          { sessionId: movementSessionId, type: "INCOME", amount: scenario.amount },
          scenario.requestId
        );
        expect(response.status, scenario.label).toBe(400);
        expect((response.body as ErrorEnvelope).error.code, scenario.label).toBe(
          "VALIDATION_FAILED"
        );
        expect(
          await prisma.auditLog.count({ where: { requestId: scenario.requestId } }),
          scenario.label
        ).toBe(0);
      }

      // No rejected amount wrote a movement or an audit row.
      expect(await prisma.cashMovement.count({ where: { tenantId: movementTenantId } })).toBe(
        movementsBefore
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
    }, 30_000);

    it("masks a foreign-tenant session and an unknown session as one byte-equivalent 404, persisting nothing", async () => {
      const movementsBefore = await prisma.cashMovement.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-movement-not-found-proof";

      const foreign = await createMovement(
        movementCookie,
        { sessionId: foreignMovementSessionId, type: "INCOME", amount: "5.00" },
        requestId
      );
      const missing = await createMovement(
        movementCookie,
        { sessionId: randomUUID(), type: "INCOME", amount: "5.00" },
        requestId
      );

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect((foreign.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect((foreign.body as { error: { message: string } }).error.message).toBe(
        CASH_SESSION_NOT_FOUND_MESSAGE
      );
      // Byte-equivalence: a session owned by another tenant is indistinguishable
      // from a non-existent one, echoed correlation included.
      expect(foreign.text).toBe(missing.text);
      expect(foreign.text).not.toContain(foreignMovementSessionId);
      expect(foreign.text).not.toContain(tenantAId);

      // Neither masked attempt persisted a movement or an audit row, and the
      // foreign session survived unchanged.
      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(
        await prisma.cashSession.findUnique({ where: { id: foreignMovementSessionId } })
      ).toMatchObject({ tenantId: tenantAId, status: "OPEN" });
      expect(
        await prisma.cashMovement.count({ where: { sessionId: foreignMovementSessionId } })
      ).toBe(0);
    }, 30_000);

    it("rejects a movement into a CLOSED session with the stable 409, persisting nothing", async () => {
      // The fixture is a REAL committed CLOSED row of this tenant: no HTTP case
      // in this block closes a session, so it was raw-inserted once in
      // `beforeAll` and remains independent of the CASH-003 close route.
      expect(
        await prisma.cashSession.findUnique({ where: { id: movementClosedSessionId } })
      ).toMatchObject({ tenantId: movementTenantId, status: "CLOSED" });

      const movementsBefore = await prisma.cashMovement.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-movement-closed-session";

      const response = await createMovement(
        movementCookie,
        { sessionId: movementClosedSessionId, type: "INCOME", amount: "5.00" },
        requestId
      );
      expect(response.status).toBe(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((response.body as { error: { message: string } }).error.message).toBe(
        CASH_MOVEMENT_SESSION_NOT_OPEN_MESSAGE
      );
      // Value-free: neither the session nor the tenant id echoes back.
      expect(response.text).not.toContain(movementClosedSessionId);
      expect(response.text).not.toContain(movementTenantId);

      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(
        await prisma.cashMovement.count({ where: { sessionId: movementClosedSessionId } })
      ).toBe(0);
      expect(
        await prisma.cashSession.findUnique({ where: { id: movementClosedSessionId } })
      ).toMatchObject({ status: "CLOSED" });
    }, 30_000);

    it("refuses the two illegal direction combinations directly at cash_movement_direction_required with rolled-back raw inserts", async () => {
      const movementsBefore = await prisma.cashMovement.count();
      const sessionsBefore = await prisma.cashSession.count();

      // An ADJUSTMENT with a NULL direction violates the first half of the
      // exclusive CHECK...
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          movementTenantId,
          movementProbeRegisterId,
          movementMembershipId,
          "10.00"
        );
        const message = await captureDatabaseMessage(() =>
          insertRawMovement(
            tx,
            movementTenantId,
            movementProbeRegisterId,
            sessionId,
            "5.00",
            "ADJUSTMENT",
            "ok",
            null
          )
        );
        expect(message).toContain("cash_movement_direction_required");
      });

      // ...and an INCOME WITH a direction violates the second half. A rejected
      // statement aborts its transaction, so each rejection owns its own.
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          movementTenantId,
          movementProbeRegisterId,
          movementMembershipId,
          "10.00"
        );
        const message = await captureDatabaseMessage(() =>
          insertRawMovement(
            tx,
            movementTenantId,
            movementProbeRegisterId,
            sessionId,
            "5.00",
            "INCOME",
            null,
            "INCREASE"
          )
        );
        expect(message).toContain("cash_movement_direction_required");
      });

      // The two legal combinations are admitted, so the constraint rejects the
      // illegal pairs and nothing else.
      await inRolledBackTransaction(async (tx) => {
        const sessionId = await insertRawSession(
          tx,
          movementTenantId,
          movementProbeRegisterId,
          movementMembershipId,
          "10.00"
        );
        await expect(
          insertRawMovement(
            tx,
            movementTenantId,
            movementProbeRegisterId,
            sessionId,
            "5.00",
            "ADJUSTMENT",
            "ok",
            "INCREASE"
          )
        ).resolves.toEqual(expect.any(String));
        await expect(
          insertRawMovement(
            tx,
            movementTenantId,
            movementProbeRegisterId,
            sessionId,
            "5.00",
            "INCOME",
            null,
            null
          )
        ).resolves.toEqual(expect.any(String));
      });

      // Every probe rolled back: the probe register carries no session and no
      // movement, and no throwaway row survived anywhere.
      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.cashSession.count()).toBe(sessionsBefore);
      expect(
        await prisma.cashSession.count({ where: { registerId: movementProbeRegisterId } })
      ).toBe(0);
      expect(
        await prisma.cashMovement.count({ where: { registerId: movementProbeRegisterId } })
      ).toBe(0);
    }, 30_000);

    it("replays an identical retry with the same Idempotency-Key and appends nothing", async () => {
      const movementsBefore = await prisma.cashMovement.count();
      const auditsBefore = await prisma.auditLog.count();
      const key = randomUUID();
      const requestId = "live-pg-cash-movement-idempotency";
      const body = { sessionId: movementSessionId, type: "INCOME", amount: "77.00" };

      // The deterministic id makes the PRIMARY KEY the guarantee: the retry
      // replays the stored movement and appends no second row or audit row.
      const first = await createMovement(movementCookie, body, requestId, key).expect(201);
      const replay = await createMovement(movementCookie, body, requestId, key).expect(200);
      expect(replay.body).toEqual(first.body);
      expect(await prisma.cashMovement.count()).toBe(movementsBefore + 1);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
    }, 30_000);

    it("stays inert: a movement writes no sale, sale line, stock movement or stock balance row", async () => {
      const inertBefore = await readInertCounts();
      const movementsBefore = await prisma.cashMovement.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-movement-inert";

      const response = await createMovement(
        movementCookie,
        {
          sessionId: movementSessionId,
          type: "DEPOSIT",
          amount: "44.44",
          reason: "Live movement inert",
        },
        requestId
      );
      expect(response.status).toBe(201);
      const created = response.body as CashMovementDto;
      expect(created.type).toBe("DEPOSIT");
      expect(created.direction).toBeNull();

      // The command's WHOLE durable effect is one movement and one audit row:
      // nothing on the Sales, stock or payment tables moved.
      expect(await readInertCounts()).toEqual(inertBefore);
      expect(await prisma.cashMovement.count()).toBe(movementsBefore + 1);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(1);
    }, 30_000);

    it("reads the movements this block committed, newest-first, narrowed by sessionId and never across tenants", async () => {
      const movementsBefore = await prisma.cashMovement.count({
        where: { tenantId: movementTenantId },
      });
      const auditsBefore = await prisma.auditLog.count();
      // The block committed its whole ledger by this point; a read adds nothing.
      expect(movementsBefore).toBe(CASH_MOVEMENT_COMMITTED_COUNT);

      const listMovements = (cookie: string, query = ""): supertest.Test =>
        supertest(serverUrl)
          .get(`/cash/movements${query}`)
          .set("Cookie", cookie)
          .set("X-Request-Id", "live-pg-movement-read");

      // The tenant's OWN committed ledger over REAL HTTP, through the
      // allowlisted DTO only: ONE movement shape, and never a `tenantId`.
      const listed = await listMovements(movementCookie).expect(200);
      const movements = listed.body as CashMovementDto[];
      expect(movements).toHaveLength(CASH_MOVEMENT_COMMITTED_COUNT);
      for (const movement of movements) {
        expect(Object.keys(movement).sort()).toEqual(CASH_MOVEMENT_DTO_KEYS);
        expect(Object.keys(movement)).not.toContain("tenantId");
        expect(movement.registerId).toBe(movementRegisterId);
        expect(movement.sessionId).toBe(movementSessionId);
      }
      expect(listed.text).not.toContain("tenant_id");

      // Newest first by `createdAt` with `id` ascending as the tiebreaker,
      // matching the register and session list convention.
      for (let index = 1; index < movements.length; index += 1) {
        const previous = movements[index - 1];
        const current = movements[index];
        const byCreatedAt = previous.createdAt.localeCompare(current.createdAt);
        expect(
          byCreatedAt > 0 || (byCreatedAt === 0 && previous.id.localeCompare(current.id) <= 0),
          `${previous.id} before ${current.id}`
        ).toBe(true);
      }

      // The optional `sessionId` filter narrows to that session: every committed
      // row lives on the fixture session, so the narrowed list is the same set.
      const narrowed = await listMovements(
        movementCookie,
        `?sessionId=${movementSessionId}`
      ).expect(200);
      expect((narrowed.body as CashMovementDto[]).map((movement) => movement.id)).toEqual(
        movements.map((movement) => movement.id)
      );

      // ... and a FOREIGN session id narrows to NOTHING rather than widening
      // past the tenant predicate: this tenant can never read another's ledger.
      const foreignNarrowed = await listMovements(
        movementCookie,
        `?sessionId=${foreignMovementSessionId}`
      ).expect(200);
      expect(foreignNarrowed.body).toEqual([]);

      // The foreign tenant's own read is disjoint from this block's rows.
      const foreignListed = await supertest(serverUrl)
        .get("/cash/movements")
        .set("Cookie", ownerACookie)
        .set("X-Request-Id", "live-pg-movement-read-foreign")
        .expect(200);
      const ownIds = new Set(movements.map((movement) => movement.id));
      for (const foreignMovement of foreignListed.body as CashMovementDto[]) {
        expect(ownIds.has(foreignMovement.id)).toBe(false);
      }

      // A read is never audited and writes no movement.
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.cashMovement.count({ where: { tenantId: movementTenantId } })).toBe(
        movementsBefore
      );
    }, 30_000);

    it("leaves no residue: every raw probe rolled back and the fixture counts unchanged", async () => {
      // The probe-only register carried the raw exclusivity probes: any
      // surviving session or movement there could only come from a probe that
      // failed to roll back.
      expect(
        await prisma.cashSession.count({ where: { registerId: movementProbeRegisterId } })
      ).toBe(0);
      expect(
        await prisma.cashMovement.count({ where: { registerId: movementProbeRegisterId } })
      ).toBe(0);

      // The CLOSED fixture register carries exactly its ONE committed session
      // and NO movement: the CLOSED rejection committed nothing.
      expect(
        await prisma.cashSession.count({ where: { registerId: movementClosedRegisterId } })
      ).toBe(1);
      expect(
        await prisma.cashSession.count({
          where: { registerId: movementClosedRegisterId, status: "CLOSED" },
        })
      ).toBe(1);
      expect(
        await prisma.cashMovement.count({ where: { sessionId: movementClosedSessionId } })
      ).toBe(0);

      // The dedicated tenant owns exactly its three fixture registers and its two
      // committed sessions (the OPEN fixture and the CLOSED fixture).
      expect(await prisma.cashRegister.count({ where: { tenantId: movementTenantId } })).toBe(3);
      expect(await prisma.cashSession.count({ where: { tenantId: movementTenantId } })).toBe(2);

      // Every COMMITTED movement belongs to the OPEN fixture session and carries
      // a direction exactly when it is an ADJUSTMENT.
      const committed = await rawTenantMovements();
      expect(committed).toHaveLength(CASH_MOVEMENT_COMMITTED_COUNT);
      for (const row of committed) {
        expect(row.tenant_id).toBe(movementTenantId);
        expect(row.register_id).toBe(movementRegisterId);
        expect(row.session_id).toBe(movementSessionId);
        expect(row.direction === null).toBe(row.type !== "ADJUSTMENT");
      }

      // Every committed movement carries exactly ONE audit row, and no other
      // `cash.movement.created` row exists for this tenant.
      expect(
        await prisma.auditLog.count({
          where: { action: "cash.movement.created", tenantId: movementTenantId },
        })
      ).toBe(CASH_MOVEMENT_COMMITTED_COUNT);
      expect(await prisma.cashMovement.count({ where: { tenantId: movementTenantId } })).toBe(
        CASH_MOVEMENT_COMMITTED_COUNT
      );

      // The foreign tenant's session of the 404 case is untouched.
      expect(
        await prisma.cashSession.findUnique({ where: { id: foreignMovementSessionId } })
      ).toMatchObject({ tenantId: tenantAId, status: "OPEN" });
      expect(
        await prisma.cashMovement.count({ where: { sessionId: foreignMovementSessionId } })
      ).toBe(0);
    }, 30_000);
  });

  /**
   * EPIC-13 CASH-003 live-PostgreSQL evidence: the cash session CLOSE command at
   * the REAL boundary.
   *
   * Proves against the booted AppModule, the real guard chain, real HTTP and the
   * `20260930000001_cash_data_foundation` migration's applied DDL what the shared
   * in-memory boundary cannot represent:
   *   1. the server-side expected amount over a session holding EVERY PRD §20
   *      kind (including both `ADJUSTMENT` directions), the three close amounts
   *      stored and returned at `Decimal(14, 2)` scale, the exact difference
   *      signal for an over AND a short drawer, and exactly ONE
   *      `cash.session.closed` audit row carrying field NAMES only;
   *   2. a ZERO-movement close at the opening amount (DEC-036);
   *   3. the terminal second close: the stable `409` that persists nothing and
   *      leaves the stored close amounts untouched;
   *   4. the byte-equivalent cross-tenant `404` — the FIRST cash route that
   *      addresses a session BY ID, so the session half of the cross-tenant
   *      guarantee is now exercisable over HTTP — and no audit row;
   *   5. a movement create refused against the CLOSED session with the same
   *      stable `409`, plus the raw database trigger behind it;
   *   6. the close serialization: two concurrent closes of the SAME session,
   *      exactly one `201` and one stable `409` under a PROVEN session-row-lock
   *      overlap, with exactly one audit row and the close amounts written once;
   *   7. the applied close-column schema: NULLABLE `numeric(14,2)` in all three
   *      columns, so a raw `CLOSED` session row committed by an EARLIER block is
   *      still admitted;
   *   8. zero residue: every raw probe rolled back and the fixture counts
   *      unchanged.
   *
   * The block owns a DEDICATED tenant, four registers and its own sessions, and
   * it runs LAST: no earlier block's session is ever closed by it, and the
   * earlier blocks' committed-versus-rolled-back expectations are untouched.
   *
   * Every assertion is deterministic: no mock, no injected Prisma error, no
   * sleep and no retry, and every raw-SQL mutation runs inside an interactive
   * transaction that is always rolled back. A rejected statement ABORTS its
   * transaction, so each expected database rejection owns its own transaction.
   */
  describe("EPIC-13 cash session close application-path isolation", () => {
    /** Marker error that forces an interactive transaction to roll back. */
    const CASH_CLOSE_ROLLBACK_SENTINEL = "live-pg-cash-close-rollback";

    /**
     * Stable `409` wire message for a command against a session that is not
     * `OPEN`, mirrored as a literal so the live suite asserts the byte-exact
     * body the application emits rather than importing the production constant.
     */
    const CASH_CLOSE_SESSION_NOT_OPEN_MESSAGE = "This cash session is not open.";

    /**
     * The seven movement kinds `POST /cash/movements` can create (PRD §20,
     * DEC-030): every kind but `SALE`, plus BOTH `ADJUSTMENT` directions. The
     * eighth kind, `SALE`, is owned by POS-003 and is therefore seeded raw (see
     * {@link insertRawSaleMovement}), so the close formula's `+ SALE` term is
     * exercised too.
     */
    const CLOSE_MOVEMENT_MIX = [
      { type: "INCOME", amount: "25.05", reason: null, direction: null },
      { type: "DEPOSIT", amount: "80.20", reason: "Live close deposit", direction: null },
      { type: "REFUND", amount: "10.15", reason: "Live close refund", direction: null },
      { type: "EXPENSE", amount: "20.30", reason: "Live close expense", direction: null },
      { type: "WITHDRAWAL", amount: "15.40", reason: "Live close withdrawal", direction: null },
      { type: "ADJUSTMENT", amount: "7.25", reason: "Live close increase", direction: "INCREASE" },
      { type: "ADJUSTMENT", amount: "17.35", reason: "Live close decrease", direction: "DECREASE" },
    ] as const;

    /** The POS-003-owned `SALE` row the close formula's positive branch needs. */
    const CLOSE_RAW_SALE_AMOUNT = "50.10";

    /**
     * The mixed session's figures, computed server-side by the close command:
     *
     *   expected = 123.45 opening
     *            + 50.10 SALE + 25.05 INCOME + 80.20 DEPOSIT
     *            - 10.15 REFUND - 20.30 EXPENSE - 15.40 WITHDRAWAL
     *            + 7.25 ADJUSTMENT(INCREASE) - 17.35 ADJUSTMENT(DECREASE)
     *            = 222.85
     *
     * with a counted amount ABOVE it, so `difference` is a POSITIVE over-drawer
     * signal at `Decimal(14, 2)` scale (DEC-030/DEC-031).
     */
    const CLOSE_MIXED_OPENING_AMOUNT = "123.45";
    const CLOSE_MIXED_EXPECTED_AMOUNT = "222.85";
    const CLOSE_MIXED_COUNTED_AMOUNT = "225.00";
    const CLOSE_MIXED_DIFFERENCE_AMOUNT = "2.15";

    /**
     * The ZERO-movement session: `expected === opening` (DEC-036) with a counted
     * amount BELOW it, so `difference` is a NEGATIVE short-drawer signal.
     */
    const CLOSE_EMPTY_OPENING_AMOUNT = "150.00";
    const CLOSE_EMPTY_COUNTED_AMOUNT = "140.00";
    const CLOSE_EMPTY_DIFFERENCE_AMOUNT = "-10.00";

    /** The race session: zero movements, two DIFFERENT counted amounts. */
    const CLOSE_RACE_OPENING_AMOUNT = "300.00";
    const CLOSE_RACE_COUNTED_AMOUNTS = ["305.00", "295.00"] as const;

    /** Committed `cash_movement` rows of this block: 7 command rows + 1 raw SALE. */
    const CASH_CLOSE_SESSION_MOVEMENT_COUNT = 8;
    /** Of those, the ones the standalone command created (each with one audit row). */
    const CASH_CLOSE_COMMAND_MOVEMENT_COUNT = 7;
    /** The three sessions this block closes, one `cash.session.closed` audit each. */
    const CASH_CLOSE_COMMITTED_CLOSED_COUNT = 3;

    /** The dedicated tenant that owns every close fixture of this block. */
    let closeTenantId: string;
    let closeCookie: string;
    let closeOwnerProfileId: string;
    /** The dedicated tenant's ACTIVE membership: the opener the DB stores. */
    let closeMembershipId: string;
    /** Drawer holding the movement-mix session, then the concurrency probe. */
    let closeRegisterId: string;
    /** Drawer holding the ZERO-movement session. */
    let closeEmptyRegisterId: string;
    /** Drawer holding the concurrently-closed session. */
    let closeRaceRegisterId: string;
    /** Probe-only drawer: no HTTP case ever opens a session on it. */
    let closeProbeRegisterId: string;
    let closeMixedSessionId: string;
    let closeEmptySessionId: string;
    let closeRaceSessionId: string;
    /** Tenant A's own committed OPEN session, the foreign id of the 404 case. */
    let foreignCloseSessionId: string;

    /** One register create over REAL HTTP with a pinned request id. */
    const createRegister = (cookie: string, name: string, requestId: string): supertest.Test =>
      supertest(serverUrl)
        .post("/cash/registers")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .send({ name });

    /** One session open over REAL HTTP with a pinned request id. */
    const openSession = (
      cookie: string,
      registerId: string,
      openingAmount: string,
      requestId: string
    ): supertest.Test =>
      supertest(serverUrl)
        .post("/cash/sessions")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .send({ registerId, openingAmount });

    /**
     * One session close over REAL HTTP with a pinned request id. The returned
     * value is an EAGER promise (never a lazy supertest `Test`), so the request
     * is already in flight when the concurrency case builds its racers: the
     * row-lock barrier below would otherwise observe zero waiters.
     */
    const closeSession = (
      cookie: string,
      sessionId: string,
      countedAmount: string,
      requestId: string
    ) =>
      supertest(serverUrl)
        .post(`/cash/sessions/${sessionId}/close`)
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .send({ countedAmount })
        .then((response) => response);

    /** One movement create over REAL HTTP; the key is fresh unless pinned. */
    const createMovement = (
      cookie: string,
      body: Record<string, unknown>,
      requestId: string,
      idempotencyKey: string = randomUUID()
    ): supertest.Test =>
      supertest(serverUrl)
        .post("/cash/movements")
        .set("Cookie", cookie)
        .set("X-Request-Id", requestId)
        .set("Idempotency-Key", idempotencyKey)
        .send(body);

    /**
     * Extracts the database message from Prisma's raw-query error wrapper
     * (`Raw query failed. Code: `23001`. Message: `...``). The captured text is
     * the database's own message, so an assertion can compare it EXACTLY instead
     * of matching a substring of the wrapper.
     */
    const databaseMessage = (error: unknown): string => {
      const text = error instanceof Error ? error.message : String(error);
      const match = /Message: `([\s\S]*?)`/.exec(text);
      // PostgreSQL renders a `RAISE EXCEPTION` message with a fixed `ERROR: `
      // severity prefix; stripping it leaves the exact text the trigger raises.
      return (match ? match[1] : text).replace(/^ERROR: /, "");
    };

    /** Runs `probe` and returns the exact database message of its rejection. */
    const captureDatabaseMessage = async (probe: () => Promise<unknown>): Promise<string> => {
      try {
        await probe();
      } catch (error) {
        return databaseMessage(error);
      }
      throw new Error("Expected the raw statement to be rejected by the database");
    };

    /**
     * Runs `work` inside an interactive transaction that is ALWAYS rolled back,
     * so a probe can seed throwaway rows and attempt a mutation without
     * persisting anything. A rejected statement ABORTS its transaction, so every
     * expected database rejection below owns its OWN call to this helper. An
     * assertion failure inside `work` propagates and fails the case instead of
     * matching the rollback sentinel.
     */
    const inRolledBackTransaction = async (
      work: (tx: Prisma.TransactionClient) => Promise<void>
    ): Promise<void> => {
      await expect(
        prisma.$transaction(async (tx) => {
          await work(tx);
          throw new Error(CASH_CLOSE_ROLLBACK_SENTINEL);
        })
      ).rejects.toThrow(CASH_CLOSE_ROLLBACK_SENTINEL);
    };

    /** Raw session insert at the migration's exact shape; returns the id. */
    const insertRawSession = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      registerId: string,
      openedByMembershipId: string,
      openingAmount: string,
      status: "OPEN" | "CLOSED"
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_session" (
          "id", "tenant_id", "register_id", "status", "opened_by_membership_id", "opening_amount"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid,
          ${status}::cash_session_status, ${openedByMembershipId}::uuid,
          ${openingAmount}::decimal
        )
      `;
      return id;
    };

    /** Raw movement insert at the migration's exact shape; returns the id. */
    const insertRawMovement = async (
      tx: Prisma.TransactionClient,
      tenantId: string,
      registerId: string,
      sessionId: string,
      amount: string,
      type = "SALE"
    ): Promise<string> => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "cash_movement" (
          "id", "tenant_id", "register_id", "session_id", "type", "amount", "reason", "direction"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${sessionId}::uuid,
          ${type}::cash_movement_type, ${amount}::decimal, NULL, NULL
        )
      `;
      return id;
    };

    /**
     * Raw `SALE` cash movement at the migration's exact shape, committed by the
     * fixture. `SALE` is the ONE kind `POST /cash/movements` deliberately refuses
     * (POS-003 owns it inside CompleteSale), so seeding it raw is the only way
     * the close formula's `+ SALE` term is exercised over a REAL ledger row. The
     * session is `OPEN`, so the closed-session insert guard admits it.
     */
    const insertRawSaleMovement = async (
      tenantId: string,
      registerId: string,
      sessionId: string,
      amount: string
    ): Promise<string> => {
      const id = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "cash_movement" (
          "id", "tenant_id", "register_id", "session_id", "type", "amount", "reason", "direction"
        )
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${sessionId}::uuid,
          'SALE'::cash_movement_type, ${amount}::decimal, NULL, NULL
        )
      `;
      return id;
    };

    /**
     * The STORED close-result columns of one session, read from PostgreSQL at
     * their OWN exact scales, so the three amounts are asserted against real
     * `Decimal(14, 2)` state rather than the HTTP projection alone. `::text` on
     * a NULL column stays NULL.
     */
    const rawStoredClose = (
      id: string
    ): Promise<
      {
        status: string;
        expected_amount: string | null;
        counted_amount: string | null;
        difference_amount: string | null;
      }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "status"::text AS status,
          "expected_amount"::text AS expected_amount,
          "counted_amount"::text AS counted_amount,
          "difference_amount"::text AS difference_amount
        FROM "cash_session" WHERE "id" = ${id}::uuid
      `;

    /** Every stored `cash_movement` of one session, at the columns' exact shapes. */
    const rawSessionMovements = (
      sessionId: string
    ): Promise<
      { type: string; direction: string | null; amount: string; reason: string | null }[]
    > =>
      prisma.$queryRaw`
        SELECT
          "type"::text AS type, "direction"::text AS direction,
          "amount"::text AS amount, "reason" AS reason
        FROM "cash_movement"
        WHERE "session_id" = ${sessionId}::uuid
        ORDER BY "type"::text ASC, "amount"::text ASC, "id" ASC
      `;

    /** The exclusive `cash.session.closed` audit rows of one session. */
    const closeAudits = (sessionId: string) =>
      prisma.auditLog.findMany({
        where: { action: "cash.session.closed", targetId: sessionId },
      });

    beforeAll(async () => {
      // The `cash` grant is explicit (DEC-026): plan mappings never grant
      // access, so the dedicated tenant must hold a direct tenant_entitlement
      // row before the close route is reachable.
      const closeTenant = await prisma.tenant.create({
        data: { slug: "live-close", name: "Tenant Close" },
      });
      closeTenantId = closeTenant.id;

      const ownerRole = await prisma.role.findUnique({ where: { code: "OWNER" } });
      if (!ownerRole) {
        throw new Error("Reference seed did not create OWNER role");
      }
      const closeOwner = await prisma.userProfile.create({
        data: {
          email: "owner-close@live.test",
          displayName: "Owner Close",
          status: "active",
        },
      });
      closeOwnerProfileId = closeOwner.id;
      const membership = await prisma.tenantMembership.create({
        data: {
          tenantId: closeTenant.id,
          userProfileId: closeOwner.id,
          roleId: ownerRole.id,
          status: "ACTIVE",
        },
      });
      closeMembershipId = membership.id;
      const session = await app.get(SessionService).issue(closeOwner.id);
      closeCookie = `${STAFF_SESSION_COOKIE}=${session.token}`;

      const cashFeature = await prisma.featureCode.upsert({
        where: { code: "cash" },
        create: { code: "cash" },
        update: {},
      });
      await prisma.tenantEntitlement.upsert({
        where: {
          tenantId_featureCodeId: { tenantId: closeTenant.id, featureCodeId: cashFeature.id },
        },
        create: { tenantId: closeTenant.id, featureCodeId: cashFeature.id },
        update: {},
      });

      // Four drawers, every one owned by this block and this block only: the
      // movement-mix drawer, the zero-movement drawer, the race drawer and the
      // probe-only drawer no HTTP case ever resolves a session on.
      closeRegisterId = (
        (
          await createRegister(
            closeCookie,
            "Live Close Mixed Drawer",
            "live-pg-close-fixture-register-mixed"
          ).expect(201)
        ).body as CashRegisterDto
      ).id;
      closeEmptyRegisterId = (
        (
          await createRegister(
            closeCookie,
            "Live Close Empty Drawer",
            "live-pg-close-fixture-register-empty"
          ).expect(201)
        ).body as CashRegisterDto
      ).id;
      closeRaceRegisterId = (
        (
          await createRegister(
            closeCookie,
            "Live Close Race Drawer",
            "live-pg-close-fixture-register-race"
          ).expect(201)
        ).body as CashRegisterDto
      ).id;
      closeProbeRegisterId = (
        (
          await createRegister(
            closeCookie,
            "Live Close Probe Drawer",
            "live-pg-close-fixture-register-probe"
          ).expect(201)
        ).body as CashRegisterDto
      ).id;

      // The movement-mix session: an exact opening float over which the server
      // must fold EVERY kind and BOTH `ADJUSTMENT` directions. Seven kinds go
      // through the REAL movement command, so the ledger the close reads is the
      // one the database actually stored.
      closeMixedSessionId = (
        (
          await openSession(
            closeCookie,
            closeRegisterId,
            CLOSE_MIXED_OPENING_AMOUNT,
            "live-pg-close-fixture-mixed-session"
          ).expect(201)
        ).body as CashSessionDto
      ).id;
      for (const [index, movement] of CLOSE_MOVEMENT_MIX.entries()) {
        const body: Record<string, unknown> = {
          sessionId: closeMixedSessionId,
          type: movement.type,
          amount: movement.amount,
        };
        if (movement.reason !== null) {
          body.reason = movement.reason;
        }
        if (movement.direction !== null) {
          body.direction = movement.direction;
        }
        await createMovement(closeCookie, body, `live-pg-close-fixture-mix-${index + 1}`).expect(
          201
        );
      }
      // The eighth kind, `SALE`, is POS-003's and the command refuses it, so the
      // row is seeded raw on the still-OPEN session.
      await insertRawSaleMovement(
        closeTenantId,
        closeRegisterId,
        closeMixedSessionId,
        CLOSE_RAW_SALE_AMOUNT
      );
      expect(await prisma.cashMovement.count({ where: { sessionId: closeMixedSessionId } })).toBe(
        CASH_CLOSE_SESSION_MOVEMENT_COUNT
      );

      // The ZERO-movement session (DEC-036) and the race session.
      closeEmptySessionId = (
        (
          await openSession(
            closeCookie,
            closeEmptyRegisterId,
            CLOSE_EMPTY_OPENING_AMOUNT,
            "live-pg-close-fixture-empty-session"
          ).expect(201)
        ).body as CashSessionDto
      ).id;
      closeRaceSessionId = (
        (
          await openSession(
            closeCookie,
            closeRaceRegisterId,
            CLOSE_RACE_OPENING_AMOUNT,
            "live-pg-close-fixture-race-session"
          ).expect(201)
        ).body as CashSessionDto
      ).id;
      expect(await prisma.cashMovement.count({ where: { sessionId: closeEmptySessionId } })).toBe(
        0
      );
      expect(await prisma.cashMovement.count({ where: { sessionId: closeRaceSessionId } })).toBe(0);

      // A REAL foreign OPEN session: tenant A's own committed drawer, resolved
      // server-side only through tenant A's own request. It is the foreign id of
      // the byte-equivalent 404 case, and it must survive untouched.
      const foreignRegister = (
        (
          await createRegister(
            ownerACookie,
            "Live Close Foreign Drawer",
            "live-pg-close-fixture-foreign-register"
          ).expect(201)
        ).body as CashRegisterDto
      ).id;
      foreignCloseSessionId = (
        (
          await openSession(
            ownerACookie,
            foreignRegister,
            "77.00",
            "live-pg-close-fixture-foreign-session"
          ).expect(201)
        ).body as CashSessionDto
      ).id;

      // The fixtures really are distinct tenants and the block starts clean.
      expect(closeTenantId).not.toBe(tenantAId);
      expect(await prisma.cashMovement.count({ where: { tenantId: closeTenantId } })).toBe(
        CASH_CLOSE_SESSION_MOVEMENT_COUNT
      );
      expect(
        await prisma.cashSession.count({ where: { tenantId: closeTenantId, status: "CLOSED" } })
      ).toBe(0);
    }, 60_000);

    it("closes a session over real HTTP: the expected amount folds every kind and both ADJUSTMENT directions, the three amounts are stored at scale 2, the difference is the exact over-drawer sign, and exactly one cash.session.closed audit row carries field NAMES only", async () => {
      const requestId = "live-pg-close-mixed";
      const auditsBefore = await prisma.auditLog.count();
      const movementsBefore = await prisma.cashMovement.count();

      // The REAL stored ledger the server must fold: every PRD §20 kind, both
      // `ADJUSTMENT` directions, every amount stored POSITIVE (the kind owns the
      // sign, DEC-030).
      expect(await rawSessionMovements(closeMixedSessionId)).toEqual([
        {
          type: "ADJUSTMENT",
          direction: "DECREASE",
          amount: "17.35",
          reason: "Live close decrease",
        },
        {
          type: "ADJUSTMENT",
          direction: "INCREASE",
          amount: "7.25",
          reason: "Live close increase",
        },
        { type: "DEPOSIT", direction: null, amount: "80.20", reason: "Live close deposit" },
        { type: "EXPENSE", direction: null, amount: "20.30", reason: "Live close expense" },
        { type: "INCOME", direction: null, amount: "25.05", reason: null },
        { type: "REFUND", direction: null, amount: "10.15", reason: "Live close refund" },
        { type: "SALE", direction: null, amount: CLOSE_RAW_SALE_AMOUNT, reason: null },
        {
          type: "WITHDRAWAL",
          direction: null,
          amount: "15.40",
          reason: "Live close withdrawal",
        },
      ]);

      const response = await closeSession(
        closeCookie,
        closeMixedSessionId,
        CLOSE_MIXED_COUNTED_AMOUNT,
        requestId
      );
      expect(response.status).toBe(201);
      const body = response.body as CashSessionDto;
      // The allowlisted projection: exact key set, no `tenantId` and no Prisma
      // column name crossing the boundary.
      expect(Object.keys(body).sort()).toEqual(CASH_SESSION_DTO_KEYS);
      expect(Object.keys(body)).not.toContain("tenantId");
      expect(body.id).toBe(closeMixedSessionId);
      expect(body.registerId).toBe(closeRegisterId);
      expect(body.status).toBe("CLOSED");
      expect(body.openingAmount).toBe(CLOSE_MIXED_OPENING_AMOUNT);
      expect(body.expectedAmount).toBe(CLOSE_MIXED_EXPECTED_AMOUNT);
      expect(body.countedAmount).toBe(CLOSE_MIXED_COUNTED_AMOUNT);
      expect(body.differenceAmount).toBe(CLOSE_MIXED_DIFFERENCE_AMOUNT);
      // The SIGN, not only the literal: a counted amount ABOVE the server's
      // expected amount is an over drawer (positive difference).
      expect(Number(body.differenceAmount)).toBeGreaterThan(0);
      expect(response.text).not.toContain("tenantId");

      // The STORED close row at the columns' own exact scales.
      expect(await rawStoredClose(closeMixedSessionId)).toEqual([
        {
          status: "CLOSED",
          expected_amount: CLOSE_MIXED_EXPECTED_AMOUNT,
          counted_amount: CLOSE_MIXED_COUNTED_AMOUNT,
          difference_amount: CLOSE_MIXED_DIFFERENCE_AMOUNT,
        },
      ]);

      // The read projection carries the SAME three amounts for a `CLOSED` row,
      // and reads are never audited.
      const listed = await supertest(serverUrl)
        .get("/cash/sessions?status=CLOSED")
        .set("Cookie", closeCookie)
        .set("X-Request-Id", requestId)
        .expect(200);
      const closedRow = (listed.body as CashSessionDto[]).find(
        (row) => row.id === closeMixedSessionId
      );
      expect(closedRow).toMatchObject({
        status: "CLOSED",
        expectedAmount: CLOSE_MIXED_EXPECTED_AMOUNT,
        countedAmount: CLOSE_MIXED_COUNTED_AMOUNT,
        differenceAmount: CLOSE_MIXED_DIFFERENCE_AMOUNT,
      });

      // Exactly ONE co-committed `cash.session.closed` audit row carrying ids
      // and field NAMES only.
      const audits = await closeAudits(closeMixedSessionId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "cash.session.closed",
        targetType: "cash_session",
        targetId: closeMixedSessionId,
        tenantId: closeTenantId,
        actorUserProfileId: closeOwnerProfileId,
      });
      const metadata = audits[0].metadata as {
        schemaVersion: number;
        changedFields: string[];
      };
      expect(Object.keys(metadata).sort()).toEqual(["changedFields", "schemaVersion"]);
      expect(metadata.schemaVersion).toBe(1);
      expect(metadata.changedFields).toEqual([
        "status",
        "expectedAmount",
        "countedAmount",
        "differenceAmount",
      ]);
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain(closeMixedSessionId);
      expect(serialized).not.toContain(closeRegisterId);
      expect(serialized).not.toContain(closeTenantId);
      expect(serialized).not.toContain(CLOSE_MIXED_COUNTED_AMOUNT);
      expect(serialized).not.toContain(CLOSE_MIXED_EXPECTED_AMOUNT);
      expect(serialized).not.toContain(CLOSE_MIXED_DIFFERENCE_AMOUNT);

      // The close's WHOLE durable effect is the session's three columns and one
      // audit row: no movement, no sale, nothing else.
      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(1);
    }, 60_000);

    it("closes a session with ZERO movements at the opening amount and reports the exact short-drawer sign", async () => {
      // The precondition is read from the REAL table, never assumed.
      expect(await prisma.cashMovement.count({ where: { sessionId: closeEmptySessionId } })).toBe(
        0
      );
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-close-empty";

      const response = await closeSession(
        closeCookie,
        closeEmptySessionId,
        CLOSE_EMPTY_COUNTED_AMOUNT,
        requestId
      );
      expect(response.status).toBe(201);
      const body = response.body as CashSessionDto;
      expect(Object.keys(body).sort()).toEqual(CASH_SESSION_DTO_KEYS);
      expect(body.status).toBe("CLOSED");
      // ZERO movements: the expected amount IS the opening amount (DEC-036).
      expect(body.expectedAmount).toBe(CLOSE_EMPTY_OPENING_AMOUNT);
      expect(body.countedAmount).toBe(CLOSE_EMPTY_COUNTED_AMOUNT);
      expect(body.differenceAmount).toBe(CLOSE_EMPTY_DIFFERENCE_AMOUNT);
      // The SHORT drawer: `counted - expected` is NEGATIVE.
      expect(Number(body.differenceAmount)).toBeLessThan(0);

      expect(await rawStoredClose(closeEmptySessionId)).toEqual([
        {
          status: "CLOSED",
          expected_amount: CLOSE_EMPTY_OPENING_AMOUNT,
          counted_amount: CLOSE_EMPTY_COUNTED_AMOUNT,
          difference_amount: CLOSE_EMPTY_DIFFERENCE_AMOUNT,
        },
      ]);
      expect(await closeAudits(closeEmptySessionId)).toHaveLength(1);
      // A zero-movement close writes NO movement and exactly one audit row.
      expect(await prisma.cashMovement.count({ where: { sessionId: closeEmptySessionId } })).toBe(
        0
      );
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
    }, 30_000);

    it("rejects a second close of the same session as the stable 409, persisting nothing and leaving the stored close amounts untouched", async () => {
      const storedBefore = await rawStoredClose(closeMixedSessionId);
      expect(storedBefore).toEqual([
        {
          status: "CLOSED",
          expected_amount: CLOSE_MIXED_EXPECTED_AMOUNT,
          counted_amount: CLOSE_MIXED_COUNTED_AMOUNT,
          difference_amount: CLOSE_MIXED_DIFFERENCE_AMOUNT,
        },
      ]);
      const auditsBefore = await prisma.auditLog.count();
      const sessionsBefore = await prisma.cashSession.count();
      const movementsBefore = await prisma.cashMovement.count();
      const requestId = "live-pg-close-second";

      const response = await closeSession(closeCookie, closeMixedSessionId, "999.00", requestId);
      expect(response.status).toBe(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((response.body as { error: { message: string } }).error.message).toBe(
        CASH_CLOSE_SESSION_NOT_OPEN_MESSAGE
      );
      // Value-free: neither the session nor the tenant id echoes back.
      expect(response.text).not.toContain(closeMixedSessionId);
      expect(response.text).not.toContain(closeTenantId);

      // `CLOSED` is terminal: the second request's counted amount never reached
      // the row, nothing was created and no audit row was appended.
      expect(await rawStoredClose(closeMixedSessionId)).toEqual(storedBefore);
      expect(await prisma.cashSession.count()).toBe(sessionsBefore);
      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await closeAudits(closeMixedSessionId)).toHaveLength(1);
    }, 30_000);

    it("masks a foreign-tenant session id and an unknown session id as one byte-equivalent 404, persisting nothing and appending no audit row", async () => {
      // The foreign session is a REAL committed OPEN row of another tenant: the
      // close route is the FIRST cash route that addresses a session BY ID, so
      // this is where the session half of the cross-tenant guarantee becomes
      // exercisable over HTTP.
      expect(
        await prisma.cashSession.findUnique({ where: { id: foreignCloseSessionId } })
      ).toMatchObject({ tenantId: tenantAId, status: "OPEN" });
      const auditsBefore = await prisma.auditLog.count();
      const sessionsBefore = await prisma.cashSession.count();
      const requestId = "live-pg-close-not-found-proof";

      const foreign = await closeSession(closeCookie, foreignCloseSessionId, "10.00", requestId);
      const missing = await closeSession(closeCookie, randomUUID(), "10.00", requestId);

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect((foreign.body as ErrorEnvelope).error.code).toBe("NOT_FOUND");
      expect((foreign.body as { error: { message: string } }).error.message).toBe(
        CASH_SESSION_NOT_FOUND_MESSAGE
      );
      // Byte-equivalence: a session owned by another tenant is indistinguishable
      // from a non-existent one, echoed correlation included.
      expect(foreign.text).toBe(missing.text);
      expect(foreign.text).not.toContain(foreignCloseSessionId);
      expect(foreign.text).not.toContain(tenantAId);
      // ONE shared session message, distinct from the register message.
      expect(CASH_SESSION_NOT_FOUND_MESSAGE).not.toBe(CASH_REGISTER_NOT_FOUND_MESSAGE);

      // Neither masked attempt persisted a close amount or an audit row, and the
      // foreign session survived unchanged.
      expect(await prisma.cashSession.count()).toBe(sessionsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await rawStoredClose(foreignCloseSessionId)).toEqual([
        {
          status: "OPEN",
          expected_amount: null,
          counted_amount: null,
          difference_amount: null,
        },
      ]);
      expect(await closeAudits(foreignCloseSessionId)).toHaveLength(0);
      expect(await prisma.cashMovement.count({ where: { sessionId: foreignCloseSessionId } })).toBe(
        0
      );
    }, 30_000);

    it("refuses a movement create against the CLOSED session with the stable 409, persisting nothing", async () => {
      // The session is a REAL committed CLOSED row: the closed-session rule is
      // observable over HTTP, not only in the migration.
      expect(await rawStoredClose(closeMixedSessionId)).toMatchObject([{ status: "CLOSED" }]);
      const movementsBefore = await prisma.cashMovement.count();
      const auditsBefore = await prisma.auditLog.count();
      const requestId = "live-pg-close-closed-movement";

      const response = await createMovement(
        closeCookie,
        { sessionId: closeMixedSessionId, type: "INCOME", amount: "5.00" },
        requestId
      );
      expect(response.status).toBe(409);
      expect((response.body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((response.body as { error: { message: string } }).error.message).toBe(
        CASH_CLOSE_SESSION_NOT_OPEN_MESSAGE
      );
      // Value-free: neither the session nor the tenant id echoes back.
      expect(response.text).not.toContain(closeMixedSessionId);
      expect(response.text).not.toContain(closeTenantId);

      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await prisma.auditLog.count({ where: { requestId } })).toBe(0);
      expect(await prisma.cashMovement.count({ where: { sessionId: closeMixedSessionId } })).toBe(
        CASH_CLOSE_SESSION_MOVEMENT_COUNT
      );
    }, 30_000);

    it("refuses a raw movement insert into the CLOSED session at the database trigger with a rolled-back probe", async () => {
      const movementsBefore = await prisma.cashMovement.count();
      const sessionsBefore = await prisma.cashSession.count();

      // DEC-035's database backstop: the migration's insert guard raises
      // `restrict_violation` (`23001`) with this exact message. A rejected
      // statement aborts its transaction, so the probe owns its own.
      await inRolledBackTransaction(async (tx) => {
        const message = await captureDatabaseMessage(() =>
          insertRawMovement(tx, closeTenantId, closeRegisterId, closeMixedSessionId, "5.00")
        );
        expect(message).toBe("a cash movement cannot be inserted into a closed session");
      });

      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.cashSession.count()).toBe(sessionsBefore);
      expect(await prisma.cashMovement.count({ where: { sessionId: closeMixedSessionId } })).toBe(
        CASH_CLOSE_SESSION_MOVEMENT_COUNT
      );
    }, 30_000);

    it("serializes two concurrent closes of the same session under a PROVEN row-lock overlap: one 201, one stable 409, one audit row and the close amounts written once", async () => {
      const firstRequestId = "live-pg-close-race-1";
      const secondRequestId = "live-pg-close-race-2";
      const auditsBefore = await prisma.auditLog.count();
      const movementsBefore = await prisma.cashMovement.count();
      const sessionsBefore = await prisma.cashSession.count();

      // Deterministic overlap: a dedicated transaction holds THIS session's row
      // lock (`SELECT ... FOR UPDATE`), which is the exact lock the close command
      // takes FIRST (`lockById`), so BOTH closes park on that single row before
      // either can read the status. The FOR UPDATE is a ROW lock, so the barrier
      // is the tuple-lock waiter count `waitForRowLockWaiters` over the row's
      // `(relation, page, tuple)` — the file's `pg_stat_activity`-backed barrier
      // helper: a waiter registers a `tuple` lock on THAT exact tuple while it
      // blocks, so an unrelated lock waiter (a relation, advisory or other-row
      // lock) can never satisfy it. The interleaving is decided by the database
      // boundary, never by wall-clock timing, and an unproven overlap throws.
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
            SELECT "id" FROM "cash_session"
            WHERE "tenant_id" = ${closeTenantId}::uuid AND "id" = ${closeRaceSessionId}::uuid
            FOR UPDATE
          `;
          signalBarrierReady();
          // The session row lock is released ONLY once the barrier resolves, so
          // the racers stay parked until both are provably on that row.
          await barrierReleased;
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      await barrierReady;
      // The row lock is held now, so the ctid cannot move under the racers.
      const ctid = await readRowCtid(prisma, "cash_session", closeRaceSessionId);

      const racers = CLOSE_RACE_COUNTED_AMOUNTS.map((countedAmount, index) =>
        closeSession(
          closeCookie,
          closeRaceSessionId,
          countedAmount,
          index === 0 ? firstRequestId : secondRequestId
        )
      );

      try {
        await waitForRowLockWaiters(prisma, "cash_session", ctid.page, ctid.tuple, 2, 10_000);
      } finally {
        releaseBarrier();
        await barrierTransaction;
      }

      const responses = await Promise.all(racers);
      // The database guarantees this outcome for EVERY interleaving: the winner
      // commits its close inside its transaction, and the loser's post-lock read
      // sees the committed `CLOSED` and is refused by the `OPEN` gate. The
      // assertions never depend on WHICH request won, and there is no sleep and
      // no retry that could hide a double close.
      const admitted = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].body as ErrorEnvelope).error.code).toBe("CONFLICT");
      expect((rejected[0].body as { error: { message: string } }).error.message).toBe(
        CASH_CLOSE_SESSION_NOT_OPEN_MESSAGE
      );

      const admittedBody = admitted[0].body as CashSessionDto;
      expect(admittedBody.status).toBe("CLOSED");
      expect(admittedBody.expectedAmount).toBe(CLOSE_RACE_OPENING_AMOUNT);
      // The WINNER'S OWN counted amount is the one that reached the row, so the
      // close amounts were written exactly ONCE and the loser wrote nothing.
      expect(CLOSE_RACE_COUNTED_AMOUNTS).toContain(admittedBody.countedAmount);
      expect(admittedBody.differenceAmount).toBe(
        admittedBody.countedAmount === CLOSE_RACE_COUNTED_AMOUNTS[0] ? "5.00" : "-5.00"
      );
      expect(await rawStoredClose(closeRaceSessionId)).toEqual([
        {
          status: "CLOSED",
          expected_amount: CLOSE_RACE_OPENING_AMOUNT,
          counted_amount: admittedBody.countedAmount,
          difference_amount: admittedBody.differenceAmount,
        },
      ]);

      // Exactly ONE `cash.session.closed` audit row for this session and ONE
      // audit row across BOTH attempts: the loser rolled its whole transaction
      // back.
      expect(await closeAudits(closeRaceSessionId)).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { requestId: { in: [firstRequestId, secondRequestId] } },
        })
      ).toBe(1);
      expect(await prisma.auditLog.count()).toBe(auditsBefore + 1);
      expect(await prisma.cashMovement.count()).toBe(movementsBefore);
      expect(await prisma.cashSession.count()).toBe(sessionsBefore);
      expect(await prisma.cashMovement.count({ where: { sessionId: closeRaceSessionId } })).toBe(0);
    }, 60_000);

    it("asserts the applied close-column schema and that a raw CLOSED session row needs no close amounts", async () => {
      // The applied columns: NULLABLE `numeric(14,2)` in all three, exactly the
      // migration's additive declaration. A `CLOSED` session row therefore does
      // NOT have to carry close amounts, which is what keeps a raw fixture row
      // written outside the close command admissible.
      const columns = await prisma.$queryRaw<
        {
          column_name: string;
          data_type: string;
          is_nullable: string;
          numeric_precision: number | null;
          numeric_scale: number | null;
        }[]
      >`
        SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cash_session'
          AND column_name IN ('expected_amount', 'counted_amount', 'difference_amount')
        ORDER BY column_name ASC
      `;
      expect(columns).toEqual([
        {
          column_name: "counted_amount",
          data_type: "numeric",
          is_nullable: "YES",
          numeric_precision: 14,
          numeric_scale: 2,
        },
        {
          column_name: "difference_amount",
          data_type: "numeric",
          is_nullable: "YES",
          numeric_precision: 14,
          numeric_scale: 2,
        },
        {
          column_name: "expected_amount",
          data_type: "numeric",
          is_nullable: "YES",
          numeric_precision: 14,
          numeric_scale: 2,
        },
      ]);

      // The applied schema admits a CLOSED session row written WITHOUT any close
      // amount: a raw insert at the migration's exact shape succeeds and the
      // three columns read back NULL. The probe rolls back.
      await inRolledBackTransaction(async (tx) => {
        const rawClosedId = await insertRawSession(
          tx,
          closeTenantId,
          closeProbeRegisterId,
          closeMembershipId,
          "0.00",
          "CLOSED"
        );
        const stored = await tx.$queryRaw<
          {
            status: string;
            expected_amount: string | null;
            counted_amount: string | null;
            difference_amount: string | null;
          }[]
        >`
          SELECT
            "status"::text AS status,
            "expected_amount"::text AS expected_amount,
            "counted_amount"::text AS counted_amount,
            "difference_amount"::text AS difference_amount
          FROM "cash_session" WHERE "id" = ${rawClosedId}::uuid
        `;
        expect(stored).toEqual([
          {
            status: "CLOSED",
            expected_amount: null,
            counted_amount: null,
            difference_amount: null,
          },
        ]);
      });

      // The raw CLOSED row an EARLIER block (the EPIC-13 movement command block)
      // committed is still admitted and still carries no close amounts, because
      // no column became NOT NULL.
      const earlierRawRegister = await prisma.cashRegister.findFirst({
        where: { name: "Live Movement Closed Drawer" },
      });
      expect(earlierRawRegister).not.toBeNull();
      const earlierRawClosed = await prisma.cashSession.findFirst({
        where: { registerId: earlierRawRegister?.id ?? "", status: "CLOSED" },
      });
      expect(earlierRawClosed).not.toBeNull();
      expect(earlierRawClosed).toMatchObject({
        status: "CLOSED",
        expectedAmount: null,
        countedAmount: null,
        differenceAmount: null,
      });
      // It is also the ONLY raw CLOSED row in the whole database whose three
      // close columns are still NULL: every CLOSED row THIS block produced went
      // through the close command and therefore carries all three.
      expect(
        await prisma.cashSession.count({
          where: {
            status: "CLOSED",
            expectedAmount: null,
            countedAmount: null,
            differenceAmount: null,
          },
        })
      ).toBe(1);
    }, 30_000);

    it("leaves no residue: every raw probe rolled back and the fixture counts unchanged", async () => {
      // The probe-only drawer carried the raw CLOSED-session probe: any
      // surviving row there could only come from a probe that failed to roll
      // back.
      expect(await prisma.cashSession.count({ where: { registerId: closeProbeRegisterId } })).toBe(
        0
      );
      expect(await prisma.cashMovement.count({ where: { registerId: closeProbeRegisterId } })).toBe(
        0
      );

      // The dedicated tenant owns exactly its four fixture registers and its
      // three sessions, ALL of them closed through the command.
      expect(await prisma.cashRegister.count({ where: { tenantId: closeTenantId } })).toBe(4);
      expect(await prisma.cashSession.count({ where: { tenantId: closeTenantId } })).toBe(3);
      expect(
        await prisma.cashSession.count({ where: { tenantId: closeTenantId, status: "CLOSED" } })
      ).toBe(3);
      expect(
        await prisma.cashSession.count({ where: { tenantId: closeTenantId, status: "OPEN" } })
      ).toBe(0);

      // The ledger is exactly the mixed session's rows: the seven command
      // movements plus the raw POS-003-owned `SALE` row.
      expect(await prisma.cashMovement.count({ where: { tenantId: closeTenantId } })).toBe(
        CASH_CLOSE_SESSION_MOVEMENT_COUNT
      );
      expect(await prisma.cashMovement.count({ where: { sessionId: closeMixedSessionId } })).toBe(
        CASH_CLOSE_SESSION_MOVEMENT_COUNT
      );
      expect(await prisma.cashMovement.count({ where: { sessionId: closeEmptySessionId } })).toBe(
        0
      );
      expect(await prisma.cashMovement.count({ where: { sessionId: closeRaceSessionId } })).toBe(0);

      // ONE `cash.session.closed` audit row per closed session: the rejected
      // second close, the two masked 404s, the refused movement and the loser of
      // the race appended none.
      expect(
        await prisma.auditLog.count({
          where: { action: "cash.session.closed", tenantId: closeTenantId },
        })
      ).toBe(CASH_CLOSE_COMMITTED_CLOSED_COUNT);
      expect(
        await prisma.auditLog.count({
          where: { action: "cash.movement.created", tenantId: closeTenantId },
        })
      ).toBe(CASH_CLOSE_COMMAND_MOVEMENT_COUNT);
      expect(
        await prisma.auditLog.count({
          where: { action: "cash.session.opened", tenantId: closeTenantId },
        })
      ).toBe(3);

      // The foreign tenant's session of the 404 case is untouched.
      expect(
        await prisma.cashSession.findUnique({ where: { id: foreignCloseSessionId } })
      ).toMatchObject({ tenantId: tenantAId, status: "OPEN" });
      expect(await rawStoredClose(foreignCloseSessionId)).toEqual([
        {
          status: "OPEN",
          expected_amount: null,
          counted_amount: null,
          difference_amount: null,
        },
      ]);
      expect(await prisma.cashMovement.count({ where: { sessionId: foreignCloseSessionId } })).toBe(
        0
      );
    }, 30_000);
  });
});
