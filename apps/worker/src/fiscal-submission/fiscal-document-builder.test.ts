import { describe, expect, it } from "vitest";
import {
  createUnavailableFiscalDocumentBuilder,
  FISCAL_DOCUMENT_BUILDER,
} from "./fiscal-document-builder.js";

describe("createUnavailableFiscalDocumentBuilder", () => {
  it("is keyed by a symbol token a composition root can provide", () => {
    expect(typeof FISCAL_DOCUMENT_BUILDER).toBe("symbol");
  });

  it("answers UNAVAILABLE with a named reason instead of throwing", async () => {
    const result = await createUnavailableFiscalDocumentBuilder().build({
      tenantId: "tenant-1",
      fiscalDocumentId: "document-1",
    });

    expect(result.outcome).toBe("UNAVAILABLE");
    if (result.outcome !== "UNAVAILABLE") {
      throw new Error("the unavailable builder must answer UNAVAILABLE");
    }
    expect(result.reasonCode).toBe("DOCUMENT_ASSEMBLY_UNAVAILABLE");
    expect(result.reason).toContain("FISC-015");
  });

  it("never returns a partial document and never carries document bytes", async () => {
    const result = await createUnavailableFiscalDocumentBuilder().build({
      tenantId: "tenant-1",
      fiscalDocumentId: "document-1",
    });

    expect(result).not.toHaveProperty("document");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(serialized).not.toMatch(/xml|signature|certificate|private.?key|cdc/i);
  });
});
