import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { RequirePermissions } from "../../rbac/require-permissions.decorator.js";
import { REPORTING_PERMISSIONS } from "../reporting.permissions.js";
import { ReportExportService, type ExportedReport } from "./report-export.service.js";

/**
 * The CSV export surface (EPIC-18 REP-007, [[DEC-066]]).
 *
 * **ONE route for the twelve shipped reports**, parameterised by a CLOSED report
 * code. Twelve near-identical handlers would be twelve places for one of them to
 * accept a query shape its report does not have, and twelve chances to forget the
 * permission pin; the code allowlist and the per-code query contract live in one
 * table (`report-export.definitions.ts`) instead.
 *
 * ```
 * GET /reports/:reportCode/export
 *   200 text/csv; charset=utf-8
 *       Content-Disposition: attachment; filename="<code>-<from>-<to>.csv"
 *   400 VALIDATION_FAILED   malformed period / horizon, a disallowed query key,
 *                           or a row count over the export cap
 *   403 FORBIDDEN           missing `reports.export` (or missing authentication)
 *   404 NOT_FOUND           a reportCode outside the allowlist
 * ```
 *
 * **The permission is `reports.export`, never `reports.read`** ([[DEC-062]]): a
 * role may legitimately hold the render grant and not the exfiltration one, so
 * the two are asserted separately by the suite on both sides.
 *
 * The response is NOT JSON — the ONE route in this module that is not — so the
 * two headers are set explicitly on the Fastify reply and the body is returned as
 * a string through `@Res({ passthrough: true })`, the `BrandingAssetController`
 * precedent for a non-JSON response.
 *
 * Data classification (PRD §41): INTERNAL tenant data, with CONFIDENTIAL patient
 * names in the two due reports — see `report-export.definitions.ts` for the full
 * position. No clinical free text is exported, and no row content is ever logged.
 */
@Controller("reports")
export class ReportExportController {
  constructor(private readonly exports: ReportExportService) {}

  /**
   * Renders one report as a downloadable CSV file.
   *
   * The query is forwarded to the definition UNPARSED (`unknown`) and each entry
   * parses it with the schema its report actually has, exactly as
   * `ReportingController` does per route. So `?from=` on `low-stock` and
   * `?horizonDays=` on `sales-by-period` are refusals here for the same reason
   * they are refusals there, and the export can never answer a different range
   * than the report it renders.
   */
  @Get(":reportCode/export")
  @RequirePermissions(REPORTING_PERMISSIONS.export)
  async exportReport(
    @Param("reportCode") reportCode: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<string> {
    const exported: ExportedReport = await this.exports.exportReport(reportCode, query);
    // Set only after the export succeeded: a refusal must reach the client as the
    // JSON error envelope, not as an attachment with no body.
    reply.header("Content-Type", REPORT_EXPORT_CONTENT_TYPE);
    reply.header("Content-Disposition", contentDispositionFor(exported.filename));
    return exported.csv;
  }
}

/**
 * The media type every export answers with.
 *
 * `charset=utf-8` is stated rather than implied: the documents carry a tenant's
 * own catalog, supplier and patient names, which are not ASCII in any real
 * deployment, and a consumer that guessed latin-1 would mangle them.
 */
export const REPORT_EXPORT_CONTENT_TYPE = "text/csv; charset=utf-8";

/**
 * `Content-Disposition` for a filename the export produced.
 *
 * The filename needs no escaping: it is built from the closed code allowlist and
 * `YYYY-MM-DD` calendar dates, so it is ASCII with no quotes, no spaces and no
 * control characters — there is deliberately no user input in it to sanitize.
 */
export function contentDispositionFor(filename: string): string {
  return `attachment; filename="${filename}"`;
}
