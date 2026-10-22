import { z } from "zod";

/**
 * The reporting response contract (EPIC-18 REP-002, [[DEC-062]]).
 *
 * Data classification (PRD §41): almost every value here is INTERNAL — aggregate
 * counts, calendar dates and money totals of the tenant's OWN confirmed sales,
 * cash ledger, received purchases, inventory, closed consultations and
 * registered patients. No customer, clinical or fiscal identity is read, and no
 * RESTRICTED payload crosses this boundary: the veterinary period reports read a
 * patient row as an `id` plus its `created_at` and a clinical encounter as an
 * `id` plus its close instant and correction link, so no patient name and no
 * clinical free text is ever loaded. Prisma models are never returned; only the
 * keys declared here leave the process.
 *
 * The ONE deliberate exception is the two DUE reports (`vaccines-due`,
 * `deworming-due`), which carry `Patient.name` — CONFIDENTIAL — because a list
 * of due vaccinations nobody can act on is not a report. They carry the name and
 * the two dates and NO clinical content whatsoever, and each of their row DTOs
 * states that boundary in place. No report on this surface ever reads
 * `ClinicalEncounter.internalNotes`, `diagnosis`, `anamnesis` or any other
 * clinical free text.
 *
 * Decimal projections are fixed-scale exact strings at their stored column scale
 * (`Decimal(14, 2)` for every money aggregate), never JavaScript floats and never
 * `number`s: `"0.10"` is the value, and `0.1 + 0.2` cannot appear in a response
 * because no aggregate in the reporting path is ever held as a float.
 */

/**
 * The period echo. It exists so a caller can PROVE what was aggregated: the same
 * resolved range the query applied, in both of its representations — the
 * calendar dates a human asked for and the half-open instant range that was
 * actually queried ([[DEC-063]]).
 */
export interface ReportPeriodDto {
  /** The preset that produced the range, or `null` for a custom `from`/`to` pair. */
  readonly preset: string | null;
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly fromDate: string;
  /** `YYYY-MM-DD` in the tenant zone, inclusive. */
  readonly toDate: string;
  /** The zone the boundaries were resolved in. Never a request parameter. */
  readonly timeZone: string;
  /** ISO 8601 instant — the INCLUSIVE start of `fromDate`. */
  readonly fromInstant: string;
  /** ISO 8601 instant — the EXCLUSIVE end: the first instant of the day after `toDate`. */
  readonly toInstant: string;
}

/**
 * One calendar day of the report, in the TENANT's day. `bucketDate` is the
 * local day a sale's `completedAt` belongs to, so a sale completed at 23:30 local
 * is counted on that day and not on the next UTC one.
 */
export interface SalesByPeriodRowDto {
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly bucketDate: string;
  /** Completed sales whose event instant falls on this local day. */
  readonly saleCount: number;
  /** Sum of the line taxable bases, exact fixed-scale (2 decimals), e.g. `"10.10"`. */
  readonly net: string;
  /** Sum of the line tax amounts, exact fixed-scale (2 decimals). */
  readonly tax: string;
  /** Sum of the line totals (tax included), exact fixed-scale (2 decimals). */
  readonly gross: string;
}

/**
 * `GET /reports/sales-by-period` (PRD §31). `currency` is the tenant's
 * server-resolved sale currency ([[DEC-022]]) and there is deliberately no
 * conversion column: no conversion exists anywhere in the system.
 */
export interface SalesByPeriodResponse {
  readonly report: "sales-by-period";
  readonly period: ReportPeriodDto;
  /** ISO-4217 code of the tenant's configured sale currency. */
  readonly currency: string;
  /** Completed sales in the whole period — the sum of the row counts. */
  readonly saleCount: number;
  /** Exact fixed-scale (2 decimals) period total. */
  readonly totalNet: string;
  /** Exact fixed-scale (2 decimals) period total. */
  readonly totalTax: string;
  /** Exact fixed-scale (2 decimals) period total. */
  readonly totalGross: string;
  /** Ascending by `bucketDate`. An empty period is `[]`, never an error. */
  readonly rows: SalesByPeriodRowDto[];
}

