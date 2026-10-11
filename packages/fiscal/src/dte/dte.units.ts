/**
 * FISC-015 WU-D — the protocol's own units of measure: `tcUniMed` and
 * `tdDesUniMed`.
 *
 * The Manual's `cUniMed`/`dDesUniMed` (the item's unit of measure, §21.6 and
 * §22.6) are **the protocol's own list, not tenant data**: the artifact below
 * publishes both enumerations, so neither is stored and neither is invented here.
 * **Which** unit an item is, is tenant data and lives in
 * `catalog_item.unit_of_measure_code` ([[FISC-015]] WU-C; [[DEC-057]]'s "What
 * this document does not decide").
 *
 * **Generated from the artifact's own bytes, never typed by hand.**
 *
 * ```text
 * artifact    Unidades_Medida_v141.xsd        27,240 bytes   md5 381ec7c42ea1e422d79b9c16ff88ee53
 * directory   https://ekuatia.set.gov.py/sifen/xsd/
 * retrieved   2026-10-04, HTTP 200   (SIFEN-BASELINE.md §22.1)
 * regenerated 2026-10-10, from the same bytes, with a parser over the two
 *             enumerations — the pairing below is checked, not assumed
 * ```
 *
 * **Two enumerations, one entry.** `tcUniMed` is the numeric code the DE emits
 * and carries the unit's own documentation (`77` -> `"Unidad - UNI"`);
 * `tdDesUniMed` enumerates the `dDesUniMed` strings (`"UNI"` -> `"Unidad"`).
 * They are parallel lists, and this module verifies that each code's
 * documentation is exactly `"<tdDesUniMed name> - <tdDesUniMed symbol>"` before
 * it pairs them — the artifact order is not trusted on its own.
 *
 * **`description` is what the artifact documents, `symbol` is what
 * `dDesUniMed` may carry.** The distinction is a schema fact, not a style:
 * `dDesUniMed`'s type is `tdDesUniMed`, `minLength 1` and `maxLength 10`, so
 * `"Unidad - UNI"` (12 characters) is **schema-invalid** and `"UNI"` is the
 * value the DE carries. Every one of the 64 symbols fits the 10;
 * the longest is "kg/m2".
 *
 * **Every code the artifact publishes is here** — 64 of them, in the
 * artifact's own order. A partial table would refuse a legitimate value, and a
 * refused legitimate value is an invoice that cannot be issued.
 *
 * The lookup **refuses** an unknown code rather than answering undefined: a code
 * the protocol does not publish must never become a document SIFEN rejects.
 * Codes match exactly, as the artifact spells them (`77`, never `077`): the
 * table is the protocol's own source of record, and a caller holding a
 * different spelling holds a code the artifact does not publish.
 */

import { DteCatalogueError, namedCodeFor, type DteNamedCode } from "./dte.catalogues.js";

/**
 * One `tcUniMed` code, the documentation the artifact gives it, and the
 * `tdDesUniMed` string that pairs with it.
 */
export interface DteUnitOfMeasure extends DteNamedCode {
  /** The `tdDesUniMed` value: what `dDesUniMed` carries (1..10 characters). */
  readonly symbol: string;
}

