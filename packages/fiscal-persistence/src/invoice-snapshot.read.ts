import type { Prisma } from "@newsaas/database";
import {
  describeCurrency,
  DTE_CURRENCY_DESCRIPTION_MAX_LENGTH,
  DTE_IVA_RATES,
  DteCatalogueError,
  narrowCode,
  unitOfMeasureSymbol,
  type ConfirmedInvoiceLineSnapshot,
  type ConfirmedInvoiceSnapshot,
  type DteIvaRate,
  type DteReceptor,
} from "@newsaas/fiscal";
import {
  createTaxClassificationReader,
  type TaxClassification,
  type TaxClassificationReadClient,
} from "./tax-classification.read.js";

/**
 * FISC-015 WU-D — the confirmed invoice and its lines to the mapper's snapshot.
 *
 * This is the read the assembly consumes: one call answers the
 * `ConfirmedInvoiceSnapshot` `buildDteRequestFromInvoice` takes, so
 * `DteMappingInput.invoice` is built from the tenant's own rows and from cited
 * protocol tables, never from a default.
 *
 * Where each field comes from:
 *
 * ```text
 * issuedAt              D002 dFeEmiDE   <- invoice.confirmed_at, as fecHhmmss
 * currency              D015 cMoneOpe   <- invoice.currency (ISO 4217)
 * currencyDescription   D016 dDesMoneOpe <- Monedas_v150.xsd, by that code
 * lines[].itemCode      E701 dCodInt    <- invoice_line.catalog_item_id
 * lines[].description   E708 dDesProSer <- invoice_line.description (frozen)
 * lines[].unitOfMeasure cUniMed         <- catalog_item.unit_of_measure_code
 *   ...Description      dDesUniMed      <- Unidades_Medida_v141.xsd, by that code
 * lines[].quantity      E711 dCantProSer <- invoice_line.quantity (10,3)
 * lines[].unitPrice     dPUniProSer     <- invoice_line.unit_price (14,2)
 * lines[].lineTotal     EA008           <- invoice_line.line_total (14,2)
 * lines[].taxableBase   E735 dBasGravIVA <- invoice_line.taxable_base (14,2)
 * lines[].taxAmount     E736 dLiqIVAItem <- invoice_line.tax_amount (14,2)
 * lines[].affectation   E731 iAfecIVA   <- tenant_tax_classification.affectation
 * lines[].ivaRate       E734 dTasaIVA   <- tax_rate.rate, derived (DEC-057 Q1)
 * lines[].proportionality E733 dPropIVA <- tenant_tax_classification.proportionality
 * lines[].exemptBase    E737 dBasExe    <- NT 013's formula, when it divides
 * receptor              gDatRec         <- the caller's, from receptor.read.ts
 * ```
 *
 * **Three things this read refuses rather than answers.**
 *
 * 1. **A line whose rate code the tenant has not classified.** DEC-057 Q1 made
 *    the affectation the tenant's declaration, and the mapper refuses to invent
 *    one; a guessed `iAfecIVA` is a document that misstates a tax treatment.
 * 2. **A rate `tdTasaIVA` cannot carry.** The DE carries a two-digit integer and
 *    NT 013's `E735a`/`E735b`/`E737` formulas are keyed on 5 and 10; the invoice's
 *    own `tax_rate.rate` is a `Decimal(5,2)`, so it is read and narrowed here.
 * 3. **A partially taxed line whose `E737` does not divide exactly.** NT 013
 *    gives `E737 dBasExe = [100 * EA008 * (100 - E733)] / [10000 + (E734 * E733)]`
 *    and **states no rounding rule**, while `tMontoBase` carries 8 fraction
 *    digits. The mapper refuses to re-derive money for the same reason; this read
 *    computes the value exactly and refuses the cases where the exact answer is
 *    not representable, rather than choosing a rounding that SIFEN's `E737`/1921
 *    may disagree with.
 *
 * **`dCodInt` is the catalog item's `id`, and that is a finding.** `CatalogItem`
 * has no code column — its columns are `id`, `kind`, `name`, `tax_rate_id`, the
 * reference-price pair, `is_active`, `tracks_stock` and WU-C's
 * `unit_of_measure_code` — so there is no human-readable internal code to carry.
 * The item's `id` is `tdCodInt`-legal (36 characters against a 1..50 bound) and
 * it is stable and unique per item, which is what NT 009 requires of `E701`
 * ("no se pueden tener ítems distintos... con el mismo código interno"); it is
 * simply not what a person would have typed. A `code` column is a gap for the
 * Story, reported rather than invented here.
 *
 * **`tenantId` is an argument, not ambient context**, and it is in every `where`
 * — the invoice, its lines and the classification batch — so a foreign invoice
 * id can only produce `null`.
 *
 * **Absence is a state, not an error**: an unknown invoice id and another
 * tenant's id are both `null`. Every other path either answers a snapshot or
 * throws `InvoiceSnapshotReadError`.
 */