/**
 * One tender of the period (`GET /reports/payment-methods`, [[REP-003]]).
 *
 * The period predicate is the SALE's `completedAt`, never `Payment.createdAt`: a
 * payment row is written only by the `CompleteSale` transaction ([[DEC-029]]), so
 * its own timestamp is an implementation detail of the same commit and the two
 * reports that describe one revenue must not be able to cut it differently.
 */
export interface PaymentMethodRowDto {
  /** The `PaymentMethod` enum literal — `CASH`, `CARD`, `BANK_TRANSFER`, `QR`, `CHECK`, `OTHER`. */
  readonly method: string;
  /** Payments recorded with this method in the period. */
  readonly paymentCount: number;
  /** Summed `Decimal(14, 2)` amount, exact fixed-scale (2 decimals). */
  readonly amount: string;
  /**
   * `amount / totalGross` as a fixed-scale (4 decimals) string. `"0.0000"` when
   * the period's gross is zero: the share is a refusal to divide, never a NaN.
   * Rounded shares need not add to `"1.0000"`.
   */
  readonly shareOfGross: string;
}

/**
 * `GET /reports/payment-methods` (PRD §31, [[REP-003]]): how the money arrived.
 * It reads `payment`, never `cash_movement` — `cash_movement` carries no
 * `sale_id`, so the two ledgers answer different questions and never substitute
 * for each other.
 */
export interface PaymentMethodsResponse {
  readonly report: "payment-methods";
  readonly period: ReportPeriodDto;
  /** ISO-4217 code of the tenant's configured sale currency. */
  readonly currency: string;
  /** Every payment amount in the period, exact fixed-scale (2 decimals). */
  readonly totalGross: string;
  /** `amount` descending, then `method` ascending. An empty period is `[]`. */
  readonly rows: PaymentMethodRowDto[];
}

/**
 * One catalog item that earned revenue in the period (`GET
 * /reports/sales-by-product-service`, [[REP-003]]).
 */
export interface SalesByProductServiceRowDto {
  /** The frozen `sale_line.catalog_item_id` the lines were grouped by. */
  readonly catalogItemId: string;
  /** The item's name as the catalog holds it today (INTERNAL). */
  readonly name: string;
  /** `CatalogItem.kind` as a fact about the item — `PRODUCT`, `SERVICE`, `MEDICATION`, `SUPPLY`. */
  readonly kind: string;
  /** Summed `Decimal(10, 3)` quantity, exact fixed-scale (3 decimals), e.g. `"3.500"`. */
  readonly quantity: string;
  /** Summed taxable base, exact fixed-scale (2 decimals). */
  readonly net: string;
  /** Summed tax amount, exact fixed-scale (2 decimals). */
  readonly tax: string;
  /** Summed line total (tax included), exact fixed-scale (2 decimals). */
  readonly gross: string;
}

/** The `kind` roll-up of {@link SalesByProductServiceRowDto}, on both scales. */
export interface KindTotalDto {
  /** Exact fixed-scale (2 decimals). */
  readonly net: string;
  /** Exact fixed-scale (2 decimals). */
  readonly tax: string;
  /** Exact fixed-scale (2 decimals). */
  readonly gross: string;
  /** Exact fixed-scale (3 decimals) — the ledger's quantity scale. */
  readonly quantity: string;
}

/**
 * `GET /reports/sales-by-product-service` (PRD §31, [[REP-003]]): which products
 * and services earned the money. Only `COMPLETED` sales contribute; an item with
 * no sale in the period, or sold only in a cancelled one, does not appear.
 */
export interface SalesByProductServiceResponse {
  readonly report: "sales-by-product-service";
  readonly period: ReportPeriodDto;
  /** ISO-4217 code of the tenant's configured sale currency. */
  readonly currency: string;
  /**
   * Per `kind` that actually appears in the period, keyed by the enum literal.
   * A kind with no line in the period is ABSENT, never a zero row: a zero would
   * claim the tenant sold nothing under it, which the report did not measure.
   */
  readonly totalsByKind: Record<string, KindTotalDto>;
  /** `gross` descending, then `name` ascending. An empty period is `[]`. */
  readonly rows: SalesByProductServiceRowDto[];
}

