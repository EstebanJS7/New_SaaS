import { randomUUID } from "node:crypto";
import { TAX_RATE_SEEDS } from "@newsaas/database";
import { InMemoryStorageDriver } from "@newsaas/storage";

/**
 * In-memory Prisma BOUNDARY FAKE for the tenancy isolation harness.
 *
 * PrismaClient is a Proxy around runtime delegates, so `instanceof` checks are
 * meaningless by construction — a structural stub assigned over the
 * `PrismaService` DI token is indistinguishable from the real client to every
 * consumer (same seam proven by the auth integration suite). Delegate bodies
 * are intentionally sync (eslint require-await): awaiting plain values keeps
 * the runtime contract identical to the real async delegates.
 *
 * Scope discipline: ONLY the delegates the shipped surface actually touches
 * (staff sessions, memberships) plus the fixture-insert writes the harness
 * seeds with. Anything else failing loudly is a feature — it catches accidental
 * new data paths during review.
 *
 * NOTE ON CI TOPOLOGY: the quality job runs these suites against this boundary
 * fake; real-PostgreSQL behavior of the SCHEMA is proven separately by the
 * `migrations` job (`migrate deploy` on a fresh PG16 container). Together they
 * cover application-level scoping and persistence conventions without needing
 * a live PG inside the unit/integration runner.
 */

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
}

export interface UserProfileRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