/** One `invoice` row, in the columns this read needs. */
export interface InvoiceSnapshotRow {
  /** `D015 cMoneOpe`: ISO 4217, inherited from the source sale. */
  readonly currency: string;
  /** `D002 dFeEmiDE`'s source; `NULL` for a draft, which has no fiscal document. */
  readonly confirmedAt: Date | null;
}

/**
 * One `invoice_line` row, in the columns this read needs — all scalars, plus the
 * two id columns (`catalog_item_id`, `rate_code`) that name the related rows.
 *
 * **No nested relation is selected, in the type or in the statement.** The
 * related rows are three more statements rather than one `include`, for the
 * reason the profile read gives: each delegate then returns exactly the column
 * shape this module maps, and the real Prisma client's own payload is assignable
 * to it by construction instead of only when one particular `select` was used.
 *
 * The decimals are Prisma's `Decimal`, declared structurally so a test can pass
 * a plain double — the same shape `tax-classification.read.ts` uses.
 */
export interface InvoiceLineSnapshotRow {
  readonly catalogItemId: string;
  readonly description: string;
  readonly rateCode: string;
  readonly quantity: DecimalColumn;
  readonly unitPrice: DecimalColumn;
  readonly lineTotal: DecimalColumn;
  readonly taxableBase: DecimalColumn;
  readonly taxAmount: DecimalColumn;
}

/** One `catalog_item` row, in the two columns the item carries into the DE. */
export interface InvoiceItemRow {
  readonly id: string;
  /** `cUniMed` (WU-C); `NULL` is "the tenant declared no unit" and is refused. */
  readonly unitOfMeasureCode: string | null;
}

/** One `tax_rate` row, in the two columns this read needs. */
export interface InvoiceRateRow {
  /** `tax_rate.code`, which is what `invoice_line.rate_code` references. */
  readonly code: string;
  /** `tax_rate.rate`, `Decimal(5,2)`: `E734` is derived from it (DEC-057 Q1). */
  readonly rate: DecimalColumn;
}

/** A Prisma `Decimal`, structurally: the read asks for a scale and gets a string. */
export interface DecimalColumn {
  toFixed(digits: number): string;
}

/**
 * The delegate surface, in Prisma's own terms, extended with WU-C's
 * classification delegate because the per-line treatment comes from that read
 * rather than from a second implementation of it.
 */
export interface InvoiceSnapshotReadClient extends TaxClassificationReadClient {
  invoice: {
    findFirst(args: Prisma.InvoiceFindFirstArgs): Promise<InvoiceSnapshotRow | null>;
  };
  invoiceLine: {
    findMany(args: Prisma.InvoiceLineFindManyArgs): Promise<readonly InvoiceLineSnapshotRow[]>;
  };
  /** `catalog_item` is tenant-scoped, so the tenant is in this `where` too. */
  catalogItem: {
    findMany(args: Prisma.CatalogItemFindManyArgs): Promise<readonly InvoiceItemRow[]>;
  };
  /** `tax_rate` is GLOBAL (DEC-021): its rows are not tenant-scoped, by design. */
  taxRate: {
    findMany(args: Prisma.TaxRateFindManyArgs): Promise<readonly InvoiceRateRow[]>;
  };
}

/** Why a confirmed invoice could not become the mapper's snapshot. */
export type InvoiceSnapshotRefusal =
  | "INVOICE_NOT_CONFIRMED"
  | "INVALID_CURRENCY"
  | "ITEM_NOT_READABLE"
  | "ITEM_UNIT_NOT_DECLARED"
  | "UNKNOWN_UNIT_OF_MEASURE"
  | "RATE_NOT_CLASSIFIED"
  | "INVALID_IVA_RATE"
  /**
   * `E737 dBasExe` cannot be computed: either a partially taxed line carries no
   * `E733` (a state WU-C's migration forbids), or NT 013's formula does not
   * divide exactly at `tMontoBase`'s 8 fraction digits and the note states no
   * rounding rule.
   */
  | "EXEMPT_BASE_UNAVAILABLE";

export class InvoiceSnapshotReadError extends Error {
  readonly refusal: InvoiceSnapshotRefusal;