/**
 * One CLOSED cash session of the period (`GET /reports/cash-sessions`,
 * [[REP-004]]).
 *
 * An OPEN session never appears: it has no close result and no close instant, so
 * reporting it would print NULLs — or, worse, zeros — for a drawer that was
 * never counted. `CLOSED` is terminal ([[DEC-036]]), so these four amounts are
 * written exactly once by the close command ([[DEC-031]]) and this report only
 * READS them.
 */
export interface CashSessionRowDto {
  /** The `cash_session` id the close result belongs to. */
  readonly sessionId: string;
  /** The register the drawer belonged to. */
  readonly registerId: string;
  /** ISO 8601 instant the session was opened (context, never the period predicate). */
  readonly openedAt: string;
  /** ISO 8601 instant of the `OPEN` → `CLOSED` transition — the period predicate. */
  readonly closedAt: string;
  /** The stored opening float, exact fixed-scale (2 decimals). */
  readonly openingAmount: string;
  /** The stored server-computed expected amount, exact fixed-scale (2 decimals). */
  readonly expectedAmount: string;
  /** The stored operator-counted amount, exact fixed-scale (2 decimals). */
  readonly countedAmount: string;
  /**
   * The stored `countedAmount - expectedAmount`, exact fixed-scale (2 decimals),
   * NEGATIVE when the drawer is short. It is the AUTHORITATIVE value: the report
   * asserts it against the other two amounts and never recomputes it in place of
   * the stored one.
   */
  readonly differenceAmount: string;
}

/** The period roll-up of {@link CashSessionRowDto}, at the money scale. */
export interface CashSessionsTotalsDto {
  /** Exact fixed-scale (2 decimals). */
  readonly expected: string;
  /** Exact fixed-scale (2 decimals). */
  readonly counted: string;
  /** Exact fixed-scale (2 decimals), may be negative. */
  readonly difference: string;
}

/**
 * `GET /reports/cash-sessions` (PRD §31, [[REP-004]]): what the drawer actually
 * did — every session that CLOSED in the period, with its counted-versus-expected
 * difference.
 *
 * There is deliberately NO `currency`: a drawer amount is the tenant's own cash
 * and the Cash domain carries no currency column (`Cash.md`), so a currency code
 * here would be a number with an invented label in front of it.
 */
export interface CashSessionsResponse {
  readonly report: "cash-sessions";
  readonly period: ReportPeriodDto;
  /** `closedAt` ascending. An empty period is `[]`, never an error. */
  readonly rows: CashSessionRowDto[];
  /** The sum of the rows. `"0.00"` for every column when the period is empty. */
  readonly totals: CashSessionsTotalsDto;
}

/**
 * One `(type, direction)` group of the period's cash movements
 * (`GET /reports/cash-movements`, [[REP-004]]).
 *
 * The stored `amount` is ALWAYS POSITIVE — the kind owns the sign ([[DEC-030]]) —
 * so `signedAmount` is the only place the report resolves it, through the SAME
 * `cashMovementSign` map the close command uses.
 */
export interface CashMovementRowDto {
  /** The `CashMovementType` enum literal — `SALE`, `REFUND`, `INCOME`, … */
  readonly type: string;
  /** The `ADJUSTMENT`-only direction; `null` for every type-owned kind. */
  readonly direction: string | null;
  /** Movements of this `(type, direction)` in the period. */
  readonly movementCount: number;
  /**
   * Summed signed `Decimal(14, 2)` amount, exact fixed-scale (2 decimals).
   * NEGATIVE for a subtractive kind, and the sign is always rendered.
   */
  readonly signedAmount: string;
}

/**
 * `GET /reports/cash-movements` (PRD §31, [[REP-004]]): the movements recorded in
 * the period, rolled up by kind with the sign convention of [[DEC-030]] resolved.
 *
 * The period predicate is the MOVEMENT's own `createdAt`: `cash_movement` is
 * append-only with no `updated_at`, so its creation instant IS its business
 * instant. The session it belongs to is a different fact and never dates it.
 */
export interface CashMovementsResponse {
  readonly report: "cash-movements";
  readonly period: ReportPeriodDto;
  /**
   * The signed sum of every movement in the period, exact fixed-scale (2
   * decimals), negative when the subtractive kinds dominate.
   */
  readonly net: string;
  /**
   * `type` ascending, then `direction` ascending with `null` first — a total
   * order, never the insertion order of a map. An empty period is `[]`.
   */
  readonly rows: CashMovementRowDto[];
}

