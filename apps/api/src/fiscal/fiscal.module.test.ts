import { describe, expect, it } from "vitest";
import { FiscalProviderModule } from "@newsaas/fiscal";
import { FiscalModule } from "./fiscal.module.js";

describe("FiscalModule composition", () => {
  it("imports the shared fiscal provider boundary", () => {
    expect(Reflect.getMetadata("imports", FiscalModule)).toContain(FiscalProviderModule);
  });
});