  constructor(refusal: InvoiceSnapshotRefusal, message: string) {
    super(message);
    this.name = "InvoiceSnapshotReadError";
    this.refusal = refusal;
  }
}

export interface InvoiceSnapshotReadArgs {
  readonly tenantId: string;
  readonly invoiceId: string;
  /**
   * The receptor, built by `receptor.read.ts`. It is an argument rather than a
   * second read here, so the customer's rows are mapped in exactly one place —
   * and the snapshot this returns is the mapper's own type, receptor included.
   */
  readonly receptor: DteReceptor;
}

/** `invoice_line`'s own scales (the migration's `DECIMAL(14,2)` and `(10,3)`). */
const MONEY_SCALE = 2;
const QUANTITY_SCALE = 3;
/** `tax_rate.rate` is `DECIMAL(5,2)`. */
const RATE_SCALE = 2;
/** `tMontoBase`'s `fractionDigits` (§21.4): what `E737` is expressed at. */
const EXEMPT_BASE_SCALE = 8n;

export function createInvoiceSnapshotReader(client: InvoiceSnapshotReadClient): {
  /**
   * The mapper's `ConfirmedInvoiceSnapshot` for one confirmed invoice, or `null`
   * when this tenant has no such invoice.
   */
  readInvoiceSnapshot(args: InvoiceSnapshotReadArgs): Promise<ConfirmedInvoiceSnapshot | null>;
} {
  const classifications = createTaxClassificationReader(client);

  return {
    async readInvoiceSnapshot({ tenantId, invoiceId, receptor }) {
      // `findFirst` with BOTH columns in the `where`, never `findUnique` on the
      // invoice id alone: the tenant is part of the identity, so a foreign
      // invoice id cannot match another tenant's row.
      const invoice = await client.invoice.findFirst({ where: { tenantId, id: invoiceId } });
      if (invoice === null) {
        return null;
      }
      if (invoice.confirmedAt === null) {
        throw new InvoiceSnapshotReadError(
          "INVOICE_NOT_CONFIRMED",
          "A draft invoice has no confirmed_at, and dFeEmiDE is issued from it: only a " +
            "confirmed invoice may become a document."
        );
      }

      const currencyDescription = describeCurrencyOf(invoice.currency);

      const rows = await client.invoiceLine.findMany({
        where: { tenantId, invoiceId },
        orderBy: { position: "asc" },
      });

      // The two related reads are batched over the invoice's own ids and codes:
      // one statement each, and an invoice with no lines asks for neither.
      const itemIds = [...new Set(rows.map((row) => row.catalogItemId))];
      const rateCodes = [...new Set(rows.map((row) => row.rateCode))];
      const [items, rates] = await Promise.all([
        itemIds.length === 0
          ? Promise.resolve<readonly InvoiceItemRow[]>([])
          : client.catalogItem.findMany({ where: { tenantId, id: { in: itemIds } } }),
        rateCodes.length === 0
          ? Promise.resolve<readonly InvoiceRateRow[]>([])
          : client.taxRate.findMany({ where: { code: { in: rateCodes } } }),
      ]);
      const itemById = new Map(items.map((item) => [item.id, item]));
      const rateByCode = new Map(rates.map((rate) => [rate.code, rate]));

      // One batch for the whole invoice, through WU-C's own read: a code with no
      // answer is NOT declared, and the line is refused rather than defaulted.
      const declared = await classifications.readClassifications(tenantId, rateCodes);
      const byRateCode = new Map<string, TaxClassification>(
        declared.map((entry) => [entry.rateCode, entry])
      );

      return {
        // `fecHhmmss` has no timezone suffix and no fractional seconds (§21.3),
        // and `confirmed_at` is a `Timestamptz`: the instant is rendered in UTC,
        // which is the one representation the row pins. What local wall-clock
        // time the emitter is in is not modelled anywhere in this repository.
        issuedAt: isoSeconds(invoice.confirmedAt),
        currency: invoice.currency,
        currencyDescription,
        receptor,
        lines: rows.map((row) => lineSnapshot(row, { itemById, rateByCode, byRateCode })),
      };
    },
  };
}

/** The rows a line's mapping needs, resolved once for the whole invoice. */
interface LineContext {
  readonly itemById: ReadonlyMap<string, InvoiceItemRow>;
  readonly rateByCode: ReadonlyMap<string, InvoiceRateRow>;
  readonly byRateCode: ReadonlyMap<string, TaxClassification>;
}