/**
 * One purchase RECEIVED in the period (`GET /reports/purchases`, [[REP-004]]).
 *
 * There is deliberately no money column: `PurchaseLine.unitCost` is optional and
 * informational ([[DEC-013]]), and the purchase aggregate owns no total and no
 * payment state (`Purchases.md`). A "purchase total" would be a number the
 * domain deliberately does not have, so the report reports lines and the ledger's
 * quantity scale instead.
 */
export interface PurchaseRowDto {
  /** The `purchase` id. */
  readonly purchaseId: string;
  /** The tenant's supplier id the receipt was booked against. */
  readonly supplierId: string;
  /** The supplier's name as the registry holds it today (INTERNAL). */
  readonly supplierName: string;
  /** ISO 8601 instant of the `DRAFT` → `RECEIVED` transition — the period predicate. */
  readonly receivedAt: string;
  /** How many lines the purchase was received with. */
  readonly lineCount: number;
  /** Summed `Decimal(10, 3)` quantity, exact fixed-scale (3 decimals), e.g. `"12.500"`. */
  readonly totalQuantity: string;
}

/**
 * `GET /reports/purchases` (PRD §31, [[REP-004]]): what the tenant actually
 * received. Only `RECEIVED` purchases appear — a `DRAFT` was never received and a
 * `CANCELLED` one was never stock — and only inside the period of their
 * `receivedAt`.
 */
export interface PurchasesResponse {
  readonly report: "purchases";
  readonly period: ReportPeriodDto;
  /** `receivedAt` ascending. An empty period is `[]`, never an error. */
  readonly rows: PurchaseRowDto[];
}

/**
 * One tracked item's stock row (`GET /reports/stock`, [[REP-005]]).
 *
 * TWO DIFFERENT FACTS LIVE IN THIS ROW, and conflating them is the mistake this
 * DTO exists to prevent:
 *
 * - `quantity` is the **CURRENT BALANCE**: a SNAPSHOT read from the
 *   `stock_balance` projection, which holds exactly one row per `(tenant, item)`
 *   and no history whatsoever. It is NOT the period's net, it is NOT bounded by
 *   the report's period, and no period can narrow it — the column has no date.
 * - `inbound`, `outbound` and `net` are the **PERIOD'S FLOW**: a signed sum over
 *   the immutable `stock_movement` ledger rows inside the resolved period.
 *
 * They answer different questions. A reader who takes `quantity` for the period's
 * `net` will conclude that an item stocked last year and sold last week moved
 * nothing last week, which is exactly what the label must prevent.
 *
 * `inbound`/`outbound`/`net` are `Decimal(10, 3)` fixed-scale strings. The ledger
 * stores `quantity` ALREADY SIGNED — positive is an input, negative an output,
 * and zero is rejected by the database — and no movement type owns that sign
 * (unlike cash, where the kind does: [[DEC-030]]). `outbound` is therefore
 * reported as a POSITIVE MAGNITUDE, so "40 out" is `"40.000"` and never
 * `"-40.000"` beside an `inbound` that also carries a sign.
 */
export interface StockReportRowDto {
  /** The item the balance and the flow belong to. */
  readonly catalogItemId: string;
  /** The item's name as the catalog holds it today (INTERNAL). */
  readonly name: string;
  /** `CatalogItem.kind` as a fact about the item — `PRODUCT`, `SERVICE`, `MEDICATION`, `SUPPLY`. */
  readonly kind: string;
  /**
   * CURRENT BALANCE, exact fixed-scale (3 decimals), e.g. `"12.500"`.
   *
   * A SNAPSHOT of `stock_balance.quantity` as of now — NOT the period's net and
   * NOT narrowed by the report's period. It is the same number whether the
   * caller asks for today or for last month.
   */
  readonly quantity: string;
  /** PERIOD FLOW IN, fixed-scale (3 decimals): the sum of the POSITIVE ledger quantities. */
  readonly inbound: string;
  /**
   * PERIOD FLOW OUT, fixed-scale (3 decimals), reported as a POSITIVE MAGNITUDE:
   * the absolute value of the sum of the NEGATIVE ledger quantities. `"0.000"`
   * when nothing left in the period.
   */
  readonly outbound: string;
  /**
   * PERIOD FLOW NET, fixed-scale (3 decimals) and SIGNED: the sum of every
   * ledger quantity in the period, so `inbound - outbound` exactly. NEGATIVE when
   * the period moved more out than in. It is NOT `quantity`.
   */
  readonly net: string;
}

