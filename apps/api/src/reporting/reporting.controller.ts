import { Controller, Get, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import { ReportingService } from "./reporting.service.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  reportPeriodQuerySchema,
  type PaymentMethodsResponse,
  type ReportPeriodQuery,
  type SalesByPeriodResponse,
  type SalesByProductServiceResponse,
} from "./reporting.dto.js";

/**
 * The staff reporting surface (EPIC-18 REP-002, REP-003).
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
