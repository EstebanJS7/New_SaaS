import {
  REPORT_CODES,
  reportQueryShapeOf,
  type ReportCode,
  type ReportQueryShape,
} from "@/app/api/reports/report-codes";

/**
 * The twelve reports the epic ships, as the workspace lists them ([[REP-008]]).
 *
 * The CODES and their query shapes come from `@/app/api/reports/report-codes`,
 * which is also what the BFF proxy allowlist reads: the report the index links to
 * and the report the proxy refuses or forwards cannot drift apart, because there
 * is one list.
 *
 * What lives HERE and not there is presentation: the title a row shows, the one
 * sentence describing it, and the group it belongs to. The grouping is the
 * product's own vocabulary (PRD §9): a **Core** report aggregates a business
 * domain (sales, cash, purchases, inventory) and a **Veterinary** report is
 * clinical — the same boundary the code enforces, where Core domains know nothing
 * about a pet.
 */

export type ReportGroupId = "core" | "veterinary";

export interface ReportGroup {
  readonly id: ReportGroupId;
  readonly title: string;
  readonly description: string;
}

export interface ReportDefinition {
  readonly code: ReportCode;
  readonly title: string;
  readonly description: string;
  readonly group: ReportGroupId;
  readonly queryShape: ReportQueryShape;
}

export const REPORT_GROUPS: readonly ReportGroup[] = [
  {
    id: "core",
    title: "Core",
    description: "Sales, cash, purchases and inventory — the business every vertical shares.",
  },
  {
    id: "veterinary",
    title: "Veterinary",
    description: "Clinical activity and the patients it belongs to.",
  },
];

/**
 * The title and description per code.
 *
 * Typed as a `Record<ReportCode, …>`, so a report added to the code list is a
 * COMPILE error until it is named and described here, and a report removed from
 * it cannot leave a stray entry behind.
 */
const REPORT_TEXT: Readonly<Record<ReportCode, Omit<ReportDefinition, "code" | "queryShape">>> = {
  "sales-by-period": {
    title: "Sales by period",
    description: "Completed sales per day: count, net, tax and gross, with the period totals.",
    group: "core",
  },
  "payment-methods": {
    title: "Payment methods",
    description: "How the period's money arrived, per tender, with its share of the gross.",
    group: "core",
  },
  "sales-by-product-service": {
    title: "Sales by product and service",
    description: "Which catalog items earned the money, with quantity, net, tax and gross.",
    group: "core",
  },
  "cash-sessions": {
    title: "Cash sessions",
    description:
      "Every drawer that closed in the period: opening, expected, counted and difference.",
    group: "core",
  },
  "cash-movements": {
    title: "Cash movements",
    description: "The period's cash ledger, rolled up by kind with the sign convention resolved.",
    group: "core",
  },
  purchases: {
    title: "Purchases",
    description: "The purchases received in the period, with their supplier and quantities.",
    group: "core",
  },
  stock: {
    title: "Stock",
    description: "Each tracked item's current balance beside what moved in and out in the period.",
    group: "core",
  },
  "low-stock": {
    title: "Low stock",
    description: "Items at or below their own low-stock threshold, most depleted first.",
    group: "core",
  },
  consultations: {
    title: "Consultations",
    description: "Consultations closed per day, with amendments counted separately.",
    group: "veterinary",
  },
  "new-patients": {
    title: "New patients",
    description: "Patients registered per day in the period, deactivated ones included.",
    group: "veterinary",
  },
  "vaccines-due": {
    title: "Vaccines due",
    description: "Vaccinations overdue or due inside the horizon, longest overdue first.",
    group: "veterinary",
  },
  "deworming-due": {
    title: "Deworming due",
    description: "Deworming treatments overdue or due inside the horizon, longest overdue first.",
    group: "veterinary",
  },
};

/** Every report, in catalogue order: the code list is the order the index renders. */
export const REPORT_CATALOG: readonly ReportDefinition[] = REPORT_CODES.map((code) => ({
  code,
  queryShape: reportQueryShapeOf(code),
  ...REPORT_TEXT[code],
}));

/** One report's definition, by code. Total over {@link REPORT_CODES}. */
export function reportDefinition(code: ReportCode): ReportDefinition {
  const found = REPORT_CATALOG.find((entry) => entry.code === code);
  if (found === undefined) {
    // Unreachable: `REPORT_CATALOG` is built from the code list itself.
    throw new Error(`No report definition for ${code}.`);
  }
  return found;
}

/** The reports of one group, in catalogue order. */
export function reportsInGroup(group: ReportGroupId): readonly ReportDefinition[] {
  return REPORT_CATALOG.filter((entry) => entry.group === group);
}
