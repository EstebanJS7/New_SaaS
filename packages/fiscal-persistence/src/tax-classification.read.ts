import type { Prisma } from "@newsaas/database";
import { AFEC_IVA_VALUES } from "@newsaas/fiscal";

/**
 * FISC-015 WU-C — the tenant's fiscal classification of a rate code.
 *
 * [[DEC-057]] Q1 decided that a rate code's fiscal meaning is the **tenant's
 * declaration**, carried beside the rate: `tax_rate` is GLOBAL and platform
 * seeded, and its `rate` is a percentage rather than a tax treatment. This is the
 * read that serves that declaration to the assembly, and it is deliberately the
 * only place that turns a `tenant_tax_classification` column into a value
 * `packages/fiscal` can consume.
 *
 * **`tenantId` is an argument, not ambient context.** Every query puts it in the
 * `where` clause, so a foreign rate code or another tenant's row can only
 * produce "not declared", never a classification. The same rule the credential
 * read and the profile read follow.
 *
 * **The affectation is answered as the protocol's code, and that is not a
 * default.** The stored enum's four members ARE `iAfecIVA`'s four values — the
 * schema states the pairing in its own comments, and SIFEN-BASELINE.md §21.5
 * transcribes it: `1` Gravado IVA, `2` Exonerado (Art. 100 - Ley 6380/2019),
 * `3` Exento, `4` Gravado parcial — so the mapping below is the protocol's, not
 * an invention. It is written **by name and never by ordinal position**, because
 * an enum's declaration order is not a contract and the repository already paid
 * for that lesson in `dte.catalogues.ts` (`tdDesTiTran`'s 11 entries against the
 * Manual's 13).
 *
 * **Absence is a state, not an error.** A rate code the tenant has not classified
 * answers `null` — from the single read, and by its absence from the batch's
 * result — and the caller decides. Issuance refuses, which is what [[DEC-057]]
 * chose over a document that misstates a tax treatment.
 */

/** `tiAfecIVA` (`E731`), as `packages/fiscal`'s mapper consumes it: 1..4. */
export type DteIvaAffectation = (typeof AFEC_IVA_VALUES)[number];

/** The stored enum's four members. A fifth value would break the client's fit. */
export type StoredIvaAffectation = "GRAVADO_IVA" | "EXONERADO" | "EXENTO" | "GRAVADO_PARCIAL";

/**
 * `E731 iAfecIVA`'s four values, paired with the stored declaration by NAME.
 *
 * `Record<StoredIvaAffectation, DteIvaAffectation>` makes the map exhaustive and
 * the codes exact: a missing declaration or a wrong number is a compile error
 * rather than a DE that misstates a tax treatment.
 */
const AFFECTATION_BY_DECLARATION: Record<StoredIvaAffectation, DteIvaAffectation> = {
  GRAVADO_IVA: 1,
  EXONERADO: 2,
  EXENTO: 3,
  GRAVADO_PARCIAL: 4,
};

/** `proportionality` is `DECIMAL(5,2)`, so this is its declared scale. */
const PROPORTIONALITY_SCALE = 2;

/** One `tenant_tax_classification` row, in the columns this read needs. */
export interface TenantTaxClassificationRow {
  readonly rateCode: string;
  readonly affectation: StoredIvaAffectation;
  /**
   * `E733 dPropIVA`. Prisma returns a `Decimal`, which satisfies this
   * structurally — the row shape stays free of Prisma classes so a test can pass
   * a plain double.
   */
  readonly proportionality: { toFixed(digits: number): string } | null;
}

/** One tenant's declaration, as the assembly consumes it. */
export interface TaxClassification {
  readonly rateCode: string;
  /** `E731 iAfecIVA`: 1, 2, 3 or 4. */
  readonly affectation: DteIvaAffectation;
  /** `E733 dPropIVA` as a decimal string, or `null` for the three non-partial affectations. */
  readonly proportionality: string | null;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * Declared structurally so the Prisma client fits by construction and a test can
 * pass a fake that records the statements — the same shape the credential read
 * and the profile read use.
 */
export interface TaxClassificationReadClient {
  tenantTaxClassification: {
    findFirst(
      args: Prisma.TenantTaxClassificationFindFirstArgs
    ): Promise<TenantTaxClassificationRow | null>;
    findMany(
      args: Prisma.TenantTaxClassificationFindManyArgs
    ): Promise<readonly TenantTaxClassificationRow[]>;
  };
}

export function createTaxClassificationReader(client: TaxClassificationReadClient): {
  /** The tenant's declaration for one rate code, or `null` when it has none. */
  readClassification(tenantId: string, rateCode: string): Promise<TaxClassification | null>;
  /**
   * The tenant's declarations for a set of rate codes, in `rateCode` order.
   * A requested code with no entry in the answer is **not declared**.
   */
  readClassifications(
    tenantId: string,
    rateCodes: readonly string[]
  ): Promise<readonly TaxClassification[]>;
} {
  return {
    async readClassification(tenantId, rateCode) {
      const row = await client.tenantTaxClassification.findFirst({
        where: { tenantId, rateCode },
      });
      return row === null ? null : toClassification(row);
    },

    async readClassifications(tenantId, rateCodes) {
      // An invoice carries several lines and several of them share a rate code,
      // so this is one statement for the whole set. An empty set is answered
      // without a query: `in: []` would be a round trip that can only return
      // nothing, and the answer is the same either way.
      if (rateCodes.length === 0) {
        return [];
      }
      const rows = await client.tenantTaxClassification.findMany({
        where: { tenantId, rateCode: { in: [...rateCodes] } },
        orderBy: { rateCode: "asc" },
      });
      return rows.map(toClassification);
    },
  };
}

function toClassification(row: TenantTaxClassificationRow): TaxClassification {
  return {
    rateCode: row.rateCode,
    affectation: AFFECTATION_BY_DECLARATION[row.affectation],
    proportionality:
      row.proportionality === null ? null : row.proportionality.toFixed(PROPORTIONALITY_SCALE),
  };
}