/**
 * `GET /reports/stock` (PRD §31, [[REP-005]]): what is on hand per tracked item,
 * plus what moved in the period.
 *
 * One row per item that has a balance row AND tracks stock. An item with no
 * balance row has never moved, so there is no snapshot to report and it is
 * absent; an item with `tracksStock = false` appears in neither inventory report.
 *
 * There is deliberately NO `currency`: a quantity is not money, and no item
 * carries a cost ([[DEC-010]]) — valuation is out of scope for this Story.
 */
export interface StockReportResponse {
  readonly report: "stock";
  readonly period: ReportPeriodDto;
  /**
   * `name` ascending, then `catalogItemId` ascending. An empty period over an
   * empty inventory is `[]`, never an error.
   */
  readonly rows: StockReportRowDto[];
}

/**
 * One item at or below its own low-stock threshold (`GET /reports/low-stock`,
 * [[REP-005]]).
 *
 * `quantity` is the CURRENT BALANCE, exactly as in {@link StockReportRowDto}: a
 * snapshot of the projection, not a period figure. This report takes no period at
 * all, so nothing in it is bounded by one.
 */
export interface LowStockReportRowDto {
  /** The item this threshold belongs to. */
  readonly catalogItemId: string;
  /** The item's name as the catalog holds it today (INTERNAL). */
  readonly name: string;
  /** CURRENT BALANCE, exact fixed-scale (3 decimals). */
  readonly quantity: string;
  /** The item's own non-NULL threshold, exact fixed-scale (3 decimals). */
  readonly threshold: string;
  /**
   * `threshold - quantity`, exact fixed-scale (3 decimals). ALWAYS `>= 0` for a
   * returned row, because only rows whose quantity is at or below the threshold
   * are returned; `"0.000"` means the item is exactly at its threshold.
   */
  readonly shortfall: string;
}

/**
 * `GET /reports/low-stock` (PRD §31, [[REP-005]]): what is about to run out.
 *
 * It takes **no query parameters** — it is a current-state view, not a period
 * view — so a `?from=…` on this route is a refusal, not a silently ignored key.
 *
 * Only items with a NON-NULL `catalog_item.low_stock_threshold` can appear
 * ([[DEC-065]]): NULL means "not monitored", and inventing a default for it is
 * exactly what that decision refused. Every tenant therefore starts with an empty
 * report — a first-run state the UI must render honestly rather than as a
 * failure.
 */
export interface LowStockReportResponse {
  readonly report: "low-stock";
  /**
   * True when at least one tracked item the report read carries a non-NULL
   * threshold.
   *
   * This is what makes the two empty states distinguishable. `thresholdsConfigured:
   * false` with `rows: []` means "nobody has set a threshold yet"; `true` with
   * `rows: []` means "thresholds exist and every item is above its own". Both are
   * an empty array, and a caller must never have to guess which one it received.
   */
  readonly thresholdsConfigured: boolean;
  /** `shortfall` descending, then `name` ascending — most depleted first. */
  readonly rows: LowStockReportRowDto[];
}

/**
 * One calendar day of the consultation report, in the TENANT's day. `bucketDate`
 * is the local day an encounter's `closedAt` belongs to, computed by the SAME
 * helper that resolved the period boundaries, so a consultation closed at 23:30
 * local is counted on that day and not on the next UTC one.
 */
export interface ConsultationDayRowDto {
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly bucketDate: string;
  /**
   * Consultations closed on this local day: `status = CLOSED` rows with a NULL
   * `amendsEncounterId`. An amendment is never counted here — it corrects a
   * consultation, it does not add one.
   */
  readonly consultationCount: number;
}