/** Mirrors the temporal shape SessionService reads and refreshes (design D4). */
export interface StaffSessionRow {
  id: string;
  userProfileId: string;
  tokenHash: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface TenantMembershipRow {
  id: string;
  tenantId: string;
  userProfileId: string;
  roleId: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: Date;
}

/** Append-only audit row shape written by AuditWriter (design D9). */
export interface AuditLogRow {
  id: string;
  action: string;
  actorType: "STAFF" | "SYSTEM" | "PORTAL";
  metadata: Record<string, unknown>;
  tenantId?: string;
  actorUserProfileId?: string;
  /** PORTAL-attributed rows carry the holder; staff/system rows never do. */
  actorPortalAccessId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
}

export interface FeatureCodeRow {
  id: string;
  code: string;
}

export interface TenantEntitlementRow {
  id: string;
  tenantId: string;
  featureCodeId: string;
}

/** Permission catalog row (EPIC-02): key is the stable natural key. */
export interface PermissionRow {
  id: string;
  key: string;
  name: string;
}

/** Role↔permission mapping row (EPIC-02 enforcement data). */
export interface RolePermissionRow {
  id: string;
  roleId: string;
  permissionId: string;
}

/** Tenant-local override verdict over a global role's baseline key (DEC-003). */
export interface TenantRolePermissionOverrideRow {
  id: string;
  tenantId: string;
  roleId: string;
  permissionKey: string;
  granted: boolean;
}

/** Settings namespace row (EPIC-02 TenantSettingNamespace). */
export interface TenantSettingNamespaceRow {
  id: string;
  tenantId: string;
  namespace: string;
  schemaVersion: number;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant branding override row (EPIC-03 Phase B). */
export interface TenantBrandingRow {
  id: string;
  tenantId: string;
  schemaVersion: number;
  overrides: unknown;
  displayName: string | null;
  logoLightAssetId: string | null;
  logoDarkAssetId: string | null;
  faviconAssetId: string | null;
  updatedByUserProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-owned branding asset row (DEC-004 PR 1). */
export interface BrandingAssetRow {
  id: string;
  tenantId: string;
  kind: "LOGO_LIGHT" | "LOGO_DARK" | "FAVICON";
  assetKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedByUserProfileId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Durable branding-reset storage cleanup intent row (U5). */
export interface BrandingResetCleanupIntentRow {
  id: string;
  tenantId: string;
  resetAuditId: string | null;
  requestedByUserProfileId: string | null;
  storageKeys: string[];
  status: "PENDING" | "COMPLETED" | "DEAD_LETTER";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** Customer aggregate row (EPIC-04). */
export interface CustomerRow {
  id: string;
  tenantId: string;
  kind: "INDIVIDUAL" | "COMPANY";
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer address row (EPIC-04). */
export interface CustomerAddressRow {
  id: string;
  tenantId: string;
  customerId: string;
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Customer contact row (EPIC-04). */
export interface CustomerContactRow {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "EMAIL" | "PHONE";
  label: string | null;
  value: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** First-party Customer-linked portal holder row (EPIC-08 D1). */
export interface CustomerPortalAccessRow {
  id: string;
  tenantId: string;
  customerId: string;
  contactEmail: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Canonical-equality filter for portal `contactEmail`. Login reads with
 * Prisma's `mode: 'insensitive'` so case-variant rows resolve to the same
 * canonical identity; the fake must reproduce that or the ambiguity tests are a
 * lie. A plain string stays exact-match, exactly like Prisma's default.
 */
export type PortalContactEmailFilter = string | { equals: string; mode: "insensitive" };

/** 1:1 portal credential row (shared PK with the holder); RESTRICTED hash. */
export interface PortalCredentialRow {
  portalAccessId: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Portal session row (EPIC-08 D1); mirrors PortalSessionService's shape. */
export interface PortalSessionRow {
  id: string;
  portalAccessId: string;
  tokenHash: string;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** GLOBAL Species reference row (EPIC-05, Decision #2211: never tenant-scoped). */
export interface SpeciesRow {
  id: string;
  code: string;
  name: string;
}

/** GLOBAL Breed reference row; `(speciesId, code)` is the stable natural key. */
export interface BreedRow {
  id: string;
  speciesId: string;
  code: string;
  name: string;
}

/**
 * GLOBAL TaxRate reference row (EPIC-09 WU1/WU2); never tenant-scoped. `rate`
 * is an exact `Prisma.Decimal` in production; the fake stores the exact seed
 * literal so the read projection is deterministic.
 */
export interface TaxRateRow {
  id: string;
  code: string;
  name: string;
  rate: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-scoped CatalogItem row as the repository/read boundary sees it. */
export interface CatalogItemRow {
  id: string;
  tenantId: string;
  kind: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
  name: string;
  taxRateId: string;
  /** Exact decimal string (or null): never a JavaScript float. */
  referencePriceAmount: string | null;
  referencePriceCurrency: string | null;
  isActive: boolean;
  /** EPIC-10 stock dimension. Mirrors the schema default (`true`) when omitted. */
  tracksStock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped immutable stock ledger row (EPIC-10 W2). `quantity` is a SIGNED
 * exact decimal string — positive input, negative output — never a float, and
 * `reversesMovementId` stays null until the reversal slice ships.
 */
export interface StockMovementRow {
  id: string;
  tenantId: string;
  catalogItemId: string;
  /**
   * Ledger kinds shipped so far: EPIC-10 `ADJUSTMENT`, EPIC-11 `PURCHASE` and
   * EPIC-12 POS-003 `SALE` (the signed negative output a completion writes).
   */
  type: "ADJUSTMENT" | "PURCHASE" | "SALE";
  quantity: string;
  reason: string;
  reversesMovementId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped stock projection row (EPIC-10 W2): one per (tenant, item).
 * `quantity` is an exact NON-NEGATIVE decimal string under the fixed BLOCK
 * policy.
 */
export interface StockBalanceRow {
  id: string;
  tenantId: string;
  catalogItemId: string;
  quantity: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped supplier identity row (EPIC-11 W2). Data classification
 * (DEC-011): `name` is INTERNAL and the five optional identity/contact fields
 * are CONFIDENTIAL. This fake does NOT enforce the per-tenant `taxId` partial
 * unique index (an in-memory Map cannot), so the real index behavior is proven
 * by the W1 migration DDL checks and the live-PostgreSQL gate.
 */
export interface SupplierRow {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Lifecycle values pinned by schema enum `purchase_status` (PRD §17). */
export type PurchaseStatusRow = "DRAFT" | "RECEIVED" | "CANCELLED";

/**
 * Tenant-scoped purchase HEADER as the in-memory boundary stores it (EPIC-11
 * PUR-001). Lines live in {@link PurchaseLineRow} and are assembled onto the
 * read model by the delegates, mirroring the real `include: { lines: true }`
 * read. There is deliberately no number, code, total or tax field
 * (DEC-018/DEC-013).
 */
export interface PurchaseHeaderRow {
  id: string;
  tenantId: string;
  supplierId: string;
  status: PurchaseStatusRow;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped purchase line row. `quantity` is a strictly positive exact
 * `Decimal(10, 3)` and `unitCost` an optional informational `Decimal(14, 2)`,
 * both stored as exact decimal strings — never JavaScript floats.
 */
export interface PurchaseLineRow {
  id: string;
  tenantId: string;
  purchaseId: string;
  catalogItemId: string;
  quantity: string;
  unitCost: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Purchase read model WITH its line set (the `include: { lines: true }` shape). */
export interface PurchaseRow extends PurchaseHeaderRow {
  lines: PurchaseLineRow[];
}

/** Predicate fields the in-memory purchase reads/writes are allowed to build. */
export interface PurchaseWhere {
  id?: string;
  tenantId?: string;
  status?: PurchaseStatusRow;
}

/** Ordering clauses the in-memory purchase list accepts. */
export interface PurchaseOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/** Nested line create payload accepted by the in-memory `purchase.create`. */
export interface PurchaseLineCreateData {
  catalogItemId: string;
  quantity: string | { toString(): string };
  unitCost?: string | { toString(): string } | null;
}

/** Lifecycle values pinned by schema enum `sale_status` (PRD §18). */
export type SaleStatusRow = "DRAFT" | "COMPLETED" | "CANCELLED";

/**
 * Tenant-scoped sale HEADER as the in-memory boundary stores it (EPIC-12
 * POS-001). Lines live in {@link SaleLineRow} and are assembled onto the read
 * model by the delegates, mirroring the real `include: { lines: true }` read.
 * There is deliberately no number, discount, appointment, patient or total field
 * (DEC-021/DEC-027/DEC-028).
 *
 * HONEST LIMITATION: this fake cannot enforce the composite foreign keys or the
 * unique indexes of the `sale`/`sale_line` pair (an in-memory Map cannot), so the
 * composite ownership keys, the same-tenant customer/catalog-item references and
 * the one-line-per-item unique are proven by the W1 migration DDL checks and the
 * live-PostgreSQL gate, not here.
 */
export interface SaleHeaderRow {
  id: string;
  tenantId: string;
  customerId: string | null;
  currency: string;
  status: SaleStatusRow;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped sale line row. `quantity` is a strictly positive exact
 * `Decimal(10, 3)` and the four money amounts are exact `Decimal(14, 2)`, all
 * stored as exact decimal strings — never JavaScript floats. The row is the
 * frozen snapshot (DEC-021) recomputed on every draft write.
 */
export interface SaleLineRow {
  id: string;
  tenantId: string;
  saleId: string;
  catalogItemId: string;
  rateCode: string;
  unitPrice: string;
  quantity: string;
  lineTotal: string;
  taxableBase: string;
  taxAmount: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Sale read model WITH its line set (the `include: { lines: true }` shape). */
export interface SaleRow extends SaleHeaderRow {
  lines: SaleLineRow[];
}

/** Predicate fields the in-memory sale reads/writes are allowed to build. */
export interface SaleWhere {
  id?: string;
  tenantId?: string;
  status?: SaleStatusRow;
}

/** Ordering clauses the in-memory sale list accepts. */
export interface SaleOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/** Nested line create payload accepted by the in-memory `sale.create`. */
export interface SaleLineCreateData {
  catalogItemId: string;
  rateCode: string;
  unitPrice: string | { toString(): string };
  quantity: string | { toString(): string };
  lineTotal: string | { toString(): string };
  taxableBase: string | { toString(): string };
  taxAmount: string | { toString(): string };
}

/** Payment method values pinned by the `payment_method` enum (PRD §19, DEC-029). */
export type PaymentMethodRow = "CASH" | "CARD" | "BANK_TRANSFER" | "QR" | "CHECK" | "OTHER";

/**
 * Tenant-scoped payment row written by the POS-003 completion transaction (PRD
 * §19, DEC-029). `amount` is an exact positive `Decimal(14, 2)` stored as an
 * exact decimal string — never a JavaScript float. There is deliberately no
 * tendered amount, change or refunded amount.
 *
 * HONEST LIMITATION: this fake enforces no unique index and no composite foreign
 * key (an in-memory Map cannot), so the `(tenant_id, id)` ownership key, the
 * composite sale FK and the positive-amount CHECK are proven by the W1
 * migration DDL checks and the live-PostgreSQL gate, not here.
 */
export interface PaymentRow {
  id: string;
  tenantId: string;
  saleId: string;
  method: PaymentMethodRow;
  amount: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped idempotency record written by the POS-003 completion transaction
 * (DEC-024). It exists so an identical replay returns the prior result instead
 * of a `409`; `resultSaleId` references the completed sale rather than a stored
 * response snapshot, and `operation` is the stable `sale.complete` token.
 *
 * HONEST LIMITATION: this fake enforces no unique index (an in-memory Map
 * cannot), so the `(tenant_id, operation, key)` uniqueness and the composite
 * result-sale FK are proven by the W1 migration DDL checks and the
 * live-PostgreSQL gate. The service's replay short-circuit is exercised through
 * the pre-insert lookup, and its `P2002` -> replay recovery is exercised with an
 * injected error.
 */
export interface IdempotencyRecordRow {
  id: string;
  tenantId: string;
  operation: string;
  key: string;
  fingerprint: string;
  resultSaleId: string;
  createdAt: Date;
}

/** Lifecycle values pinned by schema enum `invoice_status` (PRD §21, DEC-038). */
export type InvoiceStatusRow = "DRAFT" | "CONFIRMED" | "CANCELLED";

/**
 * Tenant-scoped invoice HEADER as the in-memory boundary stores it (EPIC-14
 * BILL-001). Lines live in {@link InvoiceLineRow} and are assembled onto the
 * read model by the delegates, mirroring the real `include: { lines: ... }`
 * read. `number`/`confirmedAt` are nullable and agree by the schema's
 * `number iff confirmed` rule, and `cancelReason` is present exactly for a
 * `CANCELLED` invoice (DEC-039, DEC-043).
 *
 * HONEST LIMITATION: this fake enforces the TWO unique indexes the BILL-002
 * suite asserts — the PARTIAL `invoice_tenant_id_sale_id_key` on
 * `(tenantId, saleId) WHERE status <> 'CANCELLED'` and the allocation key
 * `invoice_tenant_id_series_number_key` on `(tenantId, series, number)` — plus
 * the per-invoice line position key. Every OTHER database property (the
 * composite foreign keys, the CHECK constraints, the conditional header
 * immutability triggers and the never-reallocated-number trigger) stays
 * live-PostgreSQL-owned, exactly like the sale/payment/ledger boundaries.
 */
export interface InvoiceHeaderRow {
  id: string;
  tenantId: string;
  saleId: string;
  customerId: string | null;
  currency: string;
  status: InvoiceStatusRow;
  series: string;
  number: number | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped invoice line row (EPIC-14 BILL-001). The four money amounts are
 * exact `Decimal(14, 2)` and `quantity` an exact `Decimal(10, 3)`, all stored as
 * exact decimal STRINGS — never JavaScript floats, following the `saleLines`
 * convention. `position` is the invoice-local reading order and the row is the
 * frozen snapshot (DEC-038) copied from the source sale line. There is
 * deliberately NO `updatedAt`: the line is append-only.
 */
export interface InvoiceLineRow {
  id: string;
  tenantId: string;
  invoiceId: string;
  catalogItemId: string;
  position: number;
  description: string;
  rateCode: string;
  unitPrice: string;
  quantity: string;
  lineTotal: string;
  taxableBase: string;
  taxAmount: string;
  createdAt: Date;
}

/** Invoice read model WITH its line set (the `include: { lines: ... }` shape). */
export interface InvoiceRow extends InvoiceHeaderRow {
  lines: InvoiceLineRow[];
}

/** Predicate fields the in-memory invoice reads/writes are allowed to build. */
export interface InvoiceWhere {
  id?: string;
  tenantId?: string;
  status?: InvoiceStatusRow;
}

/** Ordering clauses the in-memory invoice list accepts. */
export interface InvoiceOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/**
 * The line-relation `include` the Billing read boundary nests. `true` reads the
 * document in its defined reading order; the object form mirrors the explicit
 * `orderBy: { position: 'asc' }` a repository may declare.
 */
export interface InvoiceLinesInclude {
  lines?: true | { orderBy?: { position?: "asc" | "desc" } };
}

/** Nested line create payload accepted by the in-memory `invoice.create`. */
export interface InvoiceLineCreateData {
  catalogItemId: string;
  position: number;
  description: string;
  rateCode: string;
  unitPrice: string | { toString(): string };
  quantity: string | { toString(): string };
  lineTotal: string | { toString(): string };
  taxableBase: string | { toString(): string };
  taxAmount: string | { toString(): string };
}

/**
 * Tenant-scoped numbering counter row (EPIC-14 BILL-001, DEC-039): one row per
 * `(tenant, series)` whose `nextValue` is the next number to allocate. Unlike
 * every other row in this boundary it is MEANT to be updated (no trigger), so it
 * carries `updatedAt`.
 */
export interface InvoiceNumberSequenceRow {
  id: string;
  tenantId: string;
  series: string;
  nextValue: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Sequence write payload; `nextValue` may be an atomic increment (DEC-039). */
export interface InvoiceNumberSequenceUpdateData {
  nextValue?: number | { increment: number };
}

/**
 * Compound-key predicate for the counter. Both the named compound key
 * (`tenantId_series`) and the extended-where shorthand are accepted, mirroring
 * the shapes a Prisma caller may build.
 */
export type InvoiceNumberSequenceWhere =
  { tenantId_series: { tenantId: string; series: string } } | { tenantId: string; series: string };

/**
 * Tenant-scoped cash register as the in-memory boundary stores it (EPIC-12
 * POS-002). There is no balance column: the register's expected amount is
 * derived from the immutable movement ledger, and no `branchId` exists
 * (DEC-020).
 *
 * HONEST LIMITATION: this fake enforces no unique index and no composite
 * foreign key (an in-memory Map cannot), so the per-tenant register-name unique
 * and the composite tenant-ownership keys are proven by the W1 migration DDL
 * checks and the live-PostgreSQL gate (C3), not here.
 */
export interface CashRegisterRow {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped cash session as the in-memory boundary stores it. The status
 * follows the `cash_session_status` enum; `openingAmount` is an exact
 * `Decimal(14, 2)` stored as an exact decimal string — never a JavaScript
 * float.
 *
 * HONEST LIMITATION: this fake enforces no unique index and no composite
 * foreign key, so the partial one-OPEN-session rule
 * (`cash_session_one_open_per_register_key`), the composite register FK and the
 * composite membership FK on the opener are proven by the W1 migration DDL
 * checks and the live-PostgreSQL gate (C3), not here. The service's `P2002` ->
 * `409` translation is exercised with an injected error instead.
 */
export interface CashSessionRow {
  id: string;
  tenantId: string;
  registerId: string;
  status: "OPEN" | "CLOSED";
  openedAt: Date;
  openedByMembershipId: string;
  openingAmount: string;
  /** Server-computed expected amount; `null` while the session is `OPEN` (DEC-031). */
  expectedAmount: string | null;
  /** Operator-counted amount; `null` while the session is `OPEN` (DEC-031). */
  countedAmount: string | null;
  /** `countedAmount - expectedAmount`, may be negative; `null` while `OPEN` (DEC-031). */
  differenceAmount: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Immutable cash movement row as the in-memory boundary stores it (EPIC-12
 * POS-002, extended by EPIC-13 CASH-002). The table is MODELLED so the inertness
 * probe can diff it: POS-003 appends the `SALE` movement inside the CompleteSale
 * transaction and the CASH-002 command appends the six standalone kinds.
 * `direction` is non-null exactly for an `ADJUSTMENT` — the fake stores the
 * value it is given and, like every other CHECK constraint, does NOT enforce the
 * database's exclusive `cash_movement_direction_required` rule, which is why the
 * request contract and the service re-assert it.
 */
export interface CashMovementRow {
  id: string;
  tenantId: string;
  registerId: string;
  sessionId: string;
  type: "SALE" | "REFUND" | "INCOME" | "EXPENSE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT";
  direction: "INCREASE" | "DECREASE" | null;
  amount: string;
  reason: string | null;
  createdAt: Date;
}

/** Predicate fields the in-memory register reads/writes are allowed to build. */
export interface CashRegisterWhere {
  id?: string;
  tenantId?: string;
}

/** Predicate fields the in-memory session reads/writes are allowed to build. */
export interface CashSessionWhere {
  id?: string;
  tenantId?: string;
  status?: CashSessionRow["status"];
}

/** Ordering clauses the in-memory cash lists accept. */
export interface CashOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/** Register create payload accepted by the in-memory `cashRegister.create`. */
export interface CashRegisterCreateData {
  name: string;
}

/** Session create payload accepted by the in-memory `cashSession.create`. */
export interface CashSessionCreateData {
  registerId: string;
  openedByMembershipId: string;
  openingAmount: string | { toString(): string };
  status?: CashSessionRow["status"];
}

/**
 * Stable ids for the three GLOBAL seeded rates, so HTTP suites can address a
 * rate without a lookup. The codes/names/rates mirror `TAX_RATE_SEEDS` from
 * `@newsaas/database`, which the real seed writes into `tax_rate`.
 */
export const SEEDED_TAX_RATE_IDS = Object.freeze({
  EXEMPT: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f601",
  IVA_5: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f602",
  IVA_10: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f603",
} as const);

/** The three seeded GLOBAL rates, ready for the in-memory `taxRate` table. */
export const SEEDED_TAX_RATES: readonly TaxRateRow[] = TAX_RATE_SEEDS.map((seed) => ({
  id: SEEDED_TAX_RATE_IDS[seed.code],
  code: seed.code,
  name: seed.name,
  rate: seed.rate,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
}));

/** Tenant-scoped Patient identity row (EPIC-05). */
export interface PatientRow {
  id: string;
  tenantId: string;
  name: string;
  speciesId: string;
  breedId: string | null;
  sex: "MALE" | "FEMALE" | "UNKNOWN";
  birthDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-scoped Patient↔Customer guardian link row (EPIC-05). */
export interface PatientGuardianRow {
  id: string;
  tenantId: string;
  patientId: string;
  customerId: string;
  isPrimary: boolean;
  isActive: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Scalar/optional Prisma filter over PatientGuardian (mirrors the service). */
export interface PatientGuardianWhere {
  id?: string;
  tenantId: string;
  patientId: string;
  customerId?: string;
  isPrimary?: boolean;
  isActive?: boolean;
}

/**
 * Tenant-scoped ClinicalEncounter row (EPIC-06). `internalNotes` is staff-only:
 * the portal read boundary must project it away, so the fake intentionally
 * returns it to make an allowlist regression fail loudly.
 */
export interface ClinicalEncounterRow {
  id: string;
  tenantId: string;
  patientId: string;
  status: "DRAFT" | "CLOSED";
  clientSummary: string | null;
  internalNotes: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-scoped ClinicalVaccination row (EPIC-06). */
export interface ClinicalVaccinationRow {
  id: string;
  tenantId: string;
  patientId: string;
  vaccine: string;
  administeredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Tenant-scoped Branch row (EPIC-07 scheduling anchor; branch admin stays out of scope). */
export interface BranchRow {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Appointment lifecycle states pinned by the EPIC-07 spec. */
export type AppointmentStatusRow =
  "SCHEDULED" | "CONFIRMED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/** Appointment provenance (EPIC-08 D4); staff rows default to STAFF. */
export type AppointmentSourceRow = "STAFF" | "PORTAL";

/** Tenant-scoped Appointment row as the scheduling boundary reads it. */
export interface AppointmentRow {
  id: string;
  tenantId: string;
  branchId: string;
  patientId: string;
  professionalMembershipId: string;
  status: AppointmentStatusRow;
  /** Provenance; staff/fixture inserts that omit it land on the schema default. */
  source: AppointmentSourceRow;
  /**
   * Provenance link to the Portal booking request this appointment fulfils.
   * `null` for staff-created rows, exactly like the nullable schema column.
   */
  portalBookingRequestId: string | null;
  /**
   * OPTIONAL Catalog SERVICE reference (EPIC-09 WU4). Mirrors the nullable
   * `service_id` column: `null` when no service is attached, exactly like the
   * schema (existing and portal rows never gain one).
   */
  serviceId: string | null;
  version: number;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Scalar/optional Prisma filter over Appointment (mirrors the service shapes). */
export interface AppointmentWhere {
  id?: string | { not: string };
  tenantId?: string;
  branchId?: string;
  /** Scalar or `{ in: [...] }` — the portal read lists appointments per pet set. */
  patientId?: string | { in: string[] };
  /** Scalar or `{ in: [...] }` — the portal availability read fetches every candidate professional at once. */
  professionalMembershipId?: string | { in: string[] };
  /** Scalar or `{ in: [...] }` — mirrors the Prisma filter shapes we use. */
  status?: AppointmentStatusRow | { in: AppointmentStatusRow[] };
  /** Provenance link: the approval idempotency pre-check filters on this. */
  portalBookingRequestId?: string;
  /** OPTIONAL Catalog SERVICE filter (EPIC-09 WU4); omitted adds no predicate. */
  serviceId?: string;
  version?: number;
  /** Overlap predicate: existing.startAt < candidate.endAt. */
  startAt?: { lt: Date };
  /** Overlap predicate: existing.endAt > candidate.startAt. */
  endAt?: { gt: Date };
}

/** Appointment write payload; `version` may be an increment (optimistic guard). */
export interface AppointmentUpdateData {
  status?: AppointmentStatusRow;
  version?: number | { increment: number };
  startAt?: Date;
  endAt?: Date;
  /** Omitted leaves the reference untouched; `null` clears it (EPIC-09 WU4). */
  serviceId?: string | null;
}

/**
 * Tenant-scoped PortalBookingRequest row (EPIC-08 WU4A): a holder-submitted
 * request that staff must decide on. `status` defaults to PENDING, mirroring
 * the schema default.
 */
export interface PortalBookingRequestRow {
  id: string;
  tenantId: string;
  customerId: string;
  patientId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Scalar/optional Prisma filter over PortalBookingRequest (mirrors the service). */
export interface PortalBookingRequestWhere {
  id?: string;
  tenantId?: string;
  customerId?: string;
  patientId?: string;
  status?: PortalBookingRequestRow["status"] | { in: PortalBookingRequestRow["status"][] };
}

interface MembershipWhere {
  id?: string;
  tenantId?: string;
  userProfileId?: string;
  status?: string;
  /** Scalar or `{ in: [...] }` — mirrors the Prisma filter shapes we use. */
  roleId?: string | { in?: string[] };
  /** Role-code predicate used by the scheduling professional options lookup. */
  role?: { code: string };
}

interface MembershipOrder {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
}

/**
 * Scalar/`{ not }` filter over Customer child rows (EPIC-08 WU4C). The portal
 * profile boundary demotes the holder's sibling PHONE rows with ONE set-based
 * `updateMany`, so the fake must reproduce a filter-shaped (not id-keyed)
 * where clause the way the real delegate does.
 */
interface CustomerContactWhere {
  id?: string | { not: string };
  tenantId?: string;
  customerId?: string;
  isActive?: boolean;
  kind?: "EMAIL" | "PHONE";
  isPrimary?: boolean;
}

export interface IsolationDatabase {
  prisma: {
    $transaction: <T>(callback: (tx: IsolationDatabase["prisma"]) => Promise<T>) => Promise<T>;
    /**
     * Raw-SQL seam for SELECT ... FOR UPDATE row locks and advisory locks
     * (review CRITICAL-2, extended by EPIC-11 PUR-002). The shipped surface
     * issues a small, closed set of shapes — the tenant-wide active-membership
     * lock, the purchase header row lock and `pg_advisory_xact_lock` — matched
     * here by their text; anything else fails loudly instead of silently
     * returning wrong rows (or wrong-shaped rows).
     *
     * HONEST LIMITATION (documented in TD-006): a synchronous in-memory map
     * CANNOT prove interleaving/serialization semantics of real READ
     * COMMITTED PostgreSQL; this delegate only proves WHICH rows the decision
     * reads. Live-PG proof remains TD-006's evidence gate.
     */
    $queryRaw: (query: TemplateStringsArray | string, ...values: unknown[]) => Promise<unknown[]>;
    tenant: {
      create: (args: {
        data: { slug: string; name: string; status?: "ACTIVE" | "SUSPENDED" };
      }) => TenantRow;
      findUnique: (args: {
        where: { id?: string; slug?: string; status?: "ACTIVE" | "SUSPENDED" };
      }) => TenantRow | null;
    };
    tenantBranding: {
      findUnique: (args: { where: { tenantId: string } }) => TenantBrandingRow | null;
      upsert: (args: {
        where: { tenantId: string };
        create: Omit<TenantBrandingRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<Omit<TenantBrandingRow, "id" | "tenantId" | "createdAt">>;
      }) => TenantBrandingRow;
      update: (args: {
        where: { tenantId: string };
        data: Partial<Omit<TenantBrandingRow, "id" | "tenantId" | "createdAt">>;
      }) => TenantBrandingRow;
      delete: (args: { where: { tenantId: string } }) => TenantBrandingRow;
    };
    brandingAsset: {
      create: (args: {
        data: Omit<BrandingAssetRow, "id" | "createdAt" | "updatedAt">;
      }) => BrandingAssetRow;
      findUnique: (args: { where: { id: string } }) => BrandingAssetRow | null;
      findFirst: (args: { where: { tenantId: string; kind: string } }) => BrandingAssetRow | null;
      findMany: (args: { where: { tenantId: string } }) => BrandingAssetRow[];
      delete: (args: { where: { id: string } }) => BrandingAssetRow;
    };
    brandingResetCleanupIntent: {
      create: (args: {
        data: {
          tenantId: string;
          resetAuditId?: string | null;
          requestedByUserProfileId?: string | null;
          storageKeys: string[];
          status?: BrandingResetCleanupIntentRow["status"];
          attempts?: number;
        };
      }) => BrandingResetCleanupIntentRow;
      findMany: (args?: {
        where?: { tenantId?: string; status?: BrandingResetCleanupIntentRow["status"] };
      }) => BrandingResetCleanupIntentRow[];
    };
    customer: {
      findMany: (args: {
        where: { tenantId: string; isActive?: boolean };
        orderBy?: { displayName?: "asc" | "desc" };
      }) => CustomerRow[];
      findFirst: (args: { where: { id: string; tenantId: string } }) => CustomerRow | null;
      findUnique: (args: { where: { id: string } }) => CustomerRow | null;
      create: (args: { data: Omit<CustomerRow, "id" | "createdAt" | "updatedAt"> }) => CustomerRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; isActive?: boolean };
        data: Partial<Omit<CustomerRow, "id" | "tenantId" | "createdAt">>;
      }) => { count: number };
    };
    customerAddress: {
      findMany: (args: {
        where: { tenantId: string; customerId: string; isActive?: boolean };
        orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
        take?: number;
      }) => CustomerAddressRow[];
      findFirst: (args: {
        where: { id: string; tenantId: string; customerId: string };
      }) => CustomerAddressRow | null;
      findUnique: (args: { where: { id: string } }) => CustomerAddressRow | null;
      create: (args: {
        data: Omit<CustomerAddressRow, "id" | "createdAt" | "updatedAt"> & {
          createdAt?: Date;
          updatedAt?: Date;
        };
      }) => CustomerAddressRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; customerId: string; isActive?: boolean };
        data: Partial<Omit<CustomerAddressRow, "id" | "tenantId" | "customerId" | "createdAt">>;
      }) => { count: number };
    };
    customerContact: {
      findMany: (args: {
        where: {
          tenantId: string;
          customerId: string;
          isActive?: boolean;
          kind?: "EMAIL" | "PHONE";
          isPrimary?: boolean;
        };
        orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
        take?: number;
      }) => CustomerContactRow[];
      findFirst: (args: {
        where: { id: string; tenantId: string; customerId: string };
      }) => CustomerContactRow | null;
      findUnique: (args: { where: { id: string } }) => CustomerContactRow | null;
      create: (args: {
        data: Omit<CustomerContactRow, "id" | "createdAt" | "updatedAt"> & {
          createdAt?: Date;
          updatedAt?: Date;
        };
      }) => CustomerContactRow;
      updateMany: (args: {
        where: CustomerContactWhere;
        data: Partial<Omit<CustomerContactRow, "id" | "tenantId" | "customerId" | "createdAt">>;
      }) => { count: number };
    };
    customerPortalAccess: {
      create: (args: {
        data: { tenantId: string; customerId: string; contactEmail: string; status: string };
      }) => CustomerPortalAccessRow;
      findUnique: (args: {
        where: { id: string };
        select?: unknown;
      }) => CustomerPortalAccessRow | null;
      /** Reproduces the `credential` join the portal login read selects. */
      findFirst: (args: {
        where: {
          id?: string;
          tenantId: string;
          customerId?: string;
          contactEmail?: PortalContactEmailFilter;
          status?: string;
        };
        select?: unknown;
      }) => (CustomerPortalAccessRow & { credential?: { passwordHash: string } | null }) | null;
      /**
       * Multi-row login read used to fail closed on an ambiguous login identity.
       * NOTE: this fake does NOT enforce the partial unique indexes (an in-memory
       * Map cannot), so a test CAN seed two ACTIVE holders sharing a contactEmail
       * and prove the service fails closed. Real index behavior is proven by the
       * migration DDL checks and the live-PostgreSQL gate.
       */
      findMany: (args: {
        where: {
          id?: string;
          tenantId: string;
          customerId?: string;
          contactEmail?: PortalContactEmailFilter;
          status?: string;
        };
        orderBy?: { id?: "asc" | "desc" };
        take?: number;
        select?: unknown;
      }) => (CustomerPortalAccessRow & { credential?: { passwordHash: string } | null })[];
      updateMany: (args: {
        where: { id: string; tenantId: string; status?: string };
        data: { status?: string };
      }) => { count: number };
    };
    portalCredential: {
      create: (args: {
        data: { portalAccessId: string; passwordHash: string };
      }) => PortalCredentialRow;
      findUnique: (args: { where: { portalAccessId: string } }) => PortalCredentialRow | null;
    };
    portalSession: {
      create: (args: {
        data: {
          portalAccessId: string;
          tokenHash: string;
          lastSeenAt: Date;
          idleExpiresAt: Date;
          absoluteExpiresAt: Date;
        };
      }) => PortalSessionRow;
      findUnique: (args: { where: { tokenHash: string } }) => PortalSessionRow | null;
      update: (args: {
        where: { id: string };
        data: Partial<PortalSessionRow>;
      }) => PortalSessionRow;
      updateMany: (args: {
        where: { tokenHash?: string; portalAccessId?: string; revokedAt?: null };
        data: { revokedAt: Date };
      }) => { count: number };
    };
    species: {
      create: (args: { data: { code: string; name: string } }) => SpeciesRow;
      findFirst: (args: { where: { id: string }; select?: { id: true } }) => SpeciesRow | null;
      /** Global, tenant-agnostic read; `include.breeds` reproduces the relation. */
      findMany: (args?: {
        orderBy?: { name?: "asc" | "desc" };
        include?: { breeds?: unknown };
      }) => (SpeciesRow & { breeds?: BreedRow[] })[];
    };
    breed: {
      create: (args: { data: { speciesId: string; code: string; name: string } }) => BreedRow;
      findFirst: (args: {
        where: { id: string; speciesId: string };
        select?: { id: true };
      }) => BreedRow | null;
    };
    taxRate: {
      /** GLOBAL catalog read: NO tenant predicate (EPIC-09 WU2). */
      findMany: (args?: { orderBy?: { code?: "asc" | "desc" } }) => TaxRateRow[];
      /**
       * Global rate lookup by id (the write path's FK validation seam) or by the
       * frozen stable `code` (the POS-003 completion snapshot recompute).
       */
      findFirst: (args: { where: { id?: string; code?: string } }) => TaxRateRow | null;
    };
    catalogItem: {
      findMany: (args: {
        where: {
          tenantId: string;
          kind?: CatalogItemRow["kind"];
          isActive?: boolean;
          /** Batched identity read for the appointment projection (EPIC-09 WU4). */
          id?: { in: string[] };
        };
        orderBy?: readonly { name?: "asc" | "desc"; id?: "asc" | "desc" }[];
      }) => CatalogItemRow[];
      findFirst: (args: { where: { id: string; tenantId: string } }) => CatalogItemRow | null;
      create: (args: {
        data: {
          tenantId: string;
          kind: CatalogItemRow["kind"];
          name: string;
          taxRateId: string;
          referencePriceAmount?: string | { toString(): string } | null;
          referencePriceCurrency?: string | null;
          isActive?: boolean;
          /** EPIC-10 stock dimension; omitted mirrors the schema default `true`. */
          tracksStock?: boolean;
        };
      }) => CatalogItemRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; isActive?: boolean };
        data: {
          kind?: CatalogItemRow["kind"];
          name?: string;
          taxRateId?: string;
          referencePriceAmount?: string | { toString(): string } | null;
          referencePriceCurrency?: string | null;
          isActive?: boolean;
          tracksStock?: boolean;
        };
      }) => { count: number };
    };
    supplier: {
      findMany: (args: {
        where: { tenantId: string; isActive?: boolean };
        orderBy?: readonly { name?: "asc" | "desc"; id?: "asc" | "desc" }[];
      }) => SupplierRow[];
      findFirst: (args: { where: { id: string; tenantId: string } }) => SupplierRow | null;
      create: (args: {
        data: {
          tenantId: string;
          name: string;
          legalName?: string | null;
          taxId?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          isActive?: boolean;
        };
      }) => SupplierRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; isActive?: boolean };
        data: {
          name?: string;
          legalName?: string | null;
          taxId?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          isActive?: boolean;
        };
      }) => { count: number };
    };
    purchase: {
      /** Reads assemble the line set, mirroring `include: { lines: true }`. */
      findFirst: (args: { where: PurchaseWhere; include?: { lines?: true } }) => PurchaseRow | null;
      findMany: (args: {
        where: PurchaseWhere;
        include?: { lines?: true };
        orderBy?: readonly PurchaseOrderBy[];
      }) => PurchaseRow[];
      /** Nested line create; the fake fills tenant/purchase ids from the header. */
      create: (args: {
        data: {
          tenantId: string;
          supplierId: string;
          status?: PurchaseStatusRow;
          lines: { create: readonly PurchaseLineCreateData[] };
        };
      }) => PurchaseRow;
      updateMany: (args: {
        where: PurchaseWhere;
        data: { supplierId?: string; status?: PurchaseStatusRow };
      }) => { count: number };
    };
    purchaseLine: {
      deleteMany: (args: {
        where: { tenantId: string; purchaseId: string; catalogItemId: { notIn: string[] } };
      }) => { count: number };
      upsert: (args: {
        where: {
          tenantId_purchaseId_catalogItemId: {
            tenantId: string;
            purchaseId: string;
            catalogItemId: string;
          };
        };
        create: PurchaseLineCreateData & { tenantId: string; purchaseId: string };
        update: {
          quantity: string | { toString(): string };
          unitCost?: string | { toString(): string } | null;
        };
      }) => PurchaseLineRow;
    };
    sale: {
      /** Reads assemble the line set, mirroring `include: { lines: true }`. */
      findFirst: (args: { where: SaleWhere; include?: { lines?: true } }) => SaleRow | null;
      findMany: (args: {
        where: SaleWhere;
        include?: { lines?: true };
        orderBy?: readonly SaleOrderBy[];
      }) => SaleRow[];
      /** Nested line create; the fake fills tenant/sale ids from the header. */
      create: (args: {
        data: {
          tenantId: string;
          customerId?: string | null;
          currency: string;
          status?: SaleStatusRow;
          lines: { create: readonly SaleLineCreateData[] };
        };
      }) => SaleRow;
      updateMany: (args: {
        where: SaleWhere;
        data: { customerId?: string | null; status?: SaleStatusRow };
      }) => { count: number };
    };
    saleLine: {
      deleteMany: (args: {
        where: { tenantId: string; saleId: string; catalogItemId: { notIn: string[] } };
      }) => { count: number };
      upsert: (args: {
        where: {
          tenantId_saleId_catalogItemId: {
            tenantId: string;
            saleId: string;
            catalogItemId: string;
          };
        };
        create: SaleLineCreateData & { tenantId: string; saleId: string };
        update: Omit<SaleLineCreateData, "catalogItemId">;
      }) => SaleLineRow;
      /**
       * Completion snapshot write (POS-003): updates the three derived amounts
       * on the line matching `(tenantId, saleId, catalogItemId)` and returns the
       * affected-row count, mirroring the real tenant-scoped `updateMany`.
       */
      updateMany: (args: {
        where: { tenantId: string; saleId: string; catalogItemId: string };
        data: {
          lineTotal: string | { toString(): string };
          taxableBase: string | { toString(): string };
          taxAmount: string | { toString(): string };
        };
      }) => { count: number };
    };
    payment: {
      create: (args: {
        data: {
          tenantId: string;
          saleId: string;
          method: PaymentMethodRow;
          amount: string | { toString(): string };
        };
      }) => PaymentRow;
      findMany: (args: {
        where: { tenantId: string; saleId: string };
        orderBy?: readonly CashOrderBy[];
      }) => PaymentRow[];
    };
    idempotencyRecord: {
      findFirst: (args: {
        where: { tenantId: string; operation: string; key: string };
      }) => IdempotencyRecordRow | null;
      create: (args: {
        data: {
          tenantId: string;
          operation: string;
          key: string;
          fingerprint: string;
          resultSaleId: string;
        };
      }) => IdempotencyRecordRow;
    };
    /**
     * Invoice header reads/writes (EPIC-14 BILL-002). Reads assemble the line set,
     * mirroring the repository's `include: { lines: ... }`; `create` nests the
     * frozen snapshot lines and reproduces the two unique indexes the suite
     * asserts. There is deliberately NO `update`/`delete`: the header lifecycle
     * has its own commands (BILL-003) and a cancelled invoice is terminal.
     */
    invoice: {
      findFirst: (args: {
        where: InvoiceWhere;
        include?: InvoiceLinesInclude;
      }) => InvoiceRow | null;
      findMany: (args: {
        where: InvoiceWhere;
        include?: InvoiceLinesInclude;
        orderBy?: readonly InvoiceOrderBy[];
      }) => InvoiceRow[];
      /** Nested line create; the fake fills tenant/invoice ids from the header. */
      create: (args: {
        data: {
          tenantId: string;
          saleId: string;
          customerId?: string | null;
          currency: string;
          status?: InvoiceStatusRow;
          series?: string;
          number?: number | null;
          confirmedAt?: Date | null;
          cancelledAt?: Date | null;
          cancelReason?: string | null;
          lines: { create: readonly InvoiceLineCreateData[] };
        };
      }) => InvoiceRow;
      /** Tenant/status-filtered list count for the paginated read. */
      count: (args?: { where?: InvoiceWhere }) => number;
    };
    /**
     * Numbering counter the confirm transaction advances (DEC-039). Present now
     * so BILL-003 does not have to reopen the boundary; BILL-002 writes no row.
     */
    invoiceNumberSequence: {
      findUnique: (args: { where: InvoiceNumberSequenceWhere }) => InvoiceNumberSequenceRow | null;
      upsert: (args: {
        where: InvoiceNumberSequenceWhere;
        create: { tenantId: string; series?: string; nextValue?: number };
        update: InvoiceNumberSequenceUpdateData;
      }) => InvoiceNumberSequenceRow;
      update: (args: {
        where: InvoiceNumberSequenceWhere;
        data: InvoiceNumberSequenceUpdateData;
      }) => InvoiceNumberSequenceRow;
    };
    cashRegister: {
      findFirst: (args: { where: CashRegisterWhere }) => CashRegisterRow | null;
      findMany: (args: {
        where: CashRegisterWhere;
        orderBy?: readonly CashOrderBy[];
      }) => CashRegisterRow[];
      create: (args: { data: CashRegisterCreateData & { tenantId: string } }) => CashRegisterRow;
    };
    cashSession: {
      findFirst: (args: { where: CashSessionWhere }) => CashSessionRow | null;
      findMany: (args: {
        where: CashSessionWhere;
        orderBy?: readonly CashOrderBy[];
      }) => CashSessionRow[];
      create: (args: { data: CashSessionCreateData & { tenantId: string } }) => CashSessionRow;
      /**
       * Conditional close write (EPIC-13 CASH-003): matches the STORED `status`
       * in `where`, writes `CLOSED` plus the three close amounts and reports how
       * many rows it touched, so the service's lost-race `409` is exercisable.
       */
      updateMany: (args: {
        where: CashSessionWhere;
        data: {
          status?: CashSessionRow["status"];
          expectedAmount?: string | { toString(): string };
          countedAmount?: string | { toString(): string };
          differenceAmount?: string | { toString(): string };
        };
      }) => { count: number };
    };
    /**
     * Movement append/read, mirroring the real delegate so the inertness probe
     * can diff the table. POS-003 writes the `SALE` movement inside the
     * CompleteSale transaction and the CASH-002 command appends the six
     * standalone kinds.
     */
    cashMovement: {
      create: (args: {
        data: {
          tenantId: string;
          registerId: string;
          sessionId: string;
          type: CashMovementRow["type"];
          amount: string | { toString(): string };
          reason?: string | null;
          direction?: CashMovementRow["direction"];
          id?: string;
        };
      }) => CashMovementRow;
      findUnique: (args: { where: { id: string } }) => CashMovementRow | null;
      findMany: (args: {
        where: { tenantId: string; registerId?: string; sessionId?: string };
        orderBy?: readonly CashOrderBy[];
      }) => CashMovementRow[];
    };
    stockMovement: {
      /**
       * Ledger append. The ONLY mutation: there is no update and no delete on
       * this delegate, mirroring the schema's immutability trigger.
       */
      create: (args: {
        data: {
          tenantId: string;
          catalogItemId: string;
          type: StockMovementRow["type"];
          quantity: string | { toString(): string };
          reason: string;
          reversesMovementId?: string | null;
        };
      }) => StockMovementRow;
      findMany: (args: {
        where: { tenantId: string; catalogItemId?: string };
        orderBy?: readonly {
          createdAt?: "asc" | "desc";
          id?: "asc" | "desc";
        }[];
      }) => StockMovementRow[];
    };
    stockBalance: {
      findFirst: (args: {
        where: { tenantId: string; catalogItemId: string };
      }) => StockBalanceRow | null;
      findMany: (args: {
        where: { tenantId: string };
        orderBy?: readonly { catalogItemId?: "asc" | "desc"; id?: "asc" | "desc" }[];
      }) => StockBalanceRow[];
      /** Compound-unique upsert on `(tenantId, catalogItemId)` (one row per pair). */
      upsert: (args: {
        where: { tenantId_catalogItemId: { tenantId: string; catalogItemId: string } };
        create: {
          tenantId: string;
          catalogItemId: string;
          quantity: string | { toString(): string };
        };
        update: { quantity: string | { toString(): string } };
      }) => StockBalanceRow;
    };
    patient: {
      findMany: (args: {
        // `id.in` mirrors the portal read's holder-owned pet id set.
        where: { tenantId: string; isActive?: boolean; id?: { in: string[] } };
        orderBy?: { name?: "asc" | "desc" };
      }) => PatientRow[];
      findFirst: (args: { where: { id: string; tenantId: string } }) => PatientRow | null;
      create: (args: {
        data: {
          tenantId: string;
          name: string;
          speciesId: string;
          breedId: string | null;
          sex: "MALE" | "FEMALE" | "UNKNOWN";
          birthDate: Date | null;
          isActive: boolean;
        };
      }) => PatientRow;
      updateMany: (args: {
        where: { id: string; tenantId: string; isActive?: boolean };
        data: {
          name?: string;
          speciesId?: string;
          breedId?: string | null;
          sex?: "MALE" | "FEMALE" | "UNKNOWN";
          birthDate?: Date | null;
          isActive?: boolean;
        };
      }) => { count: number };
    };
    patientGuardian: {
      findMany: (args: {
        // `patientId` is optional: the portal read lists a Customer's links.
        where: { tenantId: string; patientId?: string; customerId?: string; isActive?: boolean };
        orderBy?: { position?: "asc" | "desc" };
      }) => PatientGuardianRow[];
      findFirst: (args: { where: PatientGuardianWhere }) => PatientGuardianRow | null;
      create: (args: {
        data: {
          tenantId: string;
          patientId: string;
          customerId: string;
          isPrimary: boolean;
          isActive: boolean;
          position: number;
        };
      }) => PatientGuardianRow;
      updateMany: (args: {
        where: PatientGuardianWhere;
        data: { isPrimary?: boolean; isActive?: boolean; position?: number };
      }) => { count: number };
    };
    clinicalEncounter: {
      create: (args: {
        data: {
          tenantId: string;
          patientId: string;
          status?: "DRAFT" | "CLOSED";
          clientSummary?: string | null;
          internalNotes?: string | null;
          closedAt?: Date | null;
        };
      }) => ClinicalEncounterRow;
      /** `select` is accepted but NOT enforced: the caller's projection is under test. */
      findMany: (args: {
        where: { tenantId: string; patientId: string };
        select?: unknown;
      }) => ClinicalEncounterRow[];
    };
    clinicalVaccination: {
      create: (args: {
        data: {
          tenantId: string;
          patientId: string;
          vaccine: string;
          administeredAt: Date;
        };
      }) => ClinicalVaccinationRow;
      findMany: (args: {
        where: { tenantId: string; patientId: string };
        select?: unknown;
      }) => ClinicalVaccinationRow[];
    };
    branch: {
      create: (args: { data: { tenantId: string; name: string } }) => BranchRow;
      findFirst: (args: { where: { id: string; tenantId: string } }) => BranchRow | null;
      findMany: (args: {
        where: { tenantId: string };
        orderBy?: { name?: "asc" | "desc" };
      }) => BranchRow[];
    };
    appointment: {
      findMany: (args: {
        where: AppointmentWhere;
        orderBy?: { startAt?: "asc" | "desc" };
      }) => AppointmentRow[];
      findFirst: (args: { where: AppointmentWhere }) => AppointmentRow | null;
      create: (args: {
        data: Omit<
          AppointmentRow,
          "id" | "createdAt" | "updatedAt" | "source" | "portalBookingRequestId" | "serviceId"
        > & {
          /** Optional: mirrors the schema default STAFF. */
          source?: AppointmentSourceRow;
          /** Optional: mirrors the nullable provenance link. */
          portalBookingRequestId?: string | null;
          /** Optional: mirrors the nullable service link (EPIC-09 WU4). */
          serviceId?: string | null;
        };
      }) => AppointmentRow;
      updateMany: (args: { where: AppointmentWhere; data: AppointmentUpdateData }) => {
        count: number;
      };
    };
    portalBookingRequest: {
      create: (args: {
        data: {
          tenantId: string;
          customerId: string;
          patientId: string;
          /** Optional: mirrors the schema default PENDING. */
          status?: PortalBookingRequestRow["status"];
          startAt: Date;
          endAt: Date;
        };
      }) => PortalBookingRequestRow;
      findMany: (args: {
        where: PortalBookingRequestWhere;
        orderBy?: { startAt?: "asc" | "desc" };
      }) => PortalBookingRequestRow[];
      findFirst: (args: { where: PortalBookingRequestWhere }) => PortalBookingRequestRow | null;
      /**
       * Compare-and-set used by the staff decision paths: flips a PENDING
       * request to APPROVED/REJECTED, returning the matched row count so a
       * second writer observes `{ count: 0 }`. Also applies the schema's
       * automatic `updatedAt` write.
       */
      updateMany: (args: {
        where: PortalBookingRequestWhere;
        data: { status: PortalBookingRequestRow["status"] };
      }) => { count: number };
    };
    role: {
      create: (args: { data: { code: string; name: string } }) => RoleRow;
      findUnique: (args: { where: { code: string } }) => RoleRow | null;
      findMany: (args: { where?: { code?: { in?: string[] } } }) => RoleRow[];
    };
    permission: {
      create: (args: { data: { key: string; name?: string } }) => PermissionRow;
      findUnique: (args: { where: { key: string } }) => PermissionRow | null;
      findMany: (args: {
        where?: { key?: { in?: string[] } };
        orderBy?: { key?: "asc" | "desc" };
      }) => PermissionRow[];
    };
    rolePermission: {
      create: (args: { data: { roleId: string; permissionId: string } }) => RolePermissionRow;
      findMany: (args: {
        where: { roleId?: string; permissionId?: string };
        select?: unknown;
      }) => (RolePermissionRow & { permission?: { key: string } })[];
      deleteMany: (args: { where: { roleId?: string; permissionId?: string } }) => {
        count: number;
      };
    };
    tenantRolePermissionOverride: {
      create: (args: {
        data: { tenantId: string; roleId: string; permissionKey: string; granted: boolean };
      }) => TenantRolePermissionOverrideRow;
      findMany: (args: {
        where: { tenantId?: string; roleId?: string; permissionKey?: string };
      }) => TenantRolePermissionOverrideRow[];
      deleteMany: (args: {
        where: { tenantId?: string; roleId?: string; permissionKey?: string };
      }) => { count: number };
    };
    tenantSettingNamespace: {
      findUnique: (args: {
        where: { tenantId_namespace: { tenantId: string; namespace: string } };
      }) => TenantSettingNamespaceRow | null;
      findMany: (args: {
        where?: { tenantId?: string; namespace?: string };
      }) => TenantSettingNamespaceRow[];
      create: (args: {
        data: Omit<TenantSettingNamespaceRow, "id" | "createdAt" | "updatedAt">;
      }) => TenantSettingNamespaceRow;
      update: (args: {
        where: { tenantId_namespace: { tenantId: string; namespace: string } };
        data: Partial<
          Omit<TenantSettingNamespaceRow, "id" | "tenantId" | "namespace" | "createdAt">
        >;
      }) => TenantSettingNamespaceRow;
      upsert: (args: {
        where: { tenantId_namespace: { tenantId: string; namespace: string } };
        create: Omit<TenantSettingNamespaceRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<
          Omit<TenantSettingNamespaceRow, "id" | "tenantId" | "namespace" | "createdAt">
        >;
      }) => TenantSettingNamespaceRow;
      deleteMany: (args: { where: { tenantId?: string; namespace?: string } }) => { count: number };
    };
    userProfile: {
      create: (args: {
        data: { email: string; displayName: string; status: string };
      }) => UserProfileRow;
    };
    staffSession: {
      create: (args: { data: Omit<StaffSessionRow, "id" | "revokedAt"> }) => StaffSessionRow;
      findUnique: (args: { where: { tokenHash: string } }) => StaffSessionRow | null;
      update: (args: { where: { id: string }; data: Partial<StaffSessionRow> }) => StaffSessionRow;
      deleteMany: (args: { where: { tokenHash: string } }) => { count: number };
    };
    tenantMembership: {
      create: (args: {
        data: Omit<TenantMembershipRow, "id" | "createdAt"> & { createdAt?: Date };
      }) => TenantMembershipRow;
      findFirst: (args: {
        where: MembershipWhere;
        orderBy?: MembershipOrder[];
        include?: { role?: unknown };
        select?: { role?: unknown };
      }) => (TenantMembershipRow & { role?: { code: string; id: string } }) | null;
      findMany: (args: {
        where: MembershipWhere;
        orderBy?: MembershipOrder[];
        include?: { role?: unknown };
        select?: { role?: unknown };
      }) => (TenantMembershipRow & { role?: { code: string; id: string } })[];
      updateMany: (args: { where: MembershipWhere; data: { status: string } }) => { count: number };
      update: (args: {
        where: { id: string };
        data: { roleId?: string; status?: string };
      }) => TenantMembershipRow;
    };
    auditLog: {
      create: (args: { data: Omit<AuditLogRow, "id"> & { id?: string } }) => AuditLogRow;
      findFirst: (args: { where: { action?: string; requestId?: string } }) => AuditLogRow | null;
      findMany: (args?: { where?: { action?: string; requestId?: string } }) => AuditLogRow[];
    };
    featureCode: {
      create: (args: { data: { code: string } }) => FeatureCodeRow;
      findUnique: (args: { where: { code: string } }) => FeatureCodeRow | null;
    };
    tenantEntitlement: {
      create: (args: { data: { tenantId: string; featureCodeId: string } }) => TenantEntitlementRow;
      findFirst: (args: {
        where: { tenantId: string; featureCode: { code: string } };
      }) => TenantEntitlementRow | null;
    };
  };
  tables: {
    tenants: Map<string, TenantRow>;
    roles: Map<string, RoleRow>;
    profiles: Map<string, UserProfileRow>;
    sessions: Map<string, StaffSessionRow>;
    memberships: Map<string, TenantMembershipRow>;
    audits: Map<string, AuditLogRow>;
    featureCodes: Map<string, FeatureCodeRow>;
    entitlements: Map<string, TenantEntitlementRow>;
    permissions: Map<string, PermissionRow>;
    rolePermissions: Map<string, RolePermissionRow>;
    rolePermissionOverrides: Map<string, TenantRolePermissionOverrideRow>;
    settingNamespaces: Map<string, TenantSettingNamespaceRow>;
    tenantBrandings: Map<string, TenantBrandingRow>;
    brandingAssets: Map<string, BrandingAssetRow>;
    brandingResetCleanupIntents: Map<string, BrandingResetCleanupIntentRow>;
    customers: Map<string, CustomerRow>;
    customerAddresses: Map<string, CustomerAddressRow>;
    customerContacts: Map<string, CustomerContactRow>;
    portalAccess: Map<string, CustomerPortalAccessRow>;
    portalCredentials: Map<string, PortalCredentialRow>;
    portalSessions: Map<string, PortalSessionRow>;
    species: Map<string, SpeciesRow>;
    breeds: Map<string, BreedRow>;
    taxRates: Map<string, TaxRateRow>;
    catalogItems: Map<string, CatalogItemRow>;
    stockMovements: Map<string, StockMovementRow>;
    stockBalances: Map<string, StockBalanceRow>;
    suppliers: Map<string, SupplierRow>;
    purchases: Map<string, PurchaseHeaderRow>;
    purchaseLines: Map<string, PurchaseLineRow>;
    sales: Map<string, SaleHeaderRow>;
    saleLines: Map<string, SaleLineRow>;
    payments: Map<string, PaymentRow>;
    idempotencyRecords: Map<string, IdempotencyRecordRow>;
    invoices: Map<string, InvoiceHeaderRow>;
    invoiceLines: Map<string, InvoiceLineRow>;
    invoiceNumberSequences: Map<string, InvoiceNumberSequenceRow>;
    cashRegisters: Map<string, CashRegisterRow>;
    cashSessions: Map<string, CashSessionRow>;
    cashMovements: Map<string, CashMovementRow>;
    patients: Map<string, PatientRow>;
    patientGuardians: Map<string, PatientGuardianRow>;
    clinicalEncounters: Map<string, ClinicalEncounterRow>;
    clinicalVaccinations: Map<string, ClinicalVaccinationRow>;
    branches: Map<string, BranchRow>;
    appointments: Map<string, AppointmentRow>;
    portalBookingRequests: Map<string, PortalBookingRequestRow>;
  };
  /** In-memory object storage for tests to inspect signed URLs and key retirement. */
  storage: InMemoryStorageDriver;
}

function matches(where: MembershipWhere, candidate: TenantMembershipRow): boolean {
  if (where.id !== undefined && where.id !== candidate.id) return false;
  if (where.tenantId !== undefined && where.tenantId !== candidate.tenantId) return false;
  if (where.userProfileId !== undefined && where.userProfileId !== candidate.userProfileId) {
    return false;
  }
  if (where.status !== undefined && where.status !== candidate.status) return false;
  if (where.roleId !== undefined) {
    const expected = where.roleId;
    if (typeof expected === "string") {
      if (expected !== candidate.roleId) return false;
    } else if (expected.in && !expected.in.includes(candidate.roleId)) {
      return false;
    }
  }
  return true;
}

function orderMemberships(
  rows: TenantMembershipRow[],
  orderBy: MembershipOrder[] | undefined
): TenantMembershipRow[] {
  const clauses = orderBy ?? [{ createdAt: "asc" as const }, { id: "asc" as const }];
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      for (const key of Object.keys(clause) as (keyof MembershipOrder)[]) {
        const direction = clause[key];
        if (!direction) continue;
        const leftKey = left[key] instanceof Date ? (left[key] as Date).getTime() : left[key];
        const rightKey = right[key] instanceof Date ? (right[key] as Date).getTime() : right[key];
        const compared =
          typeof leftKey === "string" && typeof rightKey === "string"
            ? leftKey.localeCompare(rightKey)
            : Number(leftKey) - Number(rightKey);
        if (compared !== 0) {
          return direction === "asc" ? compared : -compared;
        }
      }
    }
    return 0;
  });
}

/** Scalar/optional Prisma filter over CustomerPortalAccess (mirrors the service). */
interface CustomerPortalAccessWhere {
  id?: string;
  tenantId: string;
  customerId?: string;
  contactEmail?: PortalContactEmailFilter;
  status?: string;
}

/**
 * Reproduces Prisma's string equality for `contactEmail`: a bare string is
 * exact-match, while `{ equals, mode: 'insensitive' }` is case-insensitive —
 * the shape the canonical portal login read uses.
 */
function matchesPortalContactEmail(
  filter: PortalContactEmailFilter | undefined,
  candidate: string
): boolean {
  if (filter === undefined) return true;
  if (typeof filter === "string") return candidate === filter;
  return candidate.toLowerCase() === filter.equals.toLowerCase();
}

/** Shared matcher for the portal-access findFirst/findMany reads. */
function matchesPortalAccess(
  where: CustomerPortalAccessWhere,
  candidate: CustomerPortalAccessRow
): boolean {
  return (
    (where.id === undefined || candidate.id === where.id) &&
    candidate.tenantId === where.tenantId &&
    (where.customerId === undefined || candidate.customerId === where.customerId) &&
    matchesPortalContactEmail(where.contactEmail, candidate.contactEmail) &&
    (where.status === undefined || candidate.status === where.status)
  );
}

/** Faithful-enough Appointment matcher for the shipped read/overlap predicates. */
function matchesAppointment(where: AppointmentWhere, candidate: AppointmentRow): boolean {
  if (where.id !== undefined) {
    if (typeof where.id === "string") {
      if (candidate.id !== where.id) return false;
    } else if (where.id.not !== undefined && candidate.id === where.id.not) {
      return false;
    }
  }
  if (where.tenantId !== undefined && candidate.tenantId !== where.tenantId) return false;
  if (where.branchId !== undefined && candidate.branchId !== where.branchId) return false;
  if (where.patientId !== undefined) {
    if (typeof where.patientId === "string") {
      if (candidate.patientId !== where.patientId) return false;
    } else if (!where.patientId.in.includes(candidate.patientId)) {
      return false;
    }
  }
  if (where.professionalMembershipId !== undefined) {
    if (typeof where.professionalMembershipId === "string") {
      if (candidate.professionalMembershipId !== where.professionalMembershipId) return false;
    } else if (!where.professionalMembershipId.in.includes(candidate.professionalMembershipId)) {
      return false;
    }
  }
  if (
    where.portalBookingRequestId !== undefined &&
    candidate.portalBookingRequestId !== where.portalBookingRequestId
  ) {
    return false;
  }
  if (where.serviceId !== undefined && candidate.serviceId !== where.serviceId) {
    return false;
  }
  if (where.status !== undefined) {
    if (typeof where.status === "string") {
      if (candidate.status !== where.status) return false;
    } else if (!where.status.in.includes(candidate.status)) {
      return false;
    }
  }
  if (where.version !== undefined && candidate.version !== where.version) return false;
  if (
    where.startAt?.lt !== undefined &&
    candidate.startAt.getTime() >= where.startAt.lt.getTime()
  ) {
    return false;
  }
  if (where.endAt?.gt !== undefined && candidate.endAt.getTime() <= where.endAt.gt.getTime()) {
    return false;
  }
  return true;
}

/** Faithful-enough PortalBookingRequest matcher for the shipped predicates. */
function matchesPortalBookingRequest(
  where: PortalBookingRequestWhere,
  candidate: PortalBookingRequestRow
): boolean {
  if (where.id !== undefined && candidate.id !== where.id) return false;
  if (where.tenantId !== undefined && candidate.tenantId !== where.tenantId) return false;
  if (where.customerId !== undefined && candidate.customerId !== where.customerId) return false;
  if (where.patientId !== undefined && candidate.patientId !== where.patientId) return false;
  if (where.status !== undefined) {
    if (typeof where.status === "string") {
      if (candidate.status !== where.status) return false;
    } else if (!where.status.in.includes(candidate.status)) {
      return false;
    }
  }
  return true;
}

/**
 * Faithful-enough CustomerContact matcher (EPIC-08 WU4C): scalar equality for
 * every shipped key plus the `{ not }` form the portal profile demotion uses.
 */
function matchesCustomerContact(
  where: CustomerContactWhere,
  candidate: CustomerContactRow
): boolean {
  if (typeof where.id === "string" && candidate.id !== where.id) return false;
  if (typeof where.id === "object" && candidate.id === where.id.not) return false;
  if (where.tenantId !== undefined && candidate.tenantId !== where.tenantId) return false;
  if (where.customerId !== undefined && candidate.customerId !== where.customerId) return false;
  if (where.isActive !== undefined && candidate.isActive !== where.isActive) return false;
  if (where.kind !== undefined && candidate.kind !== where.kind) return false;
  if (where.isPrimary !== undefined && candidate.isPrimary !== where.isPrimary) return false;
  return true;
}

/**
 * Single-clause `createdAt`/`updatedAt` ordering for the Customer child-table
 * delegates. The shipped callers order by ONE date key; the portal profile
 * boundary relies on `updatedAt: "desc"` for its "most recently updated"
 * targeting rule, so the fake must order exactly as the real client would.
 */
function orderByDate<T extends { createdAt: Date; updatedAt: Date }>(
  rows: T[],
  orderBy: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } | undefined
): T[] {
  const key = orderBy?.updatedAt !== undefined ? "updatedAt" : "createdAt";
  const direction = orderBy?.[key];
  if (direction === undefined) return rows;
  const sorted = [...rows].sort((left, right) => left[key].getTime() - right[key].getTime());
  return direction === "desc" ? sorted.reverse() : sorted;
}

/**
 * Normalizes a Decimal-or-string amount to the exact decimal STRING the fake
 * stores. Production passes a `Prisma.Decimal`; callers may pass the literal
 * string. Floats are never produced here.
 */
function toDecimalStringOrNull(
  value: string | { toString(): string } | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : value.toString();
}

/** Required-decimal variant of {@link toDecimalStringOrNull} (never null). */
function toDecimalString(value: string | { toString(): string }): string {
  return typeof value === "string" ? value : value.toString();
}

/**
 * Ordering for the movement ledger: chronological, then id as a stable
 * tie-break (two movements of the same millisecond still order deterministically).
 */
function orderStockMovements(
  rows: StockMovementRow[],
  orderBy: readonly { createdAt?: "asc" | "desc"; id?: "asc" | "desc" }[] | undefined
): StockMovementRow[] {
  if (orderBy === undefined) return rows;
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      if (clause.createdAt !== undefined) {
        const compared = left.createdAt.getTime() - right.createdAt.getTime();
        if (compared !== 0) return clause.createdAt === "asc" ? compared : -compared;
      }
      if (clause.id !== undefined) {
        const compared = left.id.localeCompare(right.id);
        if (compared !== 0) return clause.id === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

/** Ordering for the balance projection (item id, then id as a tie-break). */
function orderStockBalances(
  rows: StockBalanceRow[],
  orderBy: readonly { catalogItemId?: "asc" | "desc"; id?: "asc" | "desc" }[] | undefined
): StockBalanceRow[] {
  if (orderBy === undefined) return rows;
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      if (clause.catalogItemId !== undefined) {
        const compared = left.catalogItemId.localeCompare(right.catalogItemId);
        if (compared !== 0) return clause.catalogItemId === "asc" ? compared : -compared;
      }
      if (clause.id !== undefined) {
        const compared = left.id.localeCompare(right.id);
        if (compared !== 0) return clause.id === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

/**
 * Ordering for the purchase list: `createdAt` (newest first on the shipped
 * query) with `id` as the stable tie-break, mirroring the repository's declared
 * deterministic order.
 */
function orderPurchases(
  rows: PurchaseHeaderRow[],
  orderBy: readonly PurchaseOrderBy[] | undefined
): PurchaseHeaderRow[] {
  if (orderBy === undefined) return rows;
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      if (clause.createdAt !== undefined) {
        const compared = left.createdAt.getTime() - right.createdAt.getTime();
        if (compared !== 0) return clause.createdAt === "asc" ? compared : -compared;
      }
      if (clause.id !== undefined) {
        const compared = left.id.localeCompare(right.id);
        if (compared !== 0) return clause.id === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

/**
 * A purchase's related lines in insertion order, `id` as the tie-break — the
 * shape the repository's `include: { lines: true }` read assembles onto the
 * aggregate.
 */
function linesForPurchase(
  purchaseLineTable: Map<string, PurchaseLineRow>,
  purchaseId: string
): PurchaseLineRow[] {
  return [...purchaseLineTable.values()]
    .filter((line) => line.purchaseId === purchaseId)
    .sort((left, right) => {
      const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
      if (byCreated !== 0) return byCreated;
      return left.id.localeCompare(right.id);
    });
}

/**
 * Ordering for the sale list: `createdAt` (newest first on the shipped query)
 * with `id` as the stable tie-break, mirroring the repository's declared
 * deterministic order.
 */
function orderSales(
  rows: SaleHeaderRow[],
  orderBy: readonly SaleOrderBy[] | undefined
): SaleHeaderRow[] {
  if (orderBy === undefined) return rows;
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      if (clause.createdAt !== undefined) {
        const compared = left.createdAt.getTime() - right.createdAt.getTime();
        if (compared !== 0) return clause.createdAt === "asc" ? compared : -compared;
      }
      if (clause.id !== undefined) {
        const compared = left.id.localeCompare(right.id);
        if (compared !== 0) return clause.id === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

/**
 * A sale's related lines in insertion order, `id` as the tie-break — the shape
 * the repository's `include: { lines: true }` read assembles onto the aggregate.
 */
function linesForSale(saleLineTable: Map<string, SaleLineRow>, saleId: string): SaleLineRow[] {
  return [...saleLineTable.values()]
    .filter((line) => line.saleId === saleId)
    .sort((left, right) => {
      const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
      if (byCreated !== 0) return byCreated;
      return left.id.localeCompare(right.id);
    });
}

/**
 * Raises the STRUCTURAL `P2002` shape a Prisma unique-index violation carries
 * (`code` plus the violated index name in `meta.target`). The partial
 * `invoice_tenant_id_sale_id_key` and the allocation key
 * `invoice_tenant_id_series_number_key` are reported by INDEX NAME: the partial
 * index is raw SQL and therefore unknown to the Prisma schema, and the cash,
 * clinical and sales services all match either the index name or the offending
 * field set. Anything that would violate a constraint this boundary does not
 * model is left to live PostgreSQL.
 */
function uniqueConstraintError(modelName: string, indexName: string): Error {
  return Object.assign(new Error(`Unique constraint failed on the constraint: \`${indexName}\``), {
    code: "P2002",
    meta: { modelName, target: [indexName] },
  });
}

/** Resolves both sequence where shapes onto the `(tenantId, series)` pair. */
function resolveInvoiceSequenceKey(where: InvoiceNumberSequenceWhere): {
  tenantId: string;
  series: string;
} {
  return "tenantId_series" in where
    ? where.tenantId_series
    : { tenantId: where.tenantId, series: where.series };
}

/**
 * Ordering for the invoice list: `createdAt` (newest first on the shipped
 * query) with `id` as the stable tie-break, mirroring the repository's declared
 * deterministic order.
 */
function orderInvoices(
  rows: InvoiceHeaderRow[],
  orderBy: readonly InvoiceOrderBy[] | undefined
): InvoiceHeaderRow[] {
  if (orderBy === undefined) return rows;
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      if (clause.createdAt !== undefined) {
        const compared = left.createdAt.getTime() - right.createdAt.getTime();
        if (compared !== 0) return clause.createdAt === "asc" ? compared : -compared;
      }
      if (clause.id !== undefined) {
        const compared = left.id.localeCompare(right.id);
        if (compared !== 0) return clause.id === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

/**
 * An invoice HEADER read is tenant-scoped BY CONSTRUCTION: the shipped Billing
 * repository always builds `where.tenantId` from the request context, and the
 * real delegate would silently return a FOREIGN row for a predicate that omitted
 * it — exactly the tenant-isolation defect an integration suite must never
 * mirror. The fake therefore refuses an unscoped header read loudly instead of
 * answering it (the `$queryRaw` "fails loudly rather than return wrong rows"
 * precedent).
 */
function assertInvoiceTenantScope(where: InvoiceWhere): void {
  if (where.tenantId === undefined) {
    throw new Error("invoice header reads require a tenantId predicate (tenant-isolation guard)");
  }
}

/**
 * An invoice's related lines by `position` — the document's reading order, not
 * insertion order. The include may request the explicit direction; `true` reads
 * the defined ascending order.
 */
function linesForInvoice(
  invoiceLineTable: Map<string, InvoiceLineRow>,
  invoiceId: string,
  include: InvoiceLinesInclude | undefined
): InvoiceLineRow[] {
  const lines = include?.lines;
  const direction = lines && typeof lines === "object" ? (lines.orderBy?.position ?? "asc") : "asc";
  const rows = [...invoiceLineTable.values()]
    .filter((line) => line.invoiceId === invoiceId)
    .sort((left, right) => left.position - right.position);
  return direction === "desc" ? rows.reverse() : rows;
}

/**
 * Ordering for the cash register/session/movement lists: `createdAt` (newest
 * first on the shipped queries) with `id` as the stable tie-break, mirroring the
 * repository's declared deterministic order.
 */
function orderCashRows<T extends { id: string; createdAt: Date }>(
  rows: T[],
  orderBy: readonly CashOrderBy[] | undefined
): T[] {
  if (orderBy === undefined) return rows;
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      if (clause.createdAt !== undefined) {
        const compared = left.createdAt.getTime() - right.createdAt.getTime();
        if (compared !== 0) return clause.createdAt === "asc" ? compared : -compared;
      }
      if (clause.id !== undefined) {
        const compared = left.id.localeCompare(right.id);
        if (compared !== 0) return clause.id === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}

/** Builds one isolated database boundary; call per-boot for full isolation. */
export function createIsolationDatabase(): IsolationDatabase {
  const tenants = new Map<string, TenantRow>();
  const roles = new Map<string, RoleRow>();
  const profiles = new Map<string, UserProfileRow>();
  const sessions = new Map<string, StaffSessionRow>();
  const memberships = new Map<string, TenantMembershipRow>();
  const audits = new Map<string, AuditLogRow>();
  const featureCodes = new Map<string, FeatureCodeRow>();
  const entitlements = new Map<string, TenantEntitlementRow>();
  const permissions = new Map<string, PermissionRow>();
  const rolePermissions = new Map<string, RolePermissionRow>();
  const rolePermissionOverrides = new Map<string, TenantRolePermissionOverrideRow>();
  const settingNamespaces = new Map<string, TenantSettingNamespaceRow>();
  const tenantBrandings = new Map<string, TenantBrandingRow>();
  const brandingAssets = new Map<string, BrandingAssetRow>();
  const brandingResetCleanupIntents = new Map<string, BrandingResetCleanupIntentRow>();
  const customers = new Map<string, CustomerRow>();
  const customerAddresses = new Map<string, CustomerAddressRow>();
  const customerContacts = new Map<string, CustomerContactRow>();
  const portalAccess = new Map<string, CustomerPortalAccessRow>();
  const portalCredentials = new Map<string, PortalCredentialRow>();
  const portalSessions = new Map<string, PortalSessionRow>();
  const speciesTable = new Map<string, SpeciesRow>();
  const breedTable = new Map<string, BreedRow>();
  // GLOBAL tax rates are seeded reference data — the same three rows for every
  // tenant, so the shared boundary seeds them at construction (EPIC-09 WU2).
  const taxRateTable = new Map<string, TaxRateRow>();
  for (const rate of SEEDED_TAX_RATES) {
    taxRateTable.set(rate.id, { ...rate });
  }
  const catalogItemTable = new Map<string, CatalogItemRow>();
  const stockMovementTable = new Map<string, StockMovementRow>();
  const stockBalanceTable = new Map<string, StockBalanceRow>();
  const supplierTable = new Map<string, SupplierRow>();
  const purchaseTable = new Map<string, PurchaseHeaderRow>();
  const purchaseLineTable = new Map<string, PurchaseLineRow>();
  const saleTable = new Map<string, SaleHeaderRow>();
  const saleLineTable = new Map<string, SaleLineRow>();
  // EPIC-12 POS-003: the completion transaction's two new tables. Present so the
  // completion tests can read them and the draft-path inertness probe can diff
  // them; nothing else writes a row.
  const paymentTable = new Map<string, PaymentRow>();
  const idempotencyRecordTable = new Map<string, IdempotencyRecordRow>();
  // EPIC-14 BILL-002: the invoice aggregate the Billing reads/writes touch.
  // Header and lines are separate storage maps so the delegates can assemble the
  // `include: { lines: ... }` shape; the numbering counter rides along so
  // BILL-003's allocation does not have to reopen this boundary.
  const invoiceTable = new Map<string, InvoiceHeaderRow>();
  const invoiceLineTable = new Map<string, InvoiceLineRow>();
  const invoiceNumberSequenceTable = new Map<string, InvoiceNumberSequenceRow>();
  // EPIC-12 POS-002: the register/session tables the cash surface touches. The
  // movement table is MODELLED (so the inertness probe can diff it) but nothing
  // in EPIC-12 writes a row — POS-003 does, and EPIC-13 owns the other kinds.
  const cashRegisterTable = new Map<string, CashRegisterRow>();
  const cashSessionTable = new Map<string, CashSessionRow>();
  const cashMovementTable = new Map<string, CashMovementRow>();
  const patientTable = new Map<string, PatientRow>();
  const patientGuardianTable = new Map<string, PatientGuardianRow>();
  const clinicalEncounterTable = new Map<string, ClinicalEncounterRow>();
  const clinicalVaccinationTable = new Map<string, ClinicalVaccinationRow>();
  const branchTable = new Map<string, BranchRow>();
  const appointmentTable = new Map<string, AppointmentRow>();
  const portalBookingRequestTable = new Map<string, PortalBookingRequestRow>();

  /** Role-code predicate for membership options (EPIC-07 professional lookup). */
  const roleCodeMatches = (where: MembershipWhere, candidate: TenantMembershipRow): boolean =>
    where.role === undefined || roles.get(candidate.roleId)?.code === where.role.code;

  type TableSnapshot = Record<string, Map<string, unknown>>;

  const allTables: Record<string, Map<string, unknown>> = {
    tenants,
    roles,
    profiles,
    sessions,
    memberships,
    audits,
    featureCodes,
    entitlements,
    permissions,
    rolePermissions,
    rolePermissionOverrides,
    settingNamespaces,
    tenantBrandings,
    brandingAssets,
    brandingResetCleanupIntents,
    customers,
    customerAddresses,
    customerContacts,
    portalAccess,
    portalCredentials,
    portalSessions,
    species: speciesTable,
    breeds: breedTable,
    taxRates: taxRateTable,
    catalogItems: catalogItemTable,
    stockMovements: stockMovementTable,
    stockBalances: stockBalanceTable,
    suppliers: supplierTable,
    purchases: purchaseTable,
    purchaseLines: purchaseLineTable,
    sales: saleTable,
    saleLines: saleLineTable,
    payments: paymentTable,
    idempotencyRecords: idempotencyRecordTable,
    invoices: invoiceTable,
    invoiceLines: invoiceLineTable,
    invoiceNumberSequences: invoiceNumberSequenceTable,
    cashRegisters: cashRegisterTable,
    cashSessions: cashSessionTable,
    cashMovements: cashMovementTable,
    patients: patientTable,
    patientGuardians: patientGuardianTable,
    clinicalEncounters: clinicalEncounterTable,
    clinicalVaccinations: clinicalVaccinationTable,
    branches: branchTable,
    appointments: appointmentTable,
    portalBookingRequests: portalBookingRequestTable,
  };

  function snapshotTables(): TableSnapshot {
    const snapshot: TableSnapshot = {};
    for (const [name, table] of Object.entries(allTables)) {
      const cloned = new Map<string, unknown>();
      for (const [id, row] of table) {
        cloned.set(id, structuredClone(row));
      }
      snapshot[name] = cloned;
    }
    return snapshot;
  }

  function restoreTables(snapshot: TableSnapshot): void {
    for (const [name, table] of Object.entries(allTables)) {
      const snapshotTable = snapshot[name];
      table.clear();
      for (const [id, row] of snapshotTable) {
        table.set(id, structuredClone(row));
      }
    }
  }

  /**
   * Reproduces the `credential` join the portal login read selects. The password
   * hash is RESTRICTED and only ever surfaces on this verification path.
   */
  const joinPortalCredential = (
    row: CustomerPortalAccessRow
  ): CustomerPortalAccessRow & { credential: { passwordHash: string } | null } => {
    const credential = portalCredentials.get(row.id);
    return { ...row, credential: credential ? { passwordHash: credential.passwordHash } : null };
  };

  type PrismaLike = IsolationDatabase["prisma"];
  // `$transaction` executes the callback against the SAME in-memory maps but
  // snapshots them first so a thrown error rolls back every mutation — this
  // makes audit-or-nothing tests honest on the in-memory boundary. Real
  // transactional semantics are still proven by the live-PostgreSQL evidence
  // gate (TD-006).
  const prisma: PrismaLike = {
    $transaction: async <T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T> => {
      const snapshot = snapshotTables();
      try {
        return await callback(prisma);
      } catch (error) {
        restoreTables(snapshot);
        throw error;
      }
    },
    $queryRaw: (query, ...values) => {
      // Match THE shipped raw queries (all active membership rows for the
      // tenant, the EPIC-11 purchase header row lock, and the per-item
      // advisory locks). Every bound value is server-resolved.
      const text = typeof query === "string" ? query : query.join("");
      // EPIC-07 scheduling and EPIC-11 PUR-002 receiving serialize with
      // transaction-scoped advisory locks. This single-threaded boundary
      // serializes nothing, so the call must simply succeed; the real
      // interleaving proof is live-PostgreSQL-owned.
      if (text.includes("pg_advisory_xact_lock")) {
        return Promise.resolve([]);
      }
      // EPIC-11 PUR-002: the receive command row-locks the purchase header
      // before reading its status. A synchronous map cannot block, so this
      // models the lock as a read of the locked row `(tenant_id, id)`; the real
      // concurrent-receive race is proven against live PostgreSQL.
      if (text.includes('"purchase"') && text.includes("FOR UPDATE")) {
        const [tenantId, purchaseId] = values as string[];
        const header = purchaseTable.get(purchaseId);
        if (header?.tenantId !== tenantId) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: header.id, status: header.status }]);
      }
      // EPIC-12 POS-001: the sale update and cancel commands row-lock the sale
      // header before their post-lock status read. Same modelling as the
      // purchase lock above; the real interleaving is proven against live
      // PostgreSQL.
      if (text.includes('"sale"') && text.includes("FOR UPDATE")) {
        const [tenantId, saleId] = values as string[];
        const header = saleTable.get(saleId);
        if (header?.tenantId !== tenantId) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: header.id, status: header.status }]);
      }
      // EPIC-13 CASH-003: the close command row-locks the session before its
      // post-lock status read. A synchronous map cannot block, so this models
      // the lock as a read of the locked row `(tenant_id, id)`; the real
      // close/movement interleaving is proven against live PostgreSQL.
      if (text.includes('"cash_session"') && text.includes("FOR UPDATE")) {
        const [tenantId, sessionId] = values as string[];
        const session = cashSessionTable.get(sessionId);
        if (session?.tenantId !== tenantId) {
          return Promise.resolve([]);
        }
        return Promise.resolve([{ id: session.id, status: session.status }]);
      }
      if (!text.includes("tenant_membership") || !text.includes("FOR UPDATE")) {
        throw new Error(
          `in-memory $queryRaw fake only supports the tenant_membership FOR UPDATE lock, the purchase header FOR UPDATE lock, the sale header FOR UPDATE lock, the cash session FOR UPDATE lock and pg_advisory_xact_lock (got: ${text.slice(0, 60)}...)`
        );
      }
      const [tenantId] = values as string[];
      return Promise.resolve(
        [...memberships.values()]
          .filter((candidate) => candidate.tenantId === tenantId && candidate.status === "ACTIVE")
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((candidate) => ({ id: candidate.id, role_id: candidate.roleId }))
      );
    },
    tenant: {
      // Mirrors Prisma's `@default(ACTIVE)`: callers that omit status still
      // receive an ACTIVE tenant.
      create: ({ data }) => {
        const created: TenantRow = {
          id: randomUUID(),
          slug: data.slug,
          name: data.name,
          status: data.status ?? "ACTIVE",
        };
        tenants.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) => {
        const candidate = [...tenants.values()].find(
          (row) =>
            (where.id !== undefined && row.id === where.id) ||
            (where.slug !== undefined && row.slug === where.slug)
        );
        if (!candidate) return null;
        // Compound extended-where-unique: the status predicate ANDs with the
        // identity predicate, so a SUSPENDED row falls through to null.
        if (where.status !== undefined && candidate.status !== where.status) return null;
        return candidate;
      },
    },
    tenantBranding: {
      findUnique: ({ where }) =>
        [...tenantBrandings.values()].find((candidate) => candidate.tenantId === where.tenantId) ??
        null,
      upsert: ({ where, create, update }) => {
        const existing = [...tenantBrandings.values()].find(
          (candidate) => candidate.tenantId === where.tenantId
        );
        const now = new Date();
        if (existing) {
          if (update.schemaVersion !== undefined) existing.schemaVersion = update.schemaVersion;
          if (update.overrides !== undefined) existing.overrides = update.overrides;
          if (update.displayName !== undefined) existing.displayName = update.displayName ?? null;
          if (update.logoLightAssetId !== undefined)
            existing.logoLightAssetId = update.logoLightAssetId ?? null;
          if (update.logoDarkAssetId !== undefined)
            existing.logoDarkAssetId = update.logoDarkAssetId ?? null;
          if (update.faviconAssetId !== undefined)
            existing.faviconAssetId = update.faviconAssetId ?? null;
          if (update.updatedByUserProfileId !== undefined)
            existing.updatedByUserProfileId = update.updatedByUserProfileId ?? null;
          existing.updatedAt = now;
          return existing;
        }
        const created: TenantBrandingRow = {
          id: randomUUID(),
          ...create,
          displayName: create.displayName ?? null,
          logoLightAssetId: create.logoLightAssetId ?? null,
          logoDarkAssetId: create.logoDarkAssetId ?? null,
          faviconAssetId: create.faviconAssetId ?? null,
          updatedByUserProfileId: create.updatedByUserProfileId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        tenantBrandings.set(created.id, created);
        return created;
      },
      update: ({ where, data }) => {
        const existing = [...tenantBrandings.values()].find(
          (candidate) => candidate.tenantId === where.tenantId
        );
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.schemaVersion !== undefined) existing.schemaVersion = data.schemaVersion;
        if (data.overrides !== undefined) existing.overrides = data.overrides;
        if (data.displayName !== undefined) existing.displayName = data.displayName ?? null;
        if (data.logoLightAssetId !== undefined)
          existing.logoLightAssetId = data.logoLightAssetId ?? null;
        if (data.logoDarkAssetId !== undefined)
          existing.logoDarkAssetId = data.logoDarkAssetId ?? null;
        if (data.faviconAssetId !== undefined)
          existing.faviconAssetId = data.faviconAssetId ?? null;
        if (data.updatedByUserProfileId !== undefined)
          existing.updatedByUserProfileId = data.updatedByUserProfileId ?? null;
        existing.updatedAt = new Date();
        return existing;
      },
      delete: ({ where }) => {
        const existing = [...tenantBrandings.values()].find(
          (candidate) => candidate.tenantId === where.tenantId
        );
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        tenantBrandings.delete(existing.id);
        return existing;
      },
    },
    brandingAsset: {
      create: ({ data }) => {
        const now = new Date();
        const created: BrandingAssetRow = {
          id: randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        brandingAssets.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) => brandingAssets.get(where.id) ?? null,
      findFirst: ({ where }) =>
        [...brandingAssets.values()].find(
          (candidate) => candidate.tenantId === where.tenantId && candidate.kind === where.kind
        ) ?? null,
      findMany: ({ where }) =>
        [...brandingAssets.values()].filter((candidate) => candidate.tenantId === where.tenantId),
      delete: ({ where }) => {
        const existing = brandingAssets.get(where.id);
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        brandingAssets.delete(existing.id);
        return existing;
      },
    },
    brandingResetCleanupIntent: {
      create: ({ data }) => {
        const now = new Date();
        const created: BrandingResetCleanupIntentRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          resetAuditId: data.resetAuditId ?? null,
          requestedByUserProfileId: data.requestedByUserProfileId ?? null,
          storageKeys: [...data.storageKeys],
          status: data.status ?? "PENDING",
          attempts: data.attempts ?? 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        brandingResetCleanupIntents.set(created.id, created);
        return created;
      },
      findMany: ({ where } = {}) =>
        [...brandingResetCleanupIntents.values()].filter(
          (candidate) =>
            (where?.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where?.status === undefined || candidate.status === where.status)
        ),
    },
    customer: {
      findMany: ({ where, orderBy }) => {
        let rows = [...customers.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy?.displayName) {
          rows = rows.sort((left, right) => left.displayName.localeCompare(right.displayName));
          if (orderBy.displayName === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...customers.values()].find(
          (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
        ) ?? null,
      findUnique: ({ where }) => customers.get(where.id) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerRow = {
          id: randomUUID(),
          ...data,
          isActive: data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        customers.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const existing = customers.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return { count: 0 };
        }
        const updated: CustomerRow = { ...existing, updatedAt: new Date() };
        if (data.displayName !== undefined) updated.displayName = data.displayName;
        if (data.legalName !== undefined) updated.legalName = data.legalName ?? null;
        if (data.taxId !== undefined) updated.taxId = data.taxId ?? null;
        if (data.firstName !== undefined) updated.firstName = data.firstName ?? null;
        if (data.lastName !== undefined) updated.lastName = data.lastName ?? null;
        if (data.documentNumber !== undefined) updated.documentNumber = data.documentNumber ?? null;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        customers.set(updated.id, updated);
        return { count: 1 };
      },
    },
    customerAddress: {
      findMany: ({ where, orderBy, take }) => {
        let rows = [...customerAddresses.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        rows = orderByDate(rows, orderBy);
        return take === undefined ? rows : rows.slice(0, take);
      },
      findFirst: ({ where }) =>
        [...customerAddresses.values()].find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId
        ) ?? null,
      findUnique: ({ where }) => customerAddresses.get(where.id) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerAddressRow = {
          id: randomUUID(),
          ...data,
          isActive: data.isActive ?? true,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? data.createdAt ?? now,
        };
        customerAddresses.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const existing = customerAddresses.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          existing?.customerId !== where.customerId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return { count: 0 };
        }
        const updated: CustomerAddressRow = { ...existing, updatedAt: new Date() };
        if (data.label !== undefined) updated.label = data.label ?? null;
        if (data.line1 !== undefined) updated.line1 = data.line1 ?? null;
        if (data.line2 !== undefined) updated.line2 = data.line2 ?? null;
        if (data.city !== undefined) updated.city = data.city ?? null;
        if (data.state !== undefined) updated.state = data.state ?? null;
        if (data.postalCode !== undefined) updated.postalCode = data.postalCode ?? null;
        if (data.countryCode !== undefined) updated.countryCode = data.countryCode ?? null;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        customerAddresses.set(updated.id, updated);
        return { count: 1 };
      },
    },
    customerContact: {
      findMany: ({ where, orderBy, take }) => {
        let rows = [...customerContacts.values()].filter((candidate) =>
          matchesCustomerContact(where, candidate)
        );
        rows = orderByDate(rows, orderBy);
        return take === undefined ? rows : rows.slice(0, take);
      },
      findFirst: ({ where }) =>
        [...customerContacts.values()].find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.tenantId === where.tenantId &&
            candidate.customerId === where.customerId
        ) ?? null,
      findUnique: ({ where }) => customerContacts.get(where.id) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerContactRow = {
          id: randomUUID(),
          ...data,
          isActive: data.isActive ?? true,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? data.createdAt ?? now,
        };
        customerContacts.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const matched = [...customerContacts.values()].filter((candidate) =>
          matchesCustomerContact(where, candidate)
        );
        for (const existing of matched) {
          const updated: CustomerContactRow = { ...existing, updatedAt: new Date() };
          if (data.kind !== undefined) updated.kind = data.kind;
          if (data.label !== undefined) updated.label = data.label ?? null;
          if (data.value !== undefined) updated.value = data.value;
          if (data.isPrimary !== undefined) updated.isPrimary = data.isPrimary;
          if (data.isActive !== undefined) updated.isActive = data.isActive;
          customerContacts.set(updated.id, updated);
        }
        return { count: matched.length };
      },
    },
    customerPortalAccess: {
      create: ({ data }) => {
        const now = new Date();
        const created: CustomerPortalAccessRow = {
          id: randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        portalAccess.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) => portalAccess.get(where.id) ?? null,
      findFirst: ({ where }) => {
        const row = [...portalAccess.values()].find((candidate) =>
          matchesPortalAccess(where, candidate)
        );
        return row ? joinPortalCredential(row) : null;
      },
      findMany: ({ where, orderBy, take }) => {
        let rows = [...portalAccess.values()].filter((candidate) =>
          matchesPortalAccess(where, candidate)
        );
        if (orderBy?.id) {
          rows = rows.sort((left, right) => left.id.localeCompare(right.id));
          if (orderBy.id === "desc") rows.reverse();
        }
        if (take !== undefined) {
          rows = rows.slice(0, take);
        }
        return rows.map(joinPortalCredential);
      },
      updateMany: ({ where, data }) => {
        const existing = portalAccess.get(where.id);
        if (!existing) {
          return { count: 0 };
        }
        if (existing.tenantId !== where.tenantId) {
          return { count: 0 };
        }
        if (where.status !== undefined && existing.status !== where.status) {
          return { count: 0 };
        }
        if (data.status !== undefined) existing.status = data.status;
        existing.updatedAt = new Date();
        return { count: 1 };
      },
    },
    portalCredential: {
      create: ({ data }) => {
        const now = new Date();
        const created: PortalCredentialRow = {
          portalAccessId: data.portalAccessId,
          passwordHash: data.passwordHash,
          createdAt: now,
          updatedAt: now,
        };
        portalCredentials.set(created.portalAccessId, created);
        return created;
      },
      findUnique: ({ where }) => portalCredentials.get(where.portalAccessId) ?? null,
    },
    portalSession: {
      create: ({ data }) => {
        const now = new Date();
        const created: PortalSessionRow = {
          id: randomUUID(),
          ...data,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        portalSessions.set(created.tokenHash, created);
        return created;
      },
      findUnique: ({ where }) => portalSessions.get(where.tokenHash) ?? null,
      update: ({ where, data }) => {
        const existing = [...portalSessions.values()].find((entry) => entry.id === where.id);
        if (!existing) {
          // Structural P2025 mirrors the real delegate's rejected shape
          // (PortalSessionService detects lost races via err.code).
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        Object.assign(existing, data);
        existing.updatedAt = new Date();
        return existing;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of portalSessions.values()) {
          if (where.tokenHash !== undefined && candidate.tokenHash !== where.tokenHash) continue;
          if (
            where.portalAccessId !== undefined &&
            candidate.portalAccessId !== where.portalAccessId
          ) {
            continue;
          }
          if (where.revokedAt === null && candidate.revokedAt !== null) continue;
          candidate.revokedAt = data.revokedAt;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    species: {
      create: ({ data }) => {
        const created: SpeciesRow = { id: randomUUID(), code: data.code, name: data.name };
        speciesTable.set(created.id, created);
        return created;
      },
      findFirst: ({ where }) =>
        [...speciesTable.values()].find((candidate) => candidate.id === where.id) ?? null,
      // Global catalog: NO tenant predicate. `include.breeds` mirrors the
      // relation the catalog read nests (Decision #2211).
      findMany: ({ orderBy, include } = {}) => {
        let rows = [...speciesTable.values()];
        if (orderBy?.name) {
          rows = rows.sort((left, right) => left.name.localeCompare(right.name));
          if (orderBy.name === "desc") rows.reverse();
        }
        if (!include?.breeds) return rows;
        return rows.map((row) => ({
          ...row,
          breeds: [...breedTable.values()]
            .filter((breed) => breed.speciesId === row.id)
            .sort((left, right) => left.name.localeCompare(right.name)),
        }));
      },
    },
    breed: {
      create: ({ data }) => {
        const created: BreedRow = {
          id: randomUUID(),
          speciesId: data.speciesId,
          code: data.code,
          name: data.name,
        };
        breedTable.set(created.id, created);
        return created;
      },
      // Breed must belong to the referenced Species (speciesId predicate).
      findFirst: ({ where }) =>
        [...breedTable.values()].find(
          (candidate) => candidate.id === where.id && candidate.speciesId === where.speciesId
        ) ?? null,
    },
    taxRate: {
      // GLOBAL catalog: NO tenant predicate. `code` is the stable natural key.
      findMany: ({ orderBy } = {}) => {
        const rows = [...taxRateTable.values()];
        if (orderBy?.code) {
          rows.sort((left, right) => left.code.localeCompare(right.code));
          if (orderBy.code === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) => {
        if (where.id !== undefined) {
          return taxRateTable.get(where.id) ?? null;
        }
        if (where.code !== undefined) {
          return [...taxRateTable.values()].find((rate) => rate.code === where.code) ?? null;
        }
        return null;
      },
    },
    catalogItem: {
      findMany: ({ where, orderBy }) => {
        let rows = [...catalogItemTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.kind === undefined || candidate.kind === where.kind) &&
            (where.isActive === undefined || candidate.isActive === where.isActive) &&
            (where.id === undefined || where.id.in.includes(candidate.id))
        );
        if (orderBy) {
          rows = rows.sort((left, right) => {
            for (const clause of orderBy) {
              if (clause.name !== undefined) {
                const compared = left.name.localeCompare(right.name);
                if (compared !== 0) return clause.name === "asc" ? compared : -compared;
              }
              if (clause.id !== undefined) {
                const compared = left.id.localeCompare(right.id);
                if (compared !== 0) return clause.id === "asc" ? compared : -compared;
              }
            }
            return 0;
          });
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...catalogItemTable.values()].find(
          (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
        ) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: CatalogItemRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          kind: data.kind,
          name: data.name,
          taxRateId: data.taxRateId,
          referencePriceAmount: toDecimalStringOrNull(data.referencePriceAmount),
          referencePriceCurrency: data.referencePriceCurrency ?? null,
          // Mirrors the schema default so an omitted flag still lands active.
          isActive: data.isActive ?? true,
          // Mirrors the schema default so an omitted flag still tracks stock.
          tracksStock: data.tracksStock ?? true,
          createdAt: now,
          updatedAt: now,
        };
        catalogItemTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of catalogItemTable.values()) {
          if (candidate.id !== where.id || candidate.tenantId !== where.tenantId) continue;
          if (where.isActive !== undefined && candidate.isActive !== where.isActive) continue;
          if (data.kind !== undefined) candidate.kind = data.kind;
          if (data.name !== undefined) candidate.name = data.name;
          if (data.taxRateId !== undefined) candidate.taxRateId = data.taxRateId;
          if (data.referencePriceAmount !== undefined) {
            candidate.referencePriceAmount = toDecimalStringOrNull(data.referencePriceAmount);
          }
          if (data.referencePriceCurrency !== undefined) {
            candidate.referencePriceCurrency = data.referencePriceCurrency ?? null;
          }
          if (data.isActive !== undefined) candidate.isActive = data.isActive;
          if (data.tracksStock !== undefined) candidate.tracksStock = data.tracksStock;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    supplier: {
      findMany: ({ where, orderBy }) => {
        let rows = [...supplierTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy) {
          rows = rows.sort((left, right) => {
            for (const clause of orderBy) {
              if (clause.name !== undefined) {
                const compared = left.name.localeCompare(right.name);
                if (compared !== 0) return clause.name === "asc" ? compared : -compared;
              }
              if (clause.id !== undefined) {
                const compared = left.id.localeCompare(right.id);
                if (compared !== 0) return clause.id === "asc" ? compared : -compared;
              }
            }
            return 0;
          });
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...supplierTable.values()].find(
          (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
        ) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: SupplierRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          name: data.name,
          legalName: data.legalName ?? null,
          taxId: data.taxId ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          address: data.address ?? null,
          // Mirrors the schema default so an omitted flag still lands active.
          isActive: data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        supplierTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of supplierTable.values()) {
          if (candidate.id !== where.id || candidate.tenantId !== where.tenantId) continue;
          if (where.isActive !== undefined && candidate.isActive !== where.isActive) continue;
          if (data.name !== undefined) candidate.name = data.name;
          if (data.legalName !== undefined) candidate.legalName = data.legalName;
          if (data.taxId !== undefined) candidate.taxId = data.taxId;
          if (data.email !== undefined) candidate.email = data.email;
          if (data.phone !== undefined) candidate.phone = data.phone;
          if (data.address !== undefined) candidate.address = data.address;
          if (data.isActive !== undefined) candidate.isActive = data.isActive;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    purchase: {
      findFirst: ({ where, include }) => {
        const header =
          [...purchaseTable.values()].find(
            (candidate) =>
              (where.id === undefined || candidate.id === where.id) &&
              (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
              (where.status === undefined || candidate.status === where.status)
          ) ?? null;
        if (!header) return null;
        return include?.lines
          ? { ...header, lines: linesForPurchase(purchaseLineTable, header.id) }
          : { ...header, lines: [] };
      },
      findMany: ({ where, include, orderBy }) => {
        const headers = [...purchaseTable.values()].filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.status === undefined || candidate.status === where.status)
        );
        const ordered = orderBy === undefined ? headers : orderPurchases(headers, orderBy);
        return ordered.map((header) =>
          include?.lines
            ? { ...header, lines: linesForPurchase(purchaseLineTable, header.id) }
            : { ...header, lines: [] }
        );
      },
      create: ({ data }) => {
        const now = new Date();
        const created: PurchaseHeaderRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          supplierId: data.supplierId,
          // Mirrors the schema default so an omitted status still lands DRAFT.
          status: data.status ?? "DRAFT",
          createdAt: now,
          updatedAt: now,
        };
        purchaseTable.set(created.id, created);
        // Nested create: the line inherits the header's tenant and purchase id,
        // exactly as Prisma fills them from the parent relation.
        for (const line of data.lines.create) {
          const lineNow = new Date();
          const createdLine: PurchaseLineRow = {
            id: randomUUID(),
            tenantId: created.tenantId,
            purchaseId: created.id,
            catalogItemId: line.catalogItemId,
            quantity: toDecimalString(line.quantity),
            unitCost: toDecimalStringOrNull(line.unitCost),
            createdAt: lineNow,
            updatedAt: lineNow,
          };
          purchaseLineTable.set(createdLine.id, createdLine);
        }
        return { ...created, lines: linesForPurchase(purchaseLineTable, created.id) };
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of purchaseTable.values()) {
          if (where.id !== undefined && candidate.id !== where.id) continue;
          if (where.tenantId !== undefined && candidate.tenantId !== where.tenantId) continue;
          if (where.status !== undefined && candidate.status !== where.status) continue;
          if (data.supplierId !== undefined) candidate.supplierId = data.supplierId;
          if (data.status !== undefined) candidate.status = data.status;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    purchaseLine: {
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, line] of purchaseLineTable) {
          if (line.tenantId !== where.tenantId) continue;
          if (line.purchaseId !== where.purchaseId) continue;
          if (where.catalogItemId.notIn.includes(line.catalogItemId)) continue;
          purchaseLineTable.delete(id);
          count += 1;
        }
        return { count };
      },
      upsert: ({ where, create, update }) => {
        const key = where.tenantId_purchaseId_catalogItemId;
        const existing = [...purchaseLineTable.values()].find(
          (line) =>
            line.tenantId === key.tenantId &&
            line.purchaseId === key.purchaseId &&
            line.catalogItemId === key.catalogItemId
        );
        const now = new Date();
        if (existing) {
          existing.quantity = toDecimalString(update.quantity);
          existing.unitCost = toDecimalStringOrNull(update.unitCost);
          existing.updatedAt = now;
          return existing;
        }
        const created: PurchaseLineRow = {
          id: randomUUID(),
          tenantId: create.tenantId,
          purchaseId: create.purchaseId,
          catalogItemId: create.catalogItemId,
          quantity: toDecimalString(create.quantity),
          unitCost: toDecimalStringOrNull(create.unitCost),
          createdAt: now,
          updatedAt: now,
        };
        purchaseLineTable.set(created.id, created);
        return created;
      },
    },
    sale: {
      findFirst: ({ where, include }) => {
        const header =
          [...saleTable.values()].find(
            (candidate) =>
              (where.id === undefined || candidate.id === where.id) &&
              (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
              (where.status === undefined || candidate.status === where.status)
          ) ?? null;
        if (!header) return null;
        return include?.lines
          ? { ...header, lines: linesForSale(saleLineTable, header.id) }
          : { ...header, lines: [] };
      },
      findMany: ({ where, include, orderBy }) => {
        const headers = [...saleTable.values()].filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.status === undefined || candidate.status === where.status)
        );
        const ordered = orderBy === undefined ? headers : orderSales(headers, orderBy);
        return ordered.map((header) =>
          include?.lines
            ? { ...header, lines: linesForSale(saleLineTable, header.id) }
            : { ...header, lines: [] }
        );
      },
      create: ({ data }) => {
        const now = new Date();
        const created: SaleHeaderRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          customerId: data.customerId ?? null,
          currency: data.currency,
          // Mirrors the schema default so an omitted status still lands DRAFT.
          status: data.status ?? "DRAFT",
          createdAt: now,
          updatedAt: now,
        };
        saleTable.set(created.id, created);
        // Nested create: the line inherits the header's tenant and sale id,
        // exactly as Prisma fills them from the parent relation.
        for (const line of data.lines.create) {
          const lineNow = new Date();
          const createdLine: SaleLineRow = {
            id: randomUUID(),
            tenantId: created.tenantId,
            saleId: created.id,
            catalogItemId: line.catalogItemId,
            rateCode: line.rateCode,
            unitPrice: toDecimalString(line.unitPrice),
            quantity: toDecimalString(line.quantity),
            lineTotal: toDecimalString(line.lineTotal),
            taxableBase: toDecimalString(line.taxableBase),
            taxAmount: toDecimalString(line.taxAmount),
            createdAt: lineNow,
            updatedAt: lineNow,
          };
          saleLineTable.set(createdLine.id, createdLine);
        }
        return { ...created, lines: linesForSale(saleLineTable, created.id) };
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of saleTable.values()) {
          if (where.id !== undefined && candidate.id !== where.id) continue;
          if (where.tenantId !== undefined && candidate.tenantId !== where.tenantId) continue;
          if (where.status !== undefined && candidate.status !== where.status) continue;
          if (data.customerId !== undefined) candidate.customerId = data.customerId;
          if (data.status !== undefined) candidate.status = data.status;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    saleLine: {
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, line] of saleLineTable) {
          if (line.tenantId !== where.tenantId) continue;
          if (line.saleId !== where.saleId) continue;
          if (where.catalogItemId.notIn.includes(line.catalogItemId)) continue;
          saleLineTable.delete(id);
          count += 1;
        }
        return { count };
      },
      upsert: ({ where, create, update }) => {
        const key = where.tenantId_saleId_catalogItemId;
        const existing = [...saleLineTable.values()].find(
          (line) =>
            line.tenantId === key.tenantId &&
            line.saleId === key.saleId &&
            line.catalogItemId === key.catalogItemId
        );
        const now = new Date();
        if (existing) {
          existing.rateCode = update.rateCode;
          existing.unitPrice = toDecimalString(update.unitPrice);
          existing.quantity = toDecimalString(update.quantity);
          existing.lineTotal = toDecimalString(update.lineTotal);
          existing.taxableBase = toDecimalString(update.taxableBase);
          existing.taxAmount = toDecimalString(update.taxAmount);
          existing.updatedAt = now;
          return existing;
        }
        const created: SaleLineRow = {
          id: randomUUID(),
          tenantId: create.tenantId,
          saleId: create.saleId,
          catalogItemId: create.catalogItemId,
          rateCode: create.rateCode,
          unitPrice: toDecimalString(create.unitPrice),
          quantity: toDecimalString(create.quantity),
          lineTotal: toDecimalString(create.lineTotal),
          taxableBase: toDecimalString(create.taxableBase),
          taxAmount: toDecimalString(create.taxAmount),
          createdAt: now,
          updatedAt: now,
        };
        saleLineTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const line of saleLineTable.values()) {
          if (line.tenantId !== where.tenantId) continue;
          if (line.saleId !== where.saleId) continue;
          if (line.catalogItemId !== where.catalogItemId) continue;
          line.lineTotal = toDecimalString(data.lineTotal);
          line.taxableBase = toDecimalString(data.taxableBase);
          line.taxAmount = toDecimalString(data.taxAmount);
          line.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    payment: {
      create: ({ data }) => {
        const now = new Date();
        const created: PaymentRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          saleId: data.saleId,
          method: data.method,
          amount: toDecimalString(data.amount),
          createdAt: now,
          updatedAt: now,
        };
        paymentTable.set(created.id, created);
        return created;
      },
      findMany: ({ where, orderBy }) => {
        const rows = [...paymentTable.values()].filter(
          (candidate) => candidate.tenantId === where.tenantId && candidate.saleId === where.saleId
        );
        return orderBy === undefined ? rows : orderCashRows(rows, orderBy);
      },
    },
    idempotencyRecord: {
      findFirst: ({ where }) =>
        [...idempotencyRecordTable.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.operation === where.operation &&
            candidate.key === where.key
        ) ?? null,
      create: ({ data }) => {
        const created: IdempotencyRecordRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          operation: data.operation,
          key: data.key,
          fingerprint: data.fingerprint,
          resultSaleId: data.resultSaleId,
          createdAt: new Date(),
        };
        idempotencyRecordTable.set(created.id, created);
        return created;
      },
    },
    invoice: {
      findFirst: ({ where, include }) => {
        assertInvoiceTenantScope(where);
        const header =
          [...invoiceTable.values()].find(
            (candidate) =>
              (where.id === undefined || candidate.id === where.id) &&
              candidate.tenantId === where.tenantId &&
              (where.status === undefined || candidate.status === where.status)
          ) ?? null;
        if (!header) return null;
        return {
          ...header,
          lines: include?.lines ? linesForInvoice(invoiceLineTable, header.id, include) : [],
        };
      },
      findMany: ({ where, include, orderBy }) => {
        assertInvoiceTenantScope(where);
        const headers = [...invoiceTable.values()].filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            candidate.tenantId === where.tenantId &&
            (where.status === undefined || candidate.status === where.status)
        );
        const ordered = orderBy === undefined ? headers : orderInvoices(headers, orderBy);
        return ordered.map((header) => ({
          ...header,
          lines: include?.lines ? linesForInvoice(invoiceLineTable, header.id, include) : [],
        }));
      },
      create: ({ data }) => {
        const series = data.series ?? "A";
        const number = data.number ?? null;
        // Mirrors the schema default so an omitted status still lands DRAFT.
        const status = data.status ?? "DRAFT";
        // Partial unique index `invoice_tenant_id_sale_id_key`: at most ONE live
        // (non-CANCELLED) invoice per `(tenant, sale)`. The index participates on
        // BOTH sides — an existing CANCELLED row never blocks, and a CANCELLED
        // row being created can never collide — so a cancelled invoice falls
        // outside the index and releases its sale (DEC-043).
        const liveForSale =
          status !== "CANCELLED" &&
          [...invoiceTable.values()].some(
            (candidate) =>
              candidate.tenantId === data.tenantId &&
              candidate.saleId === data.saleId &&
              candidate.status !== "CANCELLED"
          );
        if (liveForSale) {
          throw uniqueConstraintError("Invoice", "invoice_tenant_id_sale_id_key");
        }
        // Allocation key `invoice_tenant_id_series_number_key`: PostgreSQL keeps
        // NULLs distinct, so unnumbered drafts coexist and only a real number
        // collides.
        if (
          number !== null &&
          [...invoiceTable.values()].some(
            (candidate) =>
              candidate.tenantId === data.tenantId &&
              candidate.series === series &&
              candidate.number === number
          )
        ) {
          throw uniqueConstraintError("Invoice", "invoice_tenant_id_series_number_key");
        }
        // `invoice_line_tenant_id_invoice_id_position_key`: one line per position
        // inside one invoice. Checked up front so a duplicate rejects the whole
        // create instead of leaving a half-written document behind.
        const positions = new Set<number>();
        for (const line of data.lines.create) {
          if (positions.has(line.position)) {
            throw uniqueConstraintError(
              "InvoiceLine",
              "invoice_line_tenant_id_invoice_id_position_key"
            );
          }
          positions.add(line.position);
        }
        const now = new Date();
        const created: InvoiceHeaderRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          saleId: data.saleId,
          customerId: data.customerId ?? null,
          currency: data.currency,
          status,
          series,
          number,
          confirmedAt: data.confirmedAt ?? null,
          cancelledAt: data.cancelledAt ?? null,
          cancelReason: data.cancelReason ?? null,
          createdAt: now,
          updatedAt: now,
        };
        invoiceTable.set(created.id, created);
        // Nested create: the line inherits the header's tenant and invoice id,
        // exactly as Prisma fills them from the parent relation.
        for (const line of data.lines.create) {
          const createdLine: InvoiceLineRow = {
            id: randomUUID(),
            tenantId: created.tenantId,
            invoiceId: created.id,
            catalogItemId: line.catalogItemId,
            position: line.position,
            description: line.description,
            rateCode: line.rateCode,
            unitPrice: toDecimalString(line.unitPrice),
            quantity: toDecimalString(line.quantity),
            lineTotal: toDecimalString(line.lineTotal),
            taxableBase: toDecimalString(line.taxableBase),
            taxAmount: toDecimalString(line.taxAmount),
            createdAt: now,
          };
          invoiceLineTable.set(createdLine.id, createdLine);
        }
        return { ...created, lines: linesForInvoice(invoiceLineTable, created.id, undefined) };
      },
      count: ({ where } = {}) =>
        [...invoiceTable.values()].filter(
          (candidate) =>
            (where?.id === undefined || candidate.id === where.id) &&
            (where?.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where?.status === undefined || candidate.status === where.status)
        ).length,
    },
    invoiceNumberSequence: {
      findUnique: ({ where }) => {
        const key = resolveInvoiceSequenceKey(where);
        return (
          [...invoiceNumberSequenceTable.values()].find(
            (candidate) => candidate.tenantId === key.tenantId && candidate.series === key.series
          ) ?? null
        );
      },
      upsert: ({ where, create, update }) => {
        const key = resolveInvoiceSequenceKey(where);
        const existing = [...invoiceNumberSequenceTable.values()].find(
          (candidate) => candidate.tenantId === key.tenantId && candidate.series === key.series
        );
        const now = new Date();
        if (existing) {
          if (update.nextValue !== undefined) {
            existing.nextValue =
              typeof update.nextValue === "number"
                ? update.nextValue
                : existing.nextValue + update.nextValue.increment;
          }
          existing.updatedAt = now;
          return existing;
        }
        const created: InvoiceNumberSequenceRow = {
          id: randomUUID(),
          tenantId: create.tenantId,
          // Mirrors the schema default so an omitted series still lands `A`.
          series: create.series ?? "A",
          // Mirrors the schema default so an omitted counter still starts at 1.
          nextValue: create.nextValue ?? 1,
          createdAt: now,
          updatedAt: now,
        };
        invoiceNumberSequenceTable.set(created.id, created);
        return created;
      },
      update: ({ where, data }) => {
        const key = resolveInvoiceSequenceKey(where);
        const existing = [...invoiceNumberSequenceTable.values()].find(
          (candidate) => candidate.tenantId === key.tenantId && candidate.series === key.series
        );
        if (!existing) {
          // Structural P2025 mirrors the real delegate's rejected shape.
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.nextValue !== undefined) {
          existing.nextValue =
            typeof data.nextValue === "number"
              ? data.nextValue
              : existing.nextValue + data.nextValue.increment;
        }
        existing.updatedAt = new Date();
        return existing;
      },
    },
    cashRegister: {
      findFirst: ({ where }) =>
        [...cashRegisterTable.values()].find(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.tenantId === undefined || candidate.tenantId === where.tenantId)
        ) ?? null,
      findMany: ({ where, orderBy }) => {
        const rows = [...cashRegisterTable.values()].filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.tenantId === undefined || candidate.tenantId === where.tenantId)
        );
        return orderBy === undefined ? rows : orderCashRows(rows, orderBy);
      },
      create: ({ data }) => {
        const now = new Date();
        const created: CashRegisterRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          name: data.name,
          // Mirrors the schema default so an omitted flag still lands active.
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        cashRegisterTable.set(created.id, created);
        return created;
      },
    },
    cashSession: {
      findFirst: ({ where }) =>
        [...cashSessionTable.values()].find(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.status === undefined || candidate.status === where.status)
        ) ?? null,
      findMany: ({ where, orderBy }) => {
        const rows = [...cashSessionTable.values()].filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.status === undefined || candidate.status === where.status)
        );
        return orderBy === undefined ? rows : orderCashRows(rows, orderBy);
      },
      create: ({ data }) => {
        const now = new Date();
        const created: CashSessionRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          registerId: data.registerId,
          // Mirrors the schema default so an omitted status still lands OPEN.
          status: data.status ?? "OPEN",
          openedAt: now,
          openedByMembershipId: data.openedByMembershipId,
          openingAmount: toDecimalString(data.openingAmount),
          // Close results are written only by the close command (DEC-031).
          expectedAmount: null,
          countedAmount: null,
          differenceAmount: null,
          createdAt: now,
          updatedAt: now,
        };
        cashSessionTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const row of cashSessionTable.values()) {
          if (
            (where.id === undefined || row.id === where.id) &&
            (where.tenantId === undefined || row.tenantId === where.tenantId) &&
            (where.status === undefined || row.status === where.status)
          ) {
            if (data.status !== undefined) row.status = data.status;
            if (data.expectedAmount !== undefined) {
              row.expectedAmount = toDecimalString(data.expectedAmount);
            }
            if (data.countedAmount !== undefined) {
              row.countedAmount = toDecimalString(data.countedAmount);
            }
            if (data.differenceAmount !== undefined) {
              row.differenceAmount = toDecimalString(data.differenceAmount);
            }
            row.updatedAt = new Date();
            count += 1;
          }
        }
        return { count };
      },
    },
    cashMovement: {
      create: ({ data }) => {
        const now = new Date();
        const created: CashMovementRow = {
          id: data.id ?? randomUUID(),
          tenantId: data.tenantId,
          registerId: data.registerId,
          sessionId: data.sessionId,
          type: data.type,
          direction: data.direction ?? null,
          amount: toDecimalString(data.amount),
          reason: data.reason ?? null,
          createdAt: now,
        };
        cashMovementTable.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) => cashMovementTable.get(where.id) ?? null,
      findMany: ({ where, orderBy }) => {
        const rows = [...cashMovementTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.registerId === undefined || candidate.registerId === where.registerId) &&
            (where.sessionId === undefined || candidate.sessionId === where.sessionId)
        );
        return orderBy === undefined ? rows : orderCashRows(rows, orderBy);
      },
    },
    stockMovement: {
      create: ({ data }) => {
        const now = new Date();
        const created: StockMovementRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          catalogItemId: data.catalogItemId,
          type: data.type,
          quantity: toDecimalString(data.quantity),
          reason: data.reason,
          // Nullable reserved compensating link: nothing populates it in W2.
          reversesMovementId: data.reversesMovementId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        stockMovementTable.set(created.id, created);
        return created;
      },
      findMany: ({ where, orderBy }) => {
        const rows = [...stockMovementTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.catalogItemId === undefined || candidate.catalogItemId === where.catalogItemId)
        );
        return orderBy === undefined ? rows : orderStockMovements(rows, orderBy);
      },
    },
    stockBalance: {
      findFirst: ({ where }) =>
        [...stockBalanceTable.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId && candidate.catalogItemId === where.catalogItemId
        ) ?? null,
      findMany: ({ where, orderBy }) => {
        const rows = [...stockBalanceTable.values()].filter(
          (candidate) => candidate.tenantId === where.tenantId
        );
        return orderBy === undefined ? rows : orderStockBalances(rows, orderBy);
      },
      upsert: ({ where, create, update }) => {
        const key = where.tenantId_catalogItemId;
        const existing = [...stockBalanceTable.values()].find(
          (candidate) =>
            candidate.tenantId === key.tenantId && candidate.catalogItemId === key.catalogItemId
        );
        const now = new Date();
        if (existing) {
          existing.quantity = toDecimalString(update.quantity);
          existing.updatedAt = now;
          return existing;
        }
        const created: StockBalanceRow = {
          id: randomUUID(),
          tenantId: create.tenantId,
          catalogItemId: create.catalogItemId,
          quantity: toDecimalString(create.quantity),
          createdAt: now,
          updatedAt: now,
        };
        stockBalanceTable.set(created.id, created);
        return created;
      },
    },
    patient: {
      findMany: ({ where, orderBy }) => {
        let rows = [...patientTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.isActive === undefined || candidate.isActive === where.isActive) &&
            (where.id === undefined || where.id.in.includes(candidate.id))
        );
        if (orderBy?.name) {
          rows = rows.sort((left, right) => left.name.localeCompare(right.name));
          if (orderBy.name === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...patientTable.values()].find(
          (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
        ) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: PatientRow = { id: randomUUID(), ...data, createdAt: now, updatedAt: now };
        patientTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        const existing = patientTable.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return { count: 0 };
        }
        const updated: PatientRow = { ...existing, updatedAt: new Date() };
        if (data.name !== undefined) updated.name = data.name;
        if (data.speciesId !== undefined) updated.speciesId = data.speciesId;
        if (data.breedId !== undefined) updated.breedId = data.breedId ?? null;
        if (data.sex !== undefined) updated.sex = data.sex;
        if (data.birthDate !== undefined) updated.birthDate = data.birthDate ?? null;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        patientTable.set(updated.id, updated);
        return { count: 1 };
      },
    },
    patientGuardian: {
      findMany: ({ where, orderBy }) => {
        let rows = [...patientGuardianTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.patientId === undefined || candidate.patientId === where.patientId) &&
            (where.customerId === undefined || candidate.customerId === where.customerId) &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy?.position) {
          rows = rows.sort((left, right) => left.position - right.position);
          if (orderBy.position === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...patientGuardianTable.values()].find(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            candidate.tenantId === where.tenantId &&
            candidate.patientId === where.patientId &&
            (where.customerId === undefined || candidate.customerId === where.customerId) &&
            (where.isPrimary === undefined || candidate.isPrimary === where.isPrimary) &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        ) ?? null,
      create: ({ data }) => {
        const now = new Date();
        const created: PatientGuardianRow = {
          id: randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        patientGuardianTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of patientGuardianTable.values()) {
          if (where.id !== undefined && candidate.id !== where.id) continue;
          if (candidate.tenantId !== where.tenantId) continue;
          if (candidate.patientId !== where.patientId) continue;
          if (where.customerId !== undefined && candidate.customerId !== where.customerId) {
            continue;
          }
          if (where.isPrimary !== undefined && candidate.isPrimary !== where.isPrimary) continue;
          if (where.isActive !== undefined && candidate.isActive !== where.isActive) continue;
          if (data.isPrimary !== undefined) candidate.isPrimary = data.isPrimary;
          if (data.isActive !== undefined) candidate.isActive = data.isActive;
          if (data.position !== undefined) candidate.position = data.position;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    clinicalEncounter: {
      create: ({ data }) => {
        const now = new Date();
        const created: ClinicalEncounterRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          patientId: data.patientId,
          status: data.status ?? "DRAFT",
          clientSummary: data.clientSummary ?? null,
          internalNotes: data.internalNotes ?? null,
          closedAt: data.closedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        clinicalEncounterTable.set(created.id, created);
        return created;
      },
      // Returns the FULL row (including `internalNotes`): a portal regression
      // that forgets the allowlist must fail against this boundary.
      findMany: ({ where }) =>
        [...clinicalEncounterTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId && candidate.patientId === where.patientId
        ),
    },
    clinicalVaccination: {
      create: ({ data }) => {
        const now = new Date();
        const created: ClinicalVaccinationRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          patientId: data.patientId,
          vaccine: data.vaccine,
          administeredAt: data.administeredAt,
          createdAt: now,
          updatedAt: now,
        };
        clinicalVaccinationTable.set(created.id, created);
        return created;
      },
      findMany: ({ where }) =>
        [...clinicalVaccinationTable.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId && candidate.patientId === where.patientId
        ),
    },
    branch: {
      create: ({ data }) => {
        const now = new Date();
        const created: BranchRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          name: data.name,
          createdAt: now,
          updatedAt: now,
        };
        branchTable.set(created.id, created);
        return created;
      },
      findFirst: ({ where }) =>
        [...branchTable.values()].find(
          (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
        ) ?? null,
      findMany: ({ where, orderBy }) => {
        const rows = [...branchTable.values()].filter(
          (candidate) => candidate.tenantId === where.tenantId
        );
        if (orderBy?.name) {
          rows.sort((left, right) => left.name.localeCompare(right.name));
          if (orderBy.name === "desc") rows.reverse();
        }
        return rows;
      },
    },
    appointment: {
      findMany: ({ where, orderBy }) => {
        const rows = [...appointmentTable.values()].filter((candidate) =>
          matchesAppointment(where, candidate)
        );
        if (orderBy?.startAt) {
          rows.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
          if (orderBy.startAt === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...appointmentTable.values()].find((candidate) => matchesAppointment(where, candidate)) ??
        null,
      create: ({ data }) => {
        const now = new Date();
        const created: AppointmentRow = {
          id: randomUUID(),
          ...data,
          // Mirror the schema defaults the service relies on: provenance is
          // STAFF unless explicitly PORTAL, and the request link is nullable.
          source: data.source ?? "STAFF",
          portalBookingRequestId: data.portalBookingRequestId ?? null,
          // Mirror the nullable service column (EPIC-09 WU4): an omitted link
          // lands on `null`, exactly like the schema default.
          serviceId: data.serviceId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        appointmentTable.set(created.id, created);
        return created;
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of appointmentTable.values()) {
          if (!matchesAppointment(where, candidate)) continue;
          if (data.status !== undefined) candidate.status = data.status;
          if (data.startAt !== undefined) candidate.startAt = data.startAt;
          if (data.endAt !== undefined) candidate.endAt = data.endAt;
          if (data.serviceId !== undefined) candidate.serviceId = data.serviceId;
          if (data.version !== undefined) {
            candidate.version =
              typeof data.version === "number"
                ? data.version
                : candidate.version + data.version.increment;
          }
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    portalBookingRequest: {
      create: ({ data }) => {
        const now = new Date();
        const created: PortalBookingRequestRow = {
          id: randomUUID(),
          tenantId: data.tenantId,
          customerId: data.customerId,
          patientId: data.patientId,
          // Mirrors the schema default so a caller that omits it still gets
          // PENDING, exactly like Prisma.
          status: data.status ?? "PENDING",
          startAt: data.startAt,
          endAt: data.endAt,
          createdAt: now,
          updatedAt: now,
        };
        portalBookingRequestTable.set(created.id, created);
        return created;
      },
      findMany: ({ where, orderBy }) => {
        const rows = [...portalBookingRequestTable.values()].filter((candidate) =>
          matchesPortalBookingRequest(where, candidate)
        );
        if (orderBy?.startAt) {
          rows.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
          if (orderBy.startAt === "desc") rows.reverse();
        }
        return rows;
      },
      findFirst: ({ where }) =>
        [...portalBookingRequestTable.values()].find((candidate) =>
          matchesPortalBookingRequest(where, candidate)
        ) ?? null,
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of portalBookingRequestTable.values()) {
          if (!matchesPortalBookingRequest(where, candidate)) continue;
          candidate.status = data.status;
          candidate.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    role: {
      create: ({ data }) => {
        const created: RoleRow = { id: randomUUID(), code: data.code, name: data.name };
        roles.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) =>
        [...roles.values()].find((candidate) => candidate.code === where.code) ?? null,
      findMany: ({ where } = {}) => {
        const all = [...roles.values()];
        const codes = where?.code?.in;
        return codes ? all.filter((candidate) => codes.includes(candidate.code)) : all;
      },
    },
    permission: {
      create: ({ data }) => {
        const created: PermissionRow = { id: randomUUID(), key: data.key, name: data.name ?? "" };
        permissions.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) =>
        [...permissions.values()].find((candidate) => candidate.key === where.key) ?? null,
      findMany: ({ where, orderBy } = {}) => {
        const all = [...permissions.values()];
        const keys = where?.key?.in;
        const filtered = keys ? all.filter((candidate) => keys.includes(candidate.key)) : all;
        return orderBy?.key === "asc"
          ? filtered.sort((left, right) => left.key.localeCompare(right.key))
          : orderBy?.key === "desc"
            ? filtered.sort((left, right) => right.key.localeCompare(left.key))
            : filtered;
      },
    },
    rolePermission: {
      create: ({ data }) => {
        const created: RolePermissionRow = { id: randomUUID(), ...data };
        rolePermissions.set(created.id, created);
        return created;
      },
      findMany: ({ where }) =>
        [...rolePermissions.values()]
          .filter(
            (candidate) =>
              (where.roleId === undefined || candidate.roleId === where.roleId) &&
              (where.permissionId === undefined || candidate.permissionId === where.permissionId)
          )
          .map((candidate) => ({
            ...candidate,
            permission: {
              key:
                [...permissions.values()].find((entry) => entry.id === candidate.permissionId)
                  ?.key ?? "",
            },
          })),
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, candidate] of rolePermissions) {
          if (
            (where.roleId === undefined || candidate.roleId === where.roleId) &&
            (where.permissionId === undefined || candidate.permissionId === where.permissionId)
          ) {
            rolePermissions.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
    tenantRolePermissionOverride: {
      create: ({ data }) => {
        const created: TenantRolePermissionOverrideRow = { id: randomUUID(), ...data };
        rolePermissionOverrides.set(created.id, created);
        return created;
      },
      findMany: ({ where }) =>
        [...rolePermissionOverrides.values()].filter(
          (candidate) =>
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.roleId === undefined || candidate.roleId === where.roleId) &&
            (where.permissionKey === undefined || candidate.permissionKey === where.permissionKey)
        ),
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, candidate] of rolePermissionOverrides) {
          if (
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.roleId === undefined || candidate.roleId === where.roleId) &&
            (where.permissionKey === undefined || candidate.permissionKey === where.permissionKey)
          ) {
            rolePermissionOverrides.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
    tenantSettingNamespace: {
      findUnique: ({ where }) =>
        [...settingNamespaces.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId_namespace.tenantId &&
            candidate.namespace === where.tenantId_namespace.namespace
        ) ?? null,
      findMany: ({ where } = {}) =>
        [...settingNamespaces.values()].filter(
          (candidate) =>
            (where?.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where?.namespace === undefined || candidate.namespace === where.namespace)
        ),
      create: ({ data }) => {
        const now = new Date();
        const created: TenantSettingNamespaceRow = {
          id: randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        settingNamespaces.set(created.id, created);
        return created;
      },
      update: ({ where, data }) => {
        const existing = [...settingNamespaces.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId_namespace.tenantId &&
            candidate.namespace === where.tenantId_namespace.namespace
        );
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.schemaVersion !== undefined) existing.schemaVersion = data.schemaVersion;
        if (data.data !== undefined) existing.data = data.data;
        existing.updatedAt = new Date();
        return existing;
      },
      upsert: ({ where, create, update }) => {
        const existing = [...settingNamespaces.values()].find(
          (candidate) =>
            candidate.tenantId === where.tenantId_namespace.tenantId &&
            candidate.namespace === where.tenantId_namespace.namespace
        );
        if (existing) {
          if (update.schemaVersion !== undefined) existing.schemaVersion = update.schemaVersion;
          if (update.data !== undefined) existing.data = update.data;
          existing.updatedAt = new Date();
          return existing;
        }
        const now = new Date();
        const created: TenantSettingNamespaceRow = {
          id: randomUUID(),
          ...create,
          createdAt: now,
          updatedAt: now,
        };
        settingNamespaces.set(created.id, created);
        return created;
      },
      deleteMany: ({ where }) => {
        let count = 0;
        for (const [id, candidate] of settingNamespaces) {
          if (
            (where.tenantId === undefined || candidate.tenantId === where.tenantId) &&
            (where.namespace === undefined || candidate.namespace === where.namespace)
          ) {
            settingNamespaces.delete(id);
            count += 1;
          }
        }
        return { count };
      },
    },
    userProfile: {
      create: ({ data }) => {
        const created: UserProfileRow = {
          id: randomUUID(),
          email: data.email,
          displayName: data.displayName,
          status: data.status,
        };
        profiles.set(created.id, created);
        return created;
      },
    },
    staffSession: {
      create: ({ data }) => {
        const created: StaffSessionRow = { id: randomUUID(), revokedAt: null, ...data };
        sessions.set(created.tokenHash, created);
        return created;
      },
      findUnique: ({ where }) => sessions.get(where.tokenHash) ?? null,
      update: ({ where, data }) => {
        const existing = [...sessions.values()].find((entry) => entry.id === where.id);
        // Structural P2025 mirrors the real delegate's rejected promise shape
        // (session.service detects lost races via err.code).
        if (!existing) {
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        Object.assign(existing, data);
        return existing;
      },
      deleteMany: ({ where }) => ({ count: sessions.delete(where.tokenHash) ? 1 : 0 }),
    },
    tenantMembership: {
      create: ({ data }) => {
        const created: TenantMembershipRow = {
          id: randomUUID(),
          createdAt: data.createdAt ?? new Date("2026-01-01T00:00:00Z"),
          ...data,
        };
        memberships.set(created.id, created);
        return created;
      },
      findFirst: ({ where, orderBy, include, select }) => {
        const matched = orderMemberships(
          [...memberships.values()].filter(
            (candidate) => matches(where, candidate) && roleCodeMatches(where, candidate)
          ),
          orderBy
        );
        const candidate = matched[0];
        if (!candidate) return null;
        if (include?.role || select?.role) {
          // Reproduce the relational join: role row looked up by FK
          // (`id` included since EPIC-02 forwards roleId through ALS).
          const joinedRole = roles.get(candidate.roleId);
          return {
            ...candidate,
            role: { code: joinedRole?.code ?? "", id: joinedRole?.id ?? candidate.roleId },
          };
        }
        return candidate;
      },
      findMany: ({ where, orderBy, include, select }) => {
        const rows = orderMemberships(
          [...memberships.values()].filter(
            (candidate) => matches(where, candidate) && roleCodeMatches(where, candidate)
          ),
          orderBy
        );
        if (!include?.role && !select?.role) return rows;
        return rows.map((candidate) => ({
          ...candidate,
          role: { code: roles.get(candidate.roleId)?.code ?? "", id: candidate.roleId },
        }));
      },
      updateMany: ({ where, data }) => {
        let count = 0;
        for (const candidate of memberships.values()) {
          if (!matches(where, candidate)) continue;
          candidate.status = data.status as TenantMembershipRow["status"];
          count += 1;
        }
        return { count };
      },
      update: ({ where, data }) => {
        const existing = memberships.get(where.id);
        if (!existing) {
          // Structural P2025 mirrors the real delegate's rejected shape.
          throw Object.assign(new Error("Record not found"), { code: "P2025" });
        }
        if (data.roleId !== undefined) existing.roleId = data.roleId;
        if (data.status !== undefined) {
          existing.status = data.status as TenantMembershipRow["status"];
        }
        return existing;
      },
    },
    auditLog: {
      create: ({ data }) => {
        const created: AuditLogRow = { id: randomUUID(), ...data };
        audits.set(created.id, created);
        return created;
      },
      findFirst: ({ where }) =>
        [...audits.values()].find(
          (candidate) =>
            (where.action === undefined || candidate.action === where.action) &&
            (where.requestId === undefined || candidate.requestId === where.requestId)
        ) ?? null,
      findMany: ({ where } = {}) =>
        [...audits.values()].filter(
          (candidate) =>
            (where?.action === undefined || candidate.action === where.action) &&
            (where?.requestId === undefined || candidate.requestId === where.requestId)
        ),
    },
    featureCode: {
      create: ({ data }) => {
        const created: FeatureCodeRow = { id: randomUUID(), code: data.code };
        featureCodes.set(created.id, created);
        return created;
      },
      findUnique: ({ where }) =>
        [...featureCodes.values()].find((candidate) => candidate.code === where.code) ?? null,
    },
    tenantEntitlement: {
      create: ({ data }) => {
        const created: TenantEntitlementRow = { id: randomUUID(), ...data };
        entitlements.set(created.id, created);
        return created;
      },
      // Reproduces the relation filter of the real delegate: the grant must
      // reference a feature_code whose code matches.
      findFirst: ({ where }) =>
        [...entitlements.values()].find((candidate) => {
          if (candidate.tenantId !== where.tenantId) return false;
          const linkedCode = featureCodes.get(candidate.featureCodeId)?.code;
          return linkedCode === where.featureCode.code;
        }) ?? null,
    },
  };

  const storage = new InMemoryStorageDriver();

  return {
    prisma,
    tables: {
      tenants,
      roles,
      profiles,
      sessions,
      memberships,
      audits,
      featureCodes,
      entitlements,
      permissions,
      rolePermissions,
      rolePermissionOverrides,
      settingNamespaces,
      tenantBrandings,
      brandingAssets,
      brandingResetCleanupIntents,
      customers,
      customerAddresses,
      customerContacts,
      portalAccess,
      portalCredentials,
      portalSessions,
      species: speciesTable,
      breeds: breedTable,
      taxRates: taxRateTable,
      catalogItems: catalogItemTable,
      stockMovements: stockMovementTable,
      stockBalances: stockBalanceTable,
      suppliers: supplierTable,
      purchases: purchaseTable,
      purchaseLines: purchaseLineTable,
      sales: saleTable,
      saleLines: saleLineTable,
      payments: paymentTable,
      idempotencyRecords: idempotencyRecordTable,
      invoices: invoiceTable,
      invoiceLines: invoiceLineTable,
      invoiceNumberSequences: invoiceNumberSequenceTable,
      cashRegisters: cashRegisterTable,
      cashSessions: cashSessionTable,
      cashMovements: cashMovementTable,
      patients: patientTable,
      patientGuardians: patientGuardianTable,
      clinicalEncounters: clinicalEncounterTable,
      clinicalVaccinations: clinicalVaccinationTable,
      branches: branchTable,
      appointments: appointmentTable,
      portalBookingRequests: portalBookingRequestTable,
    },
    storage,
  };
}
