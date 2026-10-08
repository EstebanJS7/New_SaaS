import { describe, expect, it } from "vitest";
import { FiscalProviderModule } from "@newsaas/fiscal";
import { FiscalModule } from "./fiscal.module.js";

/**
 * ADR-008 §2 turned the shared provider module into a dynamic one, so the import
 * is a `DynamicModule` object rather than the class itself. The intent of this
 * test is unchanged — the API's composition root registers the shared provider
 * module — and the assertion follows the shape it now has.
 */
describe("FiscalModule composition", () => {
  it("imports the shared fiscal provider boundary", () => {
    const imports: unknown = Reflect.getMetadata("imports", FiscalModule);
    expect(Array.isArray(imports)).toBe(true);
    if (!Array.isArray(imports)) {
      throw new Error("FiscalModule declares no imports metadata.");
    }

    const registered = imports.filter(
      (entry): entry is { readonly module: unknown } =>
        typeof entry === "object" && entry !== null && "module" in entry
    );

    expect(registered.map((entry) => entry.module)).toContain(FiscalProviderModule);
  });
});