/** One `gCamItem`'s worth of the snapshot, or the refusal that stops it. */
function lineSnapshot(
  row: InvoiceLineSnapshotRow,
  context: LineContext
): ConfirmedInvoiceLineSnapshot {
  const classification = context.byRateCode.get(row.rateCode);
  if (classification === undefined) {
    throw new InvoiceSnapshotReadError(
      "RATE_NOT_CLASSIFIED",
      `This tenant has declared no fiscal classification for rate code "${row.rateCode}" ` +
        "(iAfecIVA and, for a partially taxed item, dPropIVA). DEC-057 Q1 makes it the " +
        "tenant's declaration, and the mapper refuses to invent one."
    );
  }

  // `dCodInt`, from the item's own row: see the module header — the catalog has
  // no code column, so the item's id is what the DE carries.
  const item = context.itemById.get(row.catalogItemId);
  if (item === undefined) {
    // `invoice_line.catalog_item_id` is a composite tenant-ownership FK, so an
    // unreadable row means this client cannot see what the database joined.
    throw new InvoiceSnapshotReadError(
      "ITEM_NOT_READABLE",
      "The invoice line's catalog item is not readable in this tenant, so cUniMed and " +
        "dCodInt have no source."
    );
  }

  const unitOfMeasureCode = item.unitOfMeasureCode;
  if (unitOfMeasureCode === null) {
    throw new InvoiceSnapshotReadError(
      "ITEM_UNIT_NOT_DECLARED",
      "The catalog item declares no unit of measure, so cUniMed and dDesUniMed have no " +
        "source. Which unit an item is, is tenant data (DEC-057), and the assembly refuses " +
        "rather than guessing one."
    );
  }

  // `E734` has one source and this is it: the GLOBAL `tax_rate` row the line's
  // `rate_code` references (RESTRICT, so an unreadable row is a client problem).
  const rate = context.rateByCode.get(row.rateCode);
  if (rate === undefined) {
    throw new InvoiceSnapshotReadError(
      "INVALID_IVA_RATE",
      `No tax_rate row answers the invoice line's rate code "${row.rateCode}".`
    );
  }

  const affectation = classification.affectation;
  const ivaRate = ivaRateOf(rate.rate);
  return {
    itemCode: item.id,
    description: row.description,
    unitOfMeasureCode,
    unitOfMeasureDescription: unitSymbolOf(unitOfMeasureCode),
    quantity: row.quantity.toFixed(QUANTITY_SCALE),
    unitPrice: row.unitPrice.toFixed(MONEY_SCALE),
    lineTotal: row.lineTotal.toFixed(MONEY_SCALE),
    taxableBase: row.taxableBase.toFixed(MONEY_SCALE),
    taxAmount: row.taxAmount.toFixed(MONEY_SCALE),
    affectation,
    ivaRate,
    // `E733` is meaningful only for the partial affectation; WU-C's CHECK makes
    // it present exactly there and NULL everywhere else, and the mapper's own
    // documented default is full proportionality.
    ...(classification.proportionality === null
      ? {}
      : { proportionality: classification.proportionality }),
    // NT 013: `E737` is 0 for E731 = 1, 2 and 3, and the formula for E731 = 4.
    exemptBase:
      affectation === 4
        ? exemptBaseFor(row.lineTotal.toFixed(MONEY_SCALE), classification.proportionality, ivaRate)
        : "0",
  };
}

/**
 * `E734 dTasaIVA` from the rate row.
 *
 * DEC-057 Q1: the rate is **derived, not declared** — `tax_rate.rate` already
 * carries it — and the DE carries a two-digit integer, so a rate that is not one
 * of `DTE_IVA_RATES` (0, 5, 10) is refused rather than rounded into one.
 */
function ivaRateOf(rate: DecimalColumn): DteIvaRate {
  const text = rate.toFixed(RATE_SCALE);
  const match = /^([0-9]+)\.00$/.exec(text);
  if (match === null) {
    throw new InvoiceSnapshotReadError(
      "INVALID_IVA_RATE",
      `dTasaIVA is a two-digit integer and tax_rate.rate carries ${text}.`
    );
  }
  try {
    return narrowCode(DTE_IVA_RATES, Number(match[1]), "IVA rate (tdTasaIVA)");
  } catch (error) {
    if (error instanceof DteCatalogueError) {
      throw new InvoiceSnapshotReadError("INVALID_IVA_RATE", error.message);
    }
    throw error;
  }
}

