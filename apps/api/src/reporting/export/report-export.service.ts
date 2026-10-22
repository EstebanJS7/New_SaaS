import { Injectable, Optional } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import { REPORTING_PERMISSIONS } from "../reporting.permissions.js";
import { ReportingService } from "../reporting.service.js";
import { reportExportDefinitionFor } from "./report-export.definitions.js";

/**
 * The reporting EXPORT boundary (EPIC-18 REP-007, [[DEC-066]], [[DEC-062]]).
 *
 * ## Its own permission, and it is not `reports.read`
 *
 * Reading an aggregate on the caller's own screen and taking a file out of the
 * system are different decisions ([[DEC-062]]): a file survives the session that
 * produced it and is trivially forwarded, so a role may reasonably be allowed the
 * first and not the second. The route declares `reports.export` and this class
 * RE-ASSERTS it before any definition is resolved or any query runs — a caller
 * holding `reports.read` alone is refused here even if a future edit lost the
 * decorator.
 *
 * ## Bounded, synchronously ([[DEC-066]])
 *
 * There is no queue, no artefact and no storage: the export is the report with a
 * different media type. What makes that safe is the hard row cap below — applied
 * to the number of DATA rows, refused as its own stable `VALIDATION_FAILED`, and
 * enforced BEFORE a single byte is serialized, so there is no such thing as a
 * partial file.
 *
 * The report's OWN cap still applies and is untouched: it fires inside the
 * report's service method, i.e. before this one gets a row count. Whichever
 * bound the data reaches first refuses, each with its own stable message, and
 * neither is derived from the other.
 *
 * ## Data classification and logging
 *
 * The rendered file is INTERNAL tenant data; the two due reports additionally
 * carry CONFIDENTIAL patient names, under the same grant that guards reading
 * them. **No row content is logged and this class logs nothing at all** — reads
 * are not audited in this system, and a logged CSV line would be the one place a
 * patient name left the tenant's request.
 */

/**
 * The maximum number of DATA rows one export may contain ([[DEC-066]]).
 *
 * A module constant, never a request parameter: a caller that could raise its own
 * bound could turn a read-only report into an availability incident, which is the
 * shape [[DEC-066]] rejected outright.
 *
 * 10 000 rows is a few hundred kilobytes of text — a size the API can hold in
 * memory and hand through the BFF without streaming, backpressure or object
 * storage ([[TD-051]] is the deferred asynchronous path for a tenant that
 * outgrows it). It is deliberately BELOW the largest per-read report caps
 * (20 000 sales / movements / encounters): the cap that bounds the export is the
 * one that bounds what crosses the tenant boundary, and a report whose rows are
 * buckets (at most one per local day) or groups (at most one per
 * `(type, direction)`) can never approach it. The one report whose row count is
 * NOT bounded by a read cap is `sales-by-product-service` — one row per distinct
 * catalog item sold — so that is the path where this bound can genuinely fire.
 */
export const REPORT_EXPORT_ROW_LIMIT = 10_000;

/** Stable message for an export over {@link REPORT_EXPORT_ROW_LIMIT}. */
export const REPORT_EXPORT_ROW_LIMIT_EXCEEDED_MESSAGE = `The report contains more than ${REPORT_EXPORT_ROW_LIMIT} rows to export. Narrow the period or horizon and try again.`;

/**
 * Stable message behind every export `403`.
 *
 * Its OWN message, distinct from the report read's: the two refusals are
 * different grants, and a caller told "the required report permission is
 * missing" after exporting successfully yesterday would have no way to learn
 * that the missing grant is the narrower one.
 */
export const REPORT_EXPORT_FORBIDDEN_MESSAGE = "The required report export permission is missing.";

/** What the route writes: the filename for `Content-Disposition` and the body. */
export interface ExportedReport {
  /** ASCII only, no spaces, no caller input. Includes the `.csv` suffix. */
  readonly filename: string;
  /** The complete UTF-8 CSV document: header row, then one line per data row. */
  readonly csv: string;
}

@Injectable()
export class ReportExportService {
  constructor(
    private readonly reports: ReportingService,
    private readonly permissionResolver: PermissionResolver,
    // The same injectable clock `ReportingService` takes: the ONE report without
    // dates of its own (`low-stock`) is named after the tenant's as-of date, and
    // a suite that cannot pin the instant could only assert a date-shaped string.
    @Optional() private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Renders one report as a CSV document, or refuses.
   *
   * The order is deliberate and is the whole security model of this surface:
   *
   * 1. **permission** — before anything else, so a denial reaches no definition
   *    and no data;
   * 2. **the code** — a closed allowlist, so an unknown report is a `404` and
   *    never a silent fallback;
   * 3. **the query** — parsed by the entry that owns the contract, with the
   *    shipped schema and the shipped message;
   * 4. **the report itself** — ONE call to the report's service method, which is
   *    where the period/horizon is resolved and where the report's own cap
   *    applies;
   * 5. **the cap** — refused before the renderer runs, so no partial body can
   *    exist even transiently.
   */
  async exportReport(reportCode: string, query: unknown): Promise<ExportedReport> {
    await this.requireExportPermission();

    const definition = reportExportDefinitionFor(reportCode);
    const loaded = await definition.load({ reports: this.reports, query, now: this.now() });

    if (loaded.rowCount > REPORT_EXPORT_ROW_LIMIT) {
      throw new DomainError("VALIDATION_FAILED", REPORT_EXPORT_ROW_LIMIT_EXCEEDED_MESSAGE);
    }

    return { filename: loaded.filename, csv: loaded.toCsv() };
  }

  /** Defense in depth behind `@RequirePermissions`: a denial reaches no query. */
  private async requireExportPermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(REPORTING_PERMISSIONS.export)) {
      throw new DomainError("FORBIDDEN", REPORT_EXPORT_FORBIDDEN_MESSAGE);
    }
  }
}
