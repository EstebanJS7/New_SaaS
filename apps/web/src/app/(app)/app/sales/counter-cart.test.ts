/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../catalog/catalog-api";
import {
  buildSaleLines,
  cartLineFromItem,
  cartValidationError,
  filterCatalogItemsByName,
} from "./counter-cart";

function catalogItem(overrides: Partial<CatalogItem> & { readonly name: string }): CatalogItem {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    tenantId: "tenant-a",
    kind: "PRODUCT",
    taxRateId: "rate-1",
    taxRate: { code: "IVA_10", name: "IVA 10%", rate: "10.00" },
    referencePriceAmount: null,
    referencePriceCurrency: null,
    isActive: true,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("cartLineFromItem", () => {
  it("pre-fills the applied price from the catalog reference price", () => {
    const line = cartLineFromItem(
      catalogItem({
        name: "Antibiotic",
        referencePriceAmount: "1500.00",
        referencePriceCurrency: "PYG",
      }),
      "cart-0"
    );

    expect(line.unitPrice).toBe("1500.00");
    expect(line.referencePriceAmount).toBe("1500.00");
    expect(line.referencePriceCurrency).toBe("PYG");
    expect(line.quantity).toBe("1.000");
  });

  it("leaves the applied price empty for an item with no reference price", () => {
    const line = cartLineFromItem(catalogItem({ name: "Service" }), "cart-0");

    expect(line.unitPrice).toBe("");
    expect(line.referencePriceAmount).toBeNull();
  });
});

describe("buildSaleLines", () => {
  it("sends the applied price explicitly when the operator has one", () => {
    const line = {
      ...cartLineFromItem(
        catalogItem({
          name: "Antibiotic",
          referencePriceAmount: "1500.00",
          referencePriceCurrency: "PYG",
        }),
        "cart-0"
      ),
      quantity: "2.000",
    };

    expect(buildSaleLines([line])).toEqual([
      {
        catalogItemId: "33333333-3333-4333-8333-333333333333",
        quantity: "2.000",
        unitPrice: "1500.00",
      },
    ]);
  });

  it("omits the optional applied price when the field is cleared", () => {
    const line = {
      ...cartLineFromItem(
        catalogItem({
          name: "Antibiotic",
          referencePriceAmount: "1500.00",
          referencePriceCurrency: "PYG",
        }),
        "cart-0"
      ),
      unitPrice: "",
    };

    const [submitted] = buildSaleLines([line]);
    expect(submitted).toEqual({
      catalogItemId: "33333333-3333-4333-8333-333333333333",
      quantity: "1.000",
    });
    expect(submitted).not.toHaveProperty("unitPrice");
    expect(submitted).not.toHaveProperty("status");
    expect(submitted).not.toHaveProperty("tenantId");
  });
});

describe("cartValidationError", () => {
  const priced = cartLineFromItem(
    catalogItem({
      name: "Antibiotic",
      referencePriceAmount: "1500.00",
      referencePriceCurrency: "PYG",
    }),
    "cart-0"
  );

  it("requires at least one line", () => {
    expect(cartValidationError([])).toBe("Add at least one line before checking out.");
  });

  it("accepts a valid line", () => {
    expect(cartValidationError([priced])).toBeNull();
  });

  it("rejects a zero or malformed quantity", () => {
    expect(cartValidationError([{ ...priced, quantity: "0.000" }])).toContain("positive quantity");
    expect(cartValidationError([{ ...priced, quantity: "abc" }])).toContain("positive quantity");
  });

  it("requires the operator to enter a price for an item with no reference price", () => {
    const unpriced = cartLineFromItem(catalogItem({ name: "Service" }), "cart-0");
    expect(cartValidationError([unpriced])).toContain(
      "Service has no reference price; enter the applied price."
    );
    expect(cartValidationError([{ ...unpriced, unitPrice: "0.00" }])).toBeNull();
  });

  it("rejects a malformed applied price", () => {
    expect(cartValidationError([{ ...priced, unitPrice: "15.999" }])).toContain(
      "applied price with at most two decimals"
    );
  });
});

describe("filterCatalogItemsByName", () => {
  const items = [
    catalogItem({ id: "a", name: "Antibiotic" }),
    catalogItem({ id: "b", name: "Antiparasitic" }),
    catalogItem({ id: "c", name: "Gauze roll" }),
  ];

  it("returns every item for an empty query", () => {
    expect(filterCatalogItemsByName(items, "  ")).toHaveLength(3);
  });

  it("matches a case-insensitive substring of the name", () => {
    expect(filterCatalogItemsByName(items, "anti").map((item) => item.id)).toEqual(["a", "b"]);
    expect(filterCatalogItemsByName(items, "GAUZE").map((item) => item.id)).toEqual(["c"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterCatalogItemsByName(items, "zzz")).toEqual([]);
  });
});
