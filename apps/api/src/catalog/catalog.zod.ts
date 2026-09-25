import { z } from "zod";
import type { CatalogItemKindDto } from "./catalog.dto.js";

/**
 * Current contract version of the catalog item DTO, carried in every catalog
 * audit row's metadata. Bumped when the accepted key set or value formats
 * change. (The Customer/Patient contracts use the same convention.)
 */
export const CATALOG_DTO_SCHEMA_VERSION = 1;

/**
 * Runtime mirror of the DTO kind union (PRD §15, `catalog_item_kind`). Pinned
 * with `satisfies` so the enum cannot drift from the DTO it validates, the
 * same convention the appointment statuses use.
 */
export const CATALOG_ITEM_KINDS = [
  "PRODUCT",
  "SERVICE",
  "MEDICATION",
  "SUPPLY",
] as const satisfies readonly CatalogItemKindDto[];

export const catalogItemKind = z.enum(CATALOG_ITEM_KINDS);

/** Item-addressed path parameter; a non-UUID is `400 VALIDATION_FAILED`. */
export const catalogItemIdParam = z.object({ id: z.string().uuid() });

/**
 * Item list query. Query strings arrive as text, so `isActive` accepts exactly
 * `"true"`/`"false"` and is coerced to a boolean; anything else is rejected.
 * `.strict()` rejects unknown query keys instead of ignoring them, mirroring
 * the appointment filter query.
 */
export const catalogItemListQuery = z
  .object({
    kind: catalogItemKind.optional(),
    isActive: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
  })
  .strict();

/**
 * Item name: same 1..200 bound the Customer `displayName` and the Patient
 * `name` use, so every tenant-scoped name field of the product agrees on one
 * maximum. The database column is unbounded `TEXT`, so this API contract is
 * what keeps a blank or unbounded name out.
 */
export const CATALOG_ITEM_NAME_MAX_LENGTH = 200;
const catalogItemName = z.string().min(1).max(CATALOG_ITEM_NAME_MAX_LENGTH);

/**
 * Accepted reference-price currencies (ISO 4217).
 *
 * PRD §1 fixes `currency: PYG` and `secondary currency support: USD`, so the
 * accepted set is exactly those two. The migration comment for
 * `catalog_item.reference_price_currency` states the split explicitly: the
 * database CHECK enforces ISO 4217 SHAPE only (`^[A-Z]{3}$`) "the accepted code
 * list is validated by the API". DEC-010 boundary 2 requires unknown or
 * unsupported codes to be rejected server-side rather than stored, so a
 * well-formed but unsupported code (`ZZZ`) is a 400 just like a malformed one
 * (`pyg`). Widening this set is a product decision, not a silent client option.
 */
export const CATALOG_REFERENCE_PRICE_CURRENCIES = ["PYG", "USD"] as const;
const catalogReferencePriceCurrency = z.enum(CATALOG_REFERENCE_PRICE_CURRENCIES);

/**
 * Reference-price amount as an exact decimal TEXT capped at the
 * `Decimal(14, 2)` column: up to 12 integer digits and 2 decimals. The
 * `ClinicalWeight.quantity` precedent — money and quantities never travel as a
 * JavaScript number, so a float cannot enter the boundary and no rounding is
 * implied. A negative amount cannot match the pattern at all.
 */
const catalogReferencePriceAmount = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    "Reference price amount must be an exact non-negative decimal string (max 14 digits, 2 decimals)."
  );

/**
 * The reference price is ONE pair (DEC-010 boundary 2): amount and currency are
 * both present or both absent. Applied to create and update alike.
 *
 * `undefined` means ABSENT and `null` means CLEAR, the convention the portal
 * profile payload documents. The two rules below make exactly one state valid
 * per key pair: both keys absent (leave untouched / no price), or both keys
 * carrying a value. A lone key — supplied, cleared, or mismatched — is a 400
 * and persists nothing.
 */
interface ReferencePricePairInput {
  readonly referencePriceAmount?: string | null;
  readonly referencePriceCurrency?: string | null;
}

function assertReferencePricePair(value: ReferencePricePairInput, ctx: z.RefinementCtx): void {
  const amountProvided = value.referencePriceAmount !== undefined;
  const currencyProvided = value.referencePriceCurrency !== undefined;
  if (amountProvided !== currencyProvided) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [amountProvided ? "referencePriceCurrency" : "referencePriceAmount"],
      message: "Reference price amount and currency must be supplied together.",
    });
    return;
  }
  if (!amountProvided) return;

  // Both keys are present, so `undefined` is already excluded; only a real
  // value (`string`) or an explicit `null` clear remains.
  const amountSet = value.referencePriceAmount !== null;
  const currencySet = value.referencePriceCurrency !== null;
  if (amountSet !== currencySet) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [amountSet ? "referencePriceCurrency" : "referencePriceAmount"],
      message: "Reference price amount and currency must both be set or both be cleared.",
    });
  }
}

/**
 * Create payload. `kind` and `name` are required, and `taxRateId` is REQUIRED:
 * no rate-less item state is representable (EPIC-09 "Decided", PRD §15), so the
 * service additionally resolves the id against the three GLOBAL seeded rates.
 * `.strict()` rejects unknown keys — including `isActive`, which only the
 * dedicated deactivate command may change.
 */
const createCatalogItemPayload = z
  .object({
    kind: catalogItemKind,
    name: catalogItemName,
    taxRateId: z.string().uuid(),
    referencePriceAmount: catalogReferencePriceAmount.nullable().optional(),
    referencePriceCurrency: catalogReferencePriceCurrency.nullable().optional(),
  })
  .strict();

export const createCatalogItemBody = createCatalogItemPayload.superRefine(assertReferencePricePair);
export type CreateCatalogItemInput = z.infer<typeof createCatalogItemPayload>;

/**
 * Update payload. Every field is optional; an absent key leaves the stored
 * value untouched, and the reference-price pair follows the `null` clears /
 * absent leaves untouched convention documented above.
 *
 * `taxRateId` is deliberately NOT nullable: a present value must resolve to a
 * seeded rate and an explicit `null` ("clear the rate") fails the UUID check
 * with `400 VALIDATION_FAILED`, because no rate-less item state is valid. An
 * omitted key leaves the selected rate unchanged.
 *
 * `isActive` is absent on purpose: deactivation has its own command route and
 * its own `catalog.deactivate` permission, so `catalog.update` can never
 * deactivate an item (a supplied `isActive` is an unknown key and a 400).
 */
const updateCatalogItemPayload = z
  .object({
    kind: catalogItemKind.optional(),
    name: catalogItemName.optional(),
    taxRateId: z.string().uuid().optional(),
    referencePriceAmount: catalogReferencePriceAmount.nullable().optional(),
    referencePriceCurrency: catalogReferencePriceCurrency.nullable().optional(),
  })
  .strict();

export const updateCatalogItemBody = updateCatalogItemPayload.superRefine(assertReferencePricePair);
export type UpdateCatalogItemInput = z.infer<typeof updateCatalogItemPayload>;