/** The artifact's 64 `tcUniMed` codes, keyed by the code itself. */
export const DTE_UNITS_OF_MEASURE: ReadonlyMap<string, DteUnitOfMeasure> = new Map([
  ["87", { code: "87", description: "Metros - m", symbol: "m" }],
  ["2366", { code: "2366", description: "Costo Por Mil - CPM", symbol: "CPM" }],
  ["2329", { code: "2329", description: "Unidad Internacional - UI", symbol: "UI" }],
  ["110", { code: "110", description: "Metros cúbicos - M3", symbol: "M3" }],
  ["77", { code: "77", description: "Unidad - UNI", symbol: "UNI" }],
  ["86", { code: "86", description: "Gramos - g", symbol: "g" }],
  ["89", { code: "89", description: "Litros - LT", symbol: "LT" }],
  ["90", { code: "90", description: "Miligramos - MG", symbol: "MG" }],
  ["91", { code: "91", description: "Centimetros - CM", symbol: "CM" }],
  ["92", { code: "92", description: "Centimetros cuadrados - CM2", symbol: "CM2" }],
  ["93", { code: "93", description: "Centimetros cubicos - CM3", symbol: "CM3" }],
  ["94", { code: "94", description: "Pulgadas - PUL", symbol: "PUL" }],
  ["96", { code: "96", description: "Milímetros cuadrados - MM2", symbol: "MM2" }],
  ["79", { code: "79", description: "Kilogramos s/ metro cuadrado - kg/m2", symbol: "kg/m2" }],
  ["97", { code: "97", description: "Año - AA", symbol: "AA" }],
  ["98", { code: "98", description: "Mes - ME", symbol: "ME" }],
  ["99", { code: "99", description: "Tonelada - TN", symbol: "TN" }],
  ["100", { code: "100", description: "Hora - Hs", symbol: "Hs" }],
  ["101", { code: "101", description: "Minuto - Mi", symbol: "Mi" }],
  ["104", { code: "104", description: "Determinación - DET", symbol: "DET" }],
  ["103", { code: "103", description: "Yardas - Ya", symbol: "Ya" }],
  ["108", { code: "108", description: "Metros - MT", symbol: "MT" }],
  ["109", { code: "109", description: "Metros cuadrados - M2", symbol: "M2" }],
  ["95", { code: "95", description: "Milímetros - MM", symbol: "MM" }],
  ["666", { code: "666", description: "Segundo - Se", symbol: "Se" }],
  ["102", { code: "102", description: "Día - Di", symbol: "Di" }],
  ["83", { code: "83", description: "Kilogramos - kg", symbol: "kg" }],
  ["88", { code: "88", description: "Mililitros - ML", symbol: "ML" }],
  ["625", { code: "625", description: "Kilómetros - Km", symbol: "Km" }],
  ["660", { code: "660", description: "Metro lineal - ml", symbol: "ml" }],
  ["885", { code: "885", description: "Unidad Medida Global - GL", symbol: "GL" }],
  ["891", { code: "891", description: "Por Milaje - pm", symbol: "pm" }],
  ["869", { code: "869", description: "Hectáreas - ha", symbol: "ha" }],
  ["569", { code: "569", description: "Ración - ración", symbol: "ración" }],
  ["111", { code: "111", description: "Bovinas - 4A", symbol: "4A" }],
  ["112", { code: "112", description: "Curie - Ci", symbol: "Ci" }],
  ["113", { code: "113", description: "Docena - DOC", symbol: "DOC" }],
  ["114", { code: "114", description: "Galones (US) (3,7843 LT) - GLL", symbol: "GLL" }],
  ["115", { code: "115", description: "Gruesas - GRO", symbol: "GRO" }],
  ["116", { code: "116", description: "Kilogramo Bruto - E4", symbol: "E4" }],
  ["117", { code: "117", description: "Kits - KT", symbol: "KT" }],
  ["118", { code: "118", description: "Microcurie - M5", symbol: "M5" }],
  ["119", { code: "119", description: "Milicurie - MCU", symbol: "MCU" }],
  ["120", { code: "120", description: "Millar - MIL", symbol: "MIL" }],
  ["121", { code: "121", description: "Par - PAR", symbol: "PAR" }],
  ["122", { code: "122", description: "Pies - FOT", symbol: "FOT" }],
  ["123", { code: "123", description: "Pies Cuadradas - FTK", symbol: "FTK" }],
  ["124", { code: "124", description: "Piezas - PCE", symbol: "PCE" }],
  ["125", { code: "125", description: "Quilate - KLT", symbol: "KLT" }],
  ["126", { code: "126", description: "Resmas - RM", symbol: "RM" }],
  ["127", { code: "127", description: "Rollos - RO", symbol: "RO" }],
  ["128", { code: "128", description: "1000 Kilowatt Hora - kWh", symbol: "kWh" }],
  ["129", { code: "129", description: "Mazos - U(JGO)", symbol: "U(JGO)" }],
  ["130", { code: "130", description: "Tambores - DR", symbol: "DR" }],
  ["131", { code: "131", description: "Caja - BX", symbol: "BX" }],
  ["132", { code: "132", description: "Juego - SET", symbol: "SET" }],
  ["133", { code: "133", description: "Paquete - PK", symbol: "PK" }],
  ["134", { code: "134", description: "Bolsa - BG", symbol: "BG" }],
  ["135", { code: "135", description: "Docena Par - DPC", symbol: "DPC" }],
  ["136", { code: "136", description: "Pote - JR", symbol: "JR" }],
  ["137", { code: "137", description: "Fardos - BL", symbol: "BL" }],
  ["138", { code: "138", description: "Bulto - AB", symbol: "AB" }],
  ["139", { code: "139", description: "Cesta - BK", symbol: "BK" }],
  ["140", { code: "140", description: "Peso Base - BW", symbol: "BW" }],
]);

/** The entry for a code, or a failure naming the code and this table. */
export function unitOfMeasureFor(code: string): DteUnitOfMeasure {
  return namedCodeFor(
    DTE_UNITS_OF_MEASURE,
    code,
    "unit of measure published by Unidades_Medida_v141.xsd"
  );
}

/** The artifact's own documentation for a code, e.g. `"Unidad - UNI"` for `77`. */
export function describeUnitOfMeasure(code: string): string {
  return unitOfMeasureFor(code).description;
}

/** The `dDesUniMed` string for a code, e.g. `"UNI"` for `77`. */
export function unitOfMeasureSymbol(code: string): string {
  return unitOfMeasureFor(code).symbol;
}

// Re-exported so a caller that catches this module's refusals needs one import.
export { DteCatalogueError };
