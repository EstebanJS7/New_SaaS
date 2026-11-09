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
    title: "Negocio",
    description: "Ventas, caja, compras e inventario: la gestión que comparte todo el negocio.",
  },
  {
    id: "veterinary",
    title: "Clínica veterinaria",
    description: "La actividad clínica y los pacientes a los que corresponde.",
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
    title: "Ventas por período",
    description:
      "Ventas completadas por día: cantidad, neto, impuesto y bruto, con los totales del período.",
    group: "core",
  },
  "payment-methods": {
    title: "Medios de pago",
    description:
      "Cómo ingresó el dinero del período, por medio de pago, con su proporción del bruto.",
    group: "core",
  },
  "sales-by-product-service": {
    title: "Ventas por producto y servicio",
    description:
      "Qué ítems del catálogo generaron el dinero, con cantidad, neto, impuesto y bruto.",
    group: "core",
  },
  "cash-sessions": {
    title: "Sesiones de caja",
    description:
      "Cada caja que se cerró en el período: monto inicial, esperado, contado y diferencia.",
    group: "core",
  },
  "cash-movements": {
    title: "Movimientos de caja",
    description: "Los movimientos de caja del período, agrupados por tipo y con el signo resuelto.",
    group: "core",
  },
  purchases: {
    title: "Compras",
    description: "Las compras recibidas en el período, con su proveedor y sus cantidades.",
    group: "core",
  },
  stock: {
    title: "Stock",
    description:
      "El saldo actual de cada ítem controlado junto a lo que entró y salió en el período.",
    group: "core",
  },
  "low-stock": {
    title: "Stock bajo",
    description: "Ítems en su umbral de stock bajo o por debajo, primero los más agotados.",
    group: "core",
  },
  consultations: {
    title: "Consultas",
    description: "Consultas cerradas por día, con las enmiendas contadas aparte.",
    group: "veterinary",
  },
  "new-patients": {
    title: "Pacientes nuevos",
    description: "Pacientes registrados por día en el período, incluidos los desactivados.",
    group: "veterinary",
  },
  "vaccines-due": {
    title: "Vacunas por vencer",
    description:
      "Vacunaciones vencidas o que vencen dentro del horizonte, primero las más atrasadas.",
    group: "veterinary",
  },
  "deworming-due": {
    title: "Desparasitaciones por vencer",
    description:
      "Desparasitaciones vencidas o que vencen dentro del horizonte, primero las más atrasadas.",
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
