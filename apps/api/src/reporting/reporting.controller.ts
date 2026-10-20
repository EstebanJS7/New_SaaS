import { Controller, Get, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";
import { ReportingService } from "./reporting.service.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  reportPeriodQuerySchema,
  type SalesByPeriodResponse,
} from "./reporting.dto.js";

/**
 * The staff reporting surface (EPIC-18 REP-002).
 *
 * **Read-only, one route.** Reports aggregate; they never write, so there is no
 * command route, no `PATCH` and no `DELETE` on this surface at all.
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
    const parsed = reportPeriodQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", REPORT_PERIOD_QUERY_INVALID_MESSAGE);
    }
    return this.reporting.salesByPeriod(parsed.data);
  }
}
