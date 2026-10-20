import { Controller, Get, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import { ReportingService } from "./reporting.service.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  REPORT_QUERY_NOT_ALLOWED_MESSAGE,
  reportNoQuerySchema,
  reportPeriodQuerySchema,
  type CashMovementsResponse,
  type CashSessionsResponse,
  type ConsultationsResponse,
  type LowStockReportResponse,
  type NewPatientsResponse,
  type PaymentMethodsResponse,
  type PurchasesResponse,
  type ReportPeriodQuery,
  type SalesByPeriodResponse,
  type SalesByProductServiceResponse,
  type StockReportResponse,
} from "./reporting.dto.js";

/**
 * The staff reporting surface (EPIC-18 REP-002, REP-003, REP-004, REP-005,
 * REP-006).
 *
 * **Read-only.** Reports aggregate; they never write, so there is no command
 * route, no `PATCH` and no `DELETE` on this surface at all.
 *
 * Tenant identity is never an input — it comes from the request context inside
 * the repository — so there is no cross-tenant-addressable resource, no path
 * parameter and no body. The only input is the period, and it is deliberately
 * narrow: a closed query schema (an unknown key is refused, not ignored) whose
 * semantic rejections all live in the period rule, so every malformed period
 * produces ONE stable message per condition rather than a parser's paraphrase.
 * The ONE current-state route (`low-stock`) accepts no query at all and refuses
 * every key for the same reason.
 *
 * There is NO feature-code gate ([[DEC-062]]): `reports.read` is the whole
 * server-side guard, re-asserted in the service as defense in depth.
 */
@Controller("reports")
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  /**
   * Sales by period (PRD §31).
   *
   * `?period=<preset>|from=YYYY-MM-DD&to=YYYY-MM-DD` — never instants, so a
   * caller cannot bypass the span bound by choosing its own boundaries
   * ([[DEC-063]]).
   */
  @Get("sales-by-period")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async salesByPeriod(@Query() query: unknown): Promise<SalesByPeriodResponse> {
    return this.reporting.salesByPeriod(this.parsePeriod(query));
  }

  /**
   * Payment methods (PRD §31, [[REP-003]]): how the money arrived, per tender.
   * Same period contract as every report on this surface.
   */
  @Get("payment-methods")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async paymentMethods(@Query() query: unknown): Promise<PaymentMethodsResponse> {
    return this.reporting.paymentMethods(this.parsePeriod(query));
  }

  /**
   * Sales by product/service (PRD §31, [[REP-003]]): quantity, net, tax and gross
   * per catalog item, plus the per-`kind` roll-up. Same period contract.
   */
  @Get("sales-by-product-service")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async salesByProductService(@Query() query: unknown): Promise<SalesByProductServiceResponse> {
    return this.reporting.salesByProductService(this.parsePeriod(query));
  }

  /**
   * Cash sessions (PRD §31, [[REP-004]]): the sessions that CLOSED in the period,
   * with their opening, expected, counted and difference amounts. Same period
   * contract as every report on this surface.
   */
  @Get("cash-sessions")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async cashSessions(@Query() query: unknown): Promise<CashSessionsResponse> {
    return this.reporting.cashSessions(this.parsePeriod(query));
  }

  /**
   * Cash movements (PRD §31, [[REP-004]]): the period's movements rolled up by
   * `(type, direction)` with the [[DEC-030]] sign resolved, plus the net. Same
   * period contract.
   */
  @Get("cash-movements")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async cashMovements(@Query() query: unknown): Promise<CashMovementsResponse> {
    return this.reporting.cashMovements(this.parsePeriod(query));
  }

  /**
   * Purchases (PRD §31, [[REP-004]]): the purchases RECEIVED in the period, with
   * their line count, total quantity and supplier — and deliberately no money
   * total, because the purchase aggregate owns none. Same period contract.
   */
  @Get("purchases")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async purchases(@Query() query: unknown): Promise<PurchasesResponse> {
    return this.reporting.purchases(this.parsePeriod(query));
  }

  /**
   * Stock (PRD §31, [[REP-005]]): the CURRENT balance per tracked item from the
   * projection, plus the PERIOD's movement flow from the ledger. Two different
   * facts with two different shapes — `quantity` is a snapshot, `inbound` /
   * `outbound` / `net` are the period. Same period contract as every report here.
   */
  @Get("stock")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async stock(@Query() query: unknown): Promise<StockReportResponse> {
    return this.reporting.stock(this.parsePeriod(query));
  }

  /**
   * Low stock (PRD §31, [[REP-005]]): the items at or below their own threshold.
   *
   * This route takes **no query parameters at all** — it is a current-state view,
   * so a period cannot narrow it and `?from=…` here is a refusal rather than a
   * key that silently does nothing.
   */
  @Get("low-stock")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async lowStock(@Query() query: unknown): Promise<LowStockReportResponse> {
    this.assertNoQuery(query);
    return this.reporting.lowStock();
  }

  /**
   * Consultations (PRD §12, §31, [[REP-006]]): the encounters CLOSED in the
   * period, with amendments counted separately because a correction is not an
   * additional consultation. Same period contract as every report here.
   */
  @Get("consultations")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async consultations(@Query() query: unknown): Promise<ConsultationsResponse> {
    return this.reporting.consultations(this.parsePeriod(query));
  }

  /**
   * New patients (PRD §12, §31, [[REP-006]]): the patients REGISTERED in the
   * period, deactivated ones included, bucketed by the tenant's local day. Same
   * period contract.
   */
  @Get("new-patients")
  @RequirePermissions(REPORTING_PERMISSIONS.read)
  async newPatients(@Query() query: unknown): Promise<NewPatientsResponse> {
    return this.reporting.newPatients(this.parsePeriod(query));
  }

  /**
   * The ONE period parser every report route uses: shape first, semantics in the
   * period rule. Factored so a new report cannot grow a second, drifting parser.
   */
  private parsePeriod(query: unknown): ReportPeriodQuery {
    const parsed = reportPeriodQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_QUERY_INVALID_MESSAGE);
    }
    return parsed.data;
  }

  /**
   * The refusal a CURRENT-STATE report applies to its query: it accepts no keys,
   * so every key — a known-looking `from`, a typo, a tenant id — is refused with
   * the same stable message. Silently ignoring one would let a caller believe a
   * period had been applied to a report that has no period.
   */
  private assertNoQuery(query: unknown): void {
    const parsed = reportNoQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", REPORT_QUERY_NOT_ALLOWED_MESSAGE);
    }
  }
}
