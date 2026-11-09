/**
 * The SIFEN catalogue labels the fiscal settings screen shows (Manual Técnico,
 * the same descriptions `@newsaas/fiscal`'s `dte.catalogues.ts` carries). Kept
 * here because the web app does not depend on the fiscal package.
 */

export interface CodeLabel {
  readonly code: number;
  readonly label: string;
}

export const DOCUMENT_TYPE_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "Factura electrónica" },
  { code: 4, label: "Autofactura electrónica" },
  { code: 5, label: "Nota de crédito electrónica" },
  { code: 6, label: "Nota de débito electrónica" },
  { code: 7, label: "Nota de remisión electrónica" },
  { code: 9, label: "Boleta de venta electrónica" },
  { code: 10, label: "Boleta resimple electrónica" },
];

export const TAXPAYER_TYPE_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "Persona física" },
  { code: 2, label: "Persona jurídica" },
];

export const TAX_TYPE_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "IVA" },
  { code: 2, label: "ISC" },
  { code: 3, label: "Renta" },
  { code: 4, label: "Ninguno" },
  { code: 5, label: "IVA - Renta" },
];

export const EMISSION_TYPE_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "Normal" },
  { code: 2, label: "Contingencia" },
];

export const TRANSACTION_TYPE_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "Venta de mercadería" },
  { code: 2, label: "Prestación de servicios" },
  { code: 3, label: "Mixto (Venta de mercadería y servicios)" },
  { code: 4, label: "Venta de activo fijo" },
  { code: 5, label: "Venta de divisas" },
  { code: 6, label: "Compra de divisas" },
  { code: 7, label: "Promoción o entrega de muestras" },
  { code: 8, label: "Donación" },
  { code: 9, label: "Anticipo" },
  { code: 10, label: "Compra de productos" },
  { code: 11, label: "Compra de servicios" },
  { code: 12, label: "Venta de crédito fiscal" },
  { code: 13, label: "Muestras médicas (Art. 3 RG 24/2014)" },
];

export const RESPONSIBLE_ISSUER_TYPE_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "Cédula paraguaya" },
  { code: 2, label: "Pasaporte" },
  { code: 3, label: "Cédula extranjera" },
  { code: 4, label: "Carnet de residencia" },
  { code: 9, label: "Otro" },
];

export const DEPARTMENT_OPTIONS: readonly CodeLabel[] = [
  { code: 1, label: "Capital" },
  { code: 2, label: "Concepción" },
  { code: 3, label: "San Pedro" },
  { code: 4, label: "Cordillera" },
  { code: 5, label: "Guairá" },
  { code: 6, label: "Caaguazú" },
  { code: 7, label: "Caazapá" },
  { code: 8, label: "Itapúa" },
  { code: 9, label: "Misiones" },
  { code: 10, label: "Paraguarí" },
  { code: 11, label: "Alto Paraná" },
  { code: 12, label: "Central" },
  { code: 13, label: "Ñeembucú" },
  { code: 14, label: "Amambay" },
  { code: 15, label: "Presidente Hayes" },
  { code: 16, label: "Boquerón" },
  { code: 17, label: "Alto Paraguay" },
  { code: 18, label: "Canindeyú" },
  { code: 19, label: "Chaco" },
  { code: 20, label: "Nueva Asunción" },
];

export const CREDIT_NOTE_DOCUMENT_TYPE = 5;

export function labelFor(options: readonly CodeLabel[], code: number | null): string {
  if (code === null) return "Sin declarar";
  return options.find((option) => option.code === code)?.label ?? `Código ${code}`;
}

export const RANGE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activo",
  VOIDING: "Anulación en curso",
  RETIRED: "Retirado",
};

/** `001-002`: the establishment code and the expedition point, as SIFEN prints them. */
export function pointLabel(establishmentCode: string, expeditionPoint: string): string {
  return `${establishmentCode}-${expeditionPoint}`;
}

export const selectClassName =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
export const textareaClassName =
  "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
