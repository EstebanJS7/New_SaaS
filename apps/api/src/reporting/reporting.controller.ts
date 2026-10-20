import { Controller, Get, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import { ReportingService } from "./reporting.service.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  reportPeriodQuerySchema,
  type CashMovementsResponse,
  type CashSessionsResponse,
  type PaymentMethodsResponse,
  type PurchasesResponse,
  type ReportPeriodQuery,
  type SalesByPeriodResponse,
  type SalesByProductServiceResponse,
} from "./reporting.dto.js";

/**
 * The staff reporting surface (EPIC-18 REP-002, REP-003, REP-004).
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
}