/**
 * `E737 dBasExe`, from NT 013's own formula:
 *
 * ```text
 * E737 = [100 * EA008 * (100 - E733)] / [10000 + (E734 * E733)]
 * ```
 *
 * Computed over scaled integers, never a float, and refused when it does not
 * divide exactly at `tMontoBase`'s 8 fraction digits: NT 013 states no rounding
 * rule, and rounding money here would be a choice this read has no source for.
 */
function exemptBaseFor(
  lineTotal: string,
  proportionality: string | null,
  ivaRate: DteIvaRate
): string {
  if (proportionality === null) {
    throw new InvoiceSnapshotReadError(
      "EXEMPT_BASE_UNAVAILABLE",
      "A partially taxed line needs E733 dPropIVA to compute E737, and this tenant's " +
        "declaration carries none."
    );
  }
  const total = scaled(lineTotal);
  const proportion = scaled(proportionality);
  const ten = 10n;
  // With EA008 = total.value / 10^t and E733 = proportion.value / 10^p, the
  // formula becomes one ratio of integers:
  //   [100 * total.value * (100 * 10^p - proportion.value)]
  //   / [10^t * (10000 * 10^p + E734 * proportion.value)]
  const proportionScale = ten ** BigInt(proportion.scale);
  const numerator = 100n * total.value * (100n * proportionScale - proportion.value);
  const denominator =
    ten ** BigInt(total.scale) * (10_000n * proportionScale + BigInt(ivaRate) * proportion.value);

  // The value has to land inside `tMontoBase`'s 8 fraction digits exactly: the
  // scale is applied to the numerator and the division must come out whole.
  const target = numerator * ten ** EXEMPT_BASE_SCALE;
  const scaledValue = target / denominator;
  if (scaledValue * denominator !== target) {
    throw new InvoiceSnapshotReadError(
      "EXEMPT_BASE_UNAVAILABLE",
      `E737 dBasExe is [100 * EA008 * (100 - E733)] / [10000 + (E734 * E733)] (NT 013) and ` +
        `${lineTotal} with E733 = ${proportionality} and E734 = ${String(ivaRate)} does not ` +
        "divide exactly at tMontoBase's 8 fraction digits. The note states no rounding rule, " +
        "so the read refuses rather than choosing one for a tax base."
    );
  }
  return formatScaled(scaledValue, Number(EXEMPT_BASE_SCALE));
}

/** A plain decimal string as `value / 10^scale`, over BigInt. */
function scaled(value: string): { readonly value: bigint; readonly scale: number } {
  const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (match === null) {
    throw new InvoiceSnapshotReadError(
      "EXEMPT_BASE_UNAVAILABLE",
      `E737's inputs are non-negative plain decimal strings, and "${value}" is not one.`
    );
  }
  const fraction = match[1] ?? "";
  const [integerPart = "0"] = value.split(".");
  return { value: BigInt(`${integerPart}${fraction}`), scale: fraction.length };
}

/** A BigInt scaled by `scale` as a decimal string at exactly that scale. */
function formatScaled(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

/** `dDesUniMed` from the units table, or a refusal naming the code. */
function unitSymbolOf(unitOfMeasureCode: string): string {
  try {
    return unitOfMeasureSymbol(unitOfMeasureCode);
  } catch (error) {
    if (error instanceof DteCatalogueError) {
      throw new InvoiceSnapshotReadError("UNKNOWN_UNIT_OF_MEASURE", error.message);
    }
    throw error;
  }
}

/**
 * `dDesMoneOpe` from the currencies table, refused when the published name does
 * not fit `tdDMoneTiPag`'s 3..20 characters — the artifact's own list is longer
 * for a handful of codes, and a name the schema cannot carry is not emitted.
 */
function describeCurrencyOf(currency: string): string {
  let description: string;
  try {
    description = describeCurrency(currency);
  } catch (error) {
    if (error instanceof DteCatalogueError) {
      throw new InvoiceSnapshotReadError("INVALID_CURRENCY", error.message);
    }
    throw error;
  }
  if (description.length > DTE_CURRENCY_DESCRIPTION_MAX_LENGTH) {
    throw new InvoiceSnapshotReadError(
      "INVALID_CURRENCY",
      `dDesMoneOpe's type is tdDMoneTiPag (3 to 20 characters) and Monedas_v150.xsd names ` +
        `${currency} "${description}", ${String(description.length)} characters.`
    );
  }
  return description;
}

/** `fecHhmmss` from an instant, in UTC and without a timezone suffix (§21.3). */
function isoSeconds(instant: Date): string {
  return instant.toISOString().slice(0, 19);
}
