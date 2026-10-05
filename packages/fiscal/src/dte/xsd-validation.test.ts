import { describe, expect, it } from "vitest";
import { buildDteXml } from "./dte.builder.js";
import { validFacturaElectronicaRequest, withStructuralSignature } from "./dte.fixture.js";
import {
  defaultDteSchemaDirectory,
  DTE_XSD_ARTIFACTS,
  inspectDteSchemas,
} from "./xsd-artifacts.js";
import { SIFEN_TEST_EMITTER_NAME } from "./dte.types.js";
import { validateDeAgainstOfficialXsd } from "./xsd-validator.js";

/**
 * FISC-008 WU-B — the acceptance criterion is "a DTE XML validates against the
 * official XSD before any submission".
 *
 * The official schemas are copyrighted and are NOT vendored, so this suite is
 * skipped when they are absent — and that skip is explicit and visible in the
 * title below. The dedicated CI job prepares the directory and sets
 * `DTE_XSD_REQUIRED=1`, which turns the absence into a failure instead, so a
 * green run can never be the product of having validated nothing.
 */

const schemaDirectory = defaultDteSchemaDirectory();
const required = process.env.DTE_XSD_REQUIRED === "1";
const inspection = await inspectDteSchemas(schemaDirectory);
const skipped = !inspection.usable && !required;
const skipReason = `[SKIPPED: official schemas absent from ${schemaDirectory}; run pnpm fetch:dte-schemas]`;

describe.skipIf(skipped)(
  `DE XML validates against the official DNIT XSD${skipped ? ` ${skipReason}` : ""}`,
  () => {
    it("has a prepared directory holding all seven official artifacts", () => {
      expect({
        usable: inspection.usable,
        missing: inspection.missing,
        tooSmall: inspection.tooSmall,
        unrewrittenIncludes: inspection.unrewrittenIncludes,
      }).toEqual({ usable: true, missing: [], tooSmall: [], unrewrittenIncludes: false });
      expect(DTE_XSD_ARTIFACTS).toHaveLength(7);
    });

    it("accepts the document the builder emits once the signature is structurally complete", async () => {
      const xml = withStructuralSignature(buildDteXml(validFacturaElectronicaRequest()));
      const result = await validateDeAgainstOfficialXsd(xml, schemaDirectory);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("rejects the unsigned placeholder the builder emits on its own", async () => {
      const xml = buildDteXml(validFacturaElectronicaRequest());
      const result = await validateDeAgainstOfficialXsd(xml, schemaDirectory);

      expect(result.valid).toBe(false);
      // The XSD's ds:Signature is ds:SignatureType, whose SignedInfo is required:
      // an unsigned DE is schema-invalid, which is why [[FISC-009]] exists.
      expect(result.errors.join(" ")).toContain("Signature");
    });

    it("rejects a version other than 150", async () => {
      const xml = withStructuralSignature(
        buildDteXml(validFacturaElectronicaRequest()).replace(
          "<dVerFor>150</dVerFor>",
          "<dVerFor>160</dVerFor>"
        )
      );
      const result = await validateDeAgainstOfficialXsd(xml, schemaDirectory);

      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("dVerFor");
    });

    it("rejects the right children in the wrong order", async () => {
      const ordered = withStructuralSignature(buildDteXml(validFacturaElectronicaRequest()));
      const misplaced = ordered
        .replace("  <dVerFor>150</dVerFor>\n", "")
        .replace("</rDE>", "  <dVerFor>150</dVerFor>\n</rDE>");
      const result = await validateDeAgainstOfficialXsd(misplaced, schemaDirectory);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("accepts a B2C receptor carrying an identity document, which §22.3's old clause forbade", async () => {
      const request = validFacturaElectronicaRequest();
      const xml = withStructuralSignature(
        buildDteXml({
          ...request,
          gDatGralOpe: {
            ...request.gDatGralOpe,
            gDatRec: {
              iNatRec: 2,
              iTiOpe: 4,
              cPaisRec: "PRY",
              dDesPaisRe: "Paraguay",
              iTipIDRec: 6,
              dDTipIDRec: "Tarjeta Diplomática de exoneración fiscal",
              dNumIDRec: "ABC123",
              dNomRec: "Consumidor final",
            },
          },
        })
      );
      const result = await validateDeAgainstOfficialXsd(xml, schemaDirectory);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      // The emitter literal is a §22.5 rule the schema does not encode, so it is
      // asserted here rather than left to the validator.
      expect(xml).toContain(`<dNomEmi>${SIFEN_TEST_EMITTER_NAME}</dNomEmi>`);
    });

    it("refuses an unusable directory instead of reporting a pass", async () => {
      await expect(
        validateDeAgainstOfficialXsd("<rDE/>", "/definitely/not/a/schema/directory")
      ).rejects.toThrow(/not usable/);
    });
  }
);