/**
 * `GET /reports/consultations` (PRD §12, §31, [[REP-006]]): how many
 * consultations the practice closed, and how many corrections it recorded.
 *
 * Two figures, deliberately not one. An AMENDMENT is a NEW closed encounter that
 * points at the original through `amendsEncounterId`; the original is never
 * mutated (`Clinical.md`), so counting both as activity would inflate the
 * practice's own numbers. `consultationCount` therefore counts only the rows with
 * a NULL link, and `amendmentCount` reports the corrections separately.
 *
 * Data classification (PRD §41): aggregate COUNTS of the tenant's own clinical
 * activity, and nothing else. No patient identity, no patient id, no `bucketDate`
 * beyond a calendar day, and no clinical free text — the read behind this
 * response never loads `reasonForVisit`, `anamnesis`, `diagnosis`,
 * `treatmentPlan`, `clientSummary` or the RESTRICTED `internalNotes`, and
 * `Patient.name` (CONFIDENTIAL) is never touched at all.
 */
export interface ConsultationsResponse {
  readonly report: "consultations";
  readonly period: ReportPeriodDto;
  /**
   * Closed encounters with a NULL `amendsEncounterId` in the period — the sum of
   * the row counts, and the whole point of the report.
   */
  readonly consultationCount: number;
  /**
   * The period's AMENDMENTS, counted separately and never added to
   * `consultationCount`. They are deliberately ABSENT from `rows`: the bucket
   * series describes consultations, and a correction is not an additional one.
   */
  readonly amendmentCount: number;
  /**
   * Ascending by `bucketDate`; a day with no closed consultation is ABSENT rather
   * than a zero row. An empty period is `[]`, never an error.
   */
  readonly rows: ConsultationDayRowDto[];
}

/**
 * One calendar day of the new-patients report, in the TENANT's day. `bucketDate`
 * is the local day a patient's `createdAt` belongs to.
 */
export interface NewPatientDayRowDto {
  /** `YYYY-MM-DD` in the tenant zone. */
  readonly bucketDate: string;
  /** Patients registered on this local day, deactivated ones included. */
  readonly count: number;
}

/**
 * `GET /reports/new-patients` (PRD §12, §31, [[REP-006]]): how many patients the
 * practice gained in the period, bucketed by the tenant's local day.
 *
 * The instant is `Patient.createdAt` — registering a patient IS the event — and
 * deactivation is SOFT: a patient created in the period and deactivated since
 * still counts, because it was new then. The report therefore never filters on
 * `isActive`.
 *
 * Data classification (PRD §41): aggregate COUNTS only. `Patient.name` and
 * `Patient.birthDate` are CONFIDENTIAL and the read behind this response selects
 * neither — a headcount needs no name.
 */
export interface NewPatientsResponse {
  readonly report: "new-patients";
  readonly period: ReportPeriodDto;
  /** Every patient created in the period — the sum of the row counts. */
  readonly newPatientCount: number;
  /**
   * Ascending by `bucketDate`; a day with no registration is ABSENT rather than a
   * zero row. An empty period is `[]`, never an error.
   */
  readonly rows: NewPatientDayRowDto[];
}

/**
 * Where a due record sits relative to today in the tenant zone (`GET
 * /reports/vaccines-due`, `GET /reports/deworming-due`, [[REP-006]]).
 *
 * `overdue` is a local due date BEFORE today; `upcoming` is today or later — so
 * a record due TODAY is `upcoming`, never `overdue` ([[DEC-065]], and
 * [[DEC-063]] for the tenant date it is compared against). The split is decided
 * on CALENDAR DATES in `TENANT_TIME_ZONE`, never on instants: a due date at
 * 23:00 local is due that day even though its UTC day is already the next one.
 */
export type ReportDueStatus = "overdue" | "upcoming";

/**
 * One vaccination due or overdue (`GET /reports/vaccines-due`, [[REP-006]]).
 *
 * Data classification (PRD §41): `patientName` is **CONFIDENTIAL** and is
 * carried HERE on purpose — a due-vaccination list whose rows do not say which
 * animal is due is a list nobody can act on, and this report exists to be acted
 * on by staff. It is the ONLY confidential value in the response: the row
 * carries dates, a patient identity and the vaccine's name and **no clinical
 * content whatsoever** — no `internalNotes` (RESTRICTED), no diagnosis, no
 * anamnesis and no reason for visit. The portal never receives this payload;
 * patient identity on the holder-facing surface is `PortalReadService`'s
 * business, not a report's.
 */
