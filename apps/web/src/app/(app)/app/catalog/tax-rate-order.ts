import type { TaxRate } from "./catalog-api";

/**
 * Human display order for the GLOBAL seeded rates (GAP 2, CAT-004).
 *
 * `GET /catalog/tax-rates` orders rows by `code`, which is lexicographic and
 * therefore `EXEMPT`, `IVA_10`, `IVA_5`. That order is deterministic but not the
 * one a person reading a tax list expects. This is a PRESENTATION rule only:
 * the API, the seed and the stored data keep their own order, and nothing here
 * mutates a rate.
 */
const TAX_RATE_DISPLAY_RANK: Record<string, number> = {
  EXEMPT: 0,
  IVA_5: 1,
  IVA_10: 2,
};

/**
 * Returns a copy of the fetched rate list in human order (`EXEMPT`, `IVA_5`,
 * `IVA_10`).
 *
 * A code outside the seeded set sorts after the known ones and keeps a
 * deterministic lexicographic order among its peers, so an unexpected rate
 * stays visible instead of being dropped or placed arbitrarily.
 */
export function sortTaxRatesForDisplay(rates: readonly TaxRate[]): TaxRate[] {
  const rankOf = (rate: TaxRate): number =>
    TAX_RATE_DISPLAY_RANK[rate.code] ?? Number.MAX_SAFE_INTEGER;

  return [...rates].sort((left, right) => {
    const byRank = rankOf(left) - rankOf(right);
    return byRank !== 0 ? byRank : left.code.localeCompare(right.code);
  });
}