export interface VaccineDueRowDto {
  /** The patient the vaccination belongs to (tenant-scoped). */
  readonly patientId: string;
  /**
   * The patient's name as `Patient` holds it today — CONFIDENTIAL, and carried
   * because staff must act on the row. Never a birth date, a species or a
   * guardian.
   */
  readonly patientName: string;
  /** The `clinical_vaccination.vaccine` value as the record stores it. */
  readonly vaccine: string;
  /** ISO 8601 instant the vaccine was administered (context, not the predicate). */
  readonly administeredAt: string;
  /**
   * ISO 8601 instant of the staff-entered `next_due_at` ([[DEC-065]]) — the
   * report's whole predicate. Never a projected booster date: no protocol is
   * derived, the veterinarian entered this date or the row is absent.
   */
  readonly nextDueAt: string;
  /** `overdue` when the LOCAL due date is before today, `upcoming` when it is today or later. */
  readonly status: ReportDueStatus;
}

/**
 * `GET /reports/vaccines-due` (PRD §12, §31, [[REP-006]], [[DEC-065]]): what is
 * due, split into overdue and upcoming.
 *
 * It takes **no period**: a period answers "what happened", and a due date is a
 * future-or-past fact about a record, so a window would be a filter the report
 * cannot honour. It takes a bounded forward HORIZON instead, and there is
 * deliberately no lower bound — an overdue vaccination is overdue however old.
 *
 * `asOfDate`, `timeZone` and `horizonDays` are echoed so a caller can PROVE
 * which day the split was made against and, when it omitted `horizonDays`, which
 * default it got.
 *
 * There is no `currency` anywhere: these are dates, names and counts.
 */
export interface VaccinesDueResponse {
  readonly report: "vaccines-due";
  /** `YYYY-MM-DD` in the tenant zone — today, the overdue/upcoming pivot. */
  readonly asOfDate: string;
  /** The zone the pivot and `horizonEndInstant` were resolved in. Never a request parameter. */
  readonly timeZone: string;
  /** The horizon actually applied, defaulted to 30 and bounded to `1..365`. */
  readonly horizonDays: number;
  /** Rows whose LOCAL due date is before `asOfDate`. */
  readonly overdueCount: number;
  /** Rows whose LOCAL due date is `asOfDate` or later, inside the horizon. */
  readonly upcomingCount: number;
  /**
   * `nextDueAt` ascending, then `id` ascending — so the longest-overdue record is
   * first and the soonest upcoming ones follow, which is the order a practice
   * works through. `overdueCount + upcomingCount` is exactly `rows.length`.
   */
  readonly rows: VaccineDueRowDto[];
}

/**
 * One deworming treatment due or overdue (`GET /reports/deworming-due`,
 * [[REP-006]]). The same row as {@link VaccineDueRowDto} over
 * `clinical_deworming`, whose free-text field is `product` instead of `vaccine`.
 *
 * Data classification (PRD §41) is identical: `patientName` is CONFIDENTIAL and
 * carried because staff must act on it, and the row carries no clinical content
 * at all.
 */
export interface DewormingDueRowDto {
  /** The patient the treatment belongs to (tenant-scoped). */
  readonly patientId: string;
  /** The patient's name as `Patient` holds it today — CONFIDENTIAL. */
  readonly patientName: string;
  /** The `clinical_deworming.product` value as the record stores it. */
  readonly product: string;
  /** ISO 8601 instant the treatment was administered (context, not the predicate). */
  readonly administeredAt: string;
  /** ISO 8601 instant of the staff-entered `next_due_at` ([[DEC-065]]) — the predicate. */
  readonly nextDueAt: string;
  /** `overdue` when the LOCAL due date is before today, `upcoming` when it is today or later. */
  readonly status: ReportDueStatus;
}

/**
 * `GET /reports/deworming-due` (PRD §12, §31, [[REP-006]], [[DEC-065]]): the
 * same question as {@link VaccinesDueResponse} over `clinical_deworming`.
 *
 * The same rules apply exactly — no period, a bounded forward horizon, no lower
 * bound, calendar-date comparison in the tenant zone, due today is upcoming — and
 * they are stated once, in the vaccine DTO, rather than paraphrased here where
 * they could drift.
 */
export interface DewormingDueResponse {
  readonly report: "deworming-due";
  /** `YYYY-MM-DD` in the tenant zone — today, the overdue/upcoming pivot. */
  readonly asOfDate: string;
  /** The zone the pivot and `horizonEndInstant` were resolved in. Never a request parameter. */
  readonly timeZone: string;
  /** The horizon actually applied, defaulted to 30 and bounded to `1..365`. */
  readonly horizonDays: number;
  /** Rows whose LOCAL due date is before `asOfDate`. */
  readonly overdueCount: number;
  /** Rows whose LOCAL due date is `asOfDate` or later, inside the horizon. */
  readonly upcomingCount: number;
  /** `nextDueAt` ascending, then `id` ascending. `overdueCount + upcomingCount` is `rows.length`. */
  readonly rows: DewormingDueRowDto[];
}

/**
 * The query contract of every PERIOD-shaped report route
 * (`GET /reports/sales-by-period`, `GET /reports/payment-methods`,
 * `GET /reports/sales-by-product-service`, `GET /reports/cash-sessions`,
 * `GET /reports/cash-movements`, `GET /reports/purchases`,
 * `GET /reports/stock`, `GET /reports/consultations`,
 * `GET /reports/new-patients`).
 *
 * It is deliberately NOT the contract of `GET /reports/low-stock`: a current-state
 * view has no period, and {@link reportNoQuerySchema} is its own.
 *
 * `.strict()` so an unknown key is REFUSED rather than silently ignored: a
 * typo'd `from_` would otherwise widen the report to a different question while
 * looking like the one that was asked.
 *
 * The three keys are only SHAPE-validated here (strings, no unknown keys) — the
 * period rule, with its one stable message per condition, lives in
 * `report.period.ts` and owns every semantic rejection ([[DEC-063]]). Duplicating
 * the preset list here would be a second, drift-prone opinion about the same
 * contract.
 */
export const reportPeriodQuerySchema = z
  .object({
    preset: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();

export type ReportPeriodQuery = z.infer<typeof reportPeriodQuerySchema>;

/** Stable message behind every rejection of the query SHAPE (unknown key, wrong type). */
export const REPORT_PERIOD_QUERY_INVALID_MESSAGE = "Invalid report period query.";

/**
 * The query contract of the CURRENT-STATE reports — `GET /reports/low-stock`.
 *
 * It accepts NO keys at all: the report is a snapshot of the projection, so a
 * period would be a parameter the report cannot honour. `.strict()` on an empty
 * object is what turns "`?from=2026-01-01`" into an explicit refusal instead of a
 * silently ignored key that leaves the caller believing a period was applied.
 */
export const reportNoQuerySchema = z.object({}).strict();

/** Stable message behind every rejection of a query sent to a no-query report route. */
export const REPORT_QUERY_NOT_ALLOWED_MESSAGE = "This report takes no query parameters.";

/**
 * The query contract of the two DUE reports
 * (`GET /reports/vaccines-due`, `GET /reports/deworming-due`, [[REP-006]]).
 *
 * **This is NOT {@link reportPeriodQuerySchema}.** A due report answers "what is
 * due", not "what happened in a window", so it accepts no period at all and
 * `.strict()` is what turns `?from=2026-06-01` into an explicit refusal instead
 * of a key that is silently ignored while the caller believes a range was
 * applied.
 *
 * `horizonDays` is only SHAPE-validated here (a string, no unknown keys). The
 * default of 30, the integer requirement and the `1..365` bound — with one
 * stable message per condition — live in `report.horizon.ts`, exactly as every
 * period rejection lives in `report.period.ts` ([[DEC-063]]). Declaring
 * `z.coerce.number()` here would move those refusals into a parser's
 * paraphrase.
 */
export const reportDueQuerySchema = z
  .object({
    horizonDays: z.string().optional(),
  })
  .strict();

export type ReportDueQuery = z.infer<typeof reportDueQuerySchema>;

/** Stable message behind every rejection of the due-report query SHAPE (unknown key, wrong type). */
export const REPORT_DUE_QUERY_INVALID_MESSAGE = "Invalid report due query.";
