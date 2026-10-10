import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildDteXml } from "./dte.builder.js";
import { buildDteRequestFromInvoice } from "./dte.mapper.js";
import {
  FIXTURE_CDC,
  FIXTURE_CERTIFICATE_PEM,
  FIXTURE_PRIVATE_KEY_PEM,
  validFacturaElectronicaRequest,
  withStructuralSignature,
} from "./dte.fixture.js";
import { signDteXml } from "./dte.signing.js";
import {
  defaultDteSchemaDirectory,
  DTE_XSD_ARTIFACTS,
  DTE_XSD_ENTRY_ARTIFACT,
  inspectDteSchemas,
} from "./xsd-artifacts.js";
import { SIFEN_TEST_EMITTER_NAME } from "./dte.types.js";
import { validateDeAgainstOfficialXsd } from "./xsd-validator.js";

/**
 * ADR-010 §4: the compiled schema is cached per process, keyed by directory,
 * and a failed compile is never cached as a success. Both properties are
 * internal to the validator, so the observable that proves them is the number
 * of times the schema itself is parsed: a wrapper around the real `parseXml`
 * counts the compiles without changing what compilation does.
 */
const { parseXmlSpy } = vi.hoisted(() => ({ parseXmlSpy: vi.fn() }));

vi.mock("libxmljs2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("libxmljs2")>();
  parseXmlSpy.mockImplementation((...args: Parameters<typeof actual.parseXml>) =>
    actual.parseXml(...args)
  );
  return { ...actual, parseXml: parseXmlSpy };
});

/** The compile is the parse whose source is the generated entry schema. */
function schemaCompiles(): number {
  return parseXmlSpy.mock.calls.filter(([source]) => String(source).includes('name="rDE"')).length;
}

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
      }).toEqual({ usable: true, missing: [], tooSmall: [], unrewrittenIncludes: [] });
      expect(DTE_XSD_ARTIFACTS).toHaveLength(7);
    });

    it("accepts the document the builder emits once the signature is structurally complete", async () => {
      const xml = withStructuralSignature(buildDteXml(validFacturaElectronicaRequest()));
      const result = await validateDeAgainstOfficialXsd(xml, schemaDirectory);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("accepts the document once it carries a REAL signature", async () => {
      const xml = signDteXml({
        xml: buildDteXml(validFacturaElectronicaRequest()),
        privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
        certificatePem: FIXTURE_CERTIFICATE_PEM,
        cdc: FIXTURE_CDC,
      });
      const result = await validateDeAgainstOfficialXsd(xml, schemaDirectory);

      // This is the acceptance criterion of [[FISC-009]]: not "it produced a
      // signature", but "the signature it produced is the one the schema
      // allows, in the position the schema allows". The structural fixture above
      // passes the same gate, which is exactly why this case exists separately:
      // structure is not a signature.
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

    it("accepts a document the MAPPER built, not just the fixture", async () => {
      // The mapping's own tests assert shape, and shape is not validity: an
      // earlier version of `totalsElement` emitted six of `tgTotSub`'s ten
      // required members, in the wrong order, and every builder test passed.
      // This case is what makes that class of gap visible.
      const { request } = buildDteRequestFromInvoice({
        invoice: {
          issuedAt: "2026-10-06T10:00:00",
          currency: "PYG",
          currencyDescription: "Guaraní",
          lines: [
            {
              itemCode: "SKU001",
              description: "Servicio de prueba",
              unitOfMeasureCode: "77",
              unitOfMeasureDescription: "UNI",
              quantity: "1",
              unitPrice: "100",
              lineTotal: "110",
              taxableBase: "100",
              taxAmount: "10",
              affectation: 1,
              ivaRate: 10,
            },
          ],
          receptor: validFacturaElectronicaRequest().gDatGralOpe.gDatRec,
        },
        profile: {
          emitter: validFacturaElectronicaRequest().gDatGralOpe.gEmis,
          timbrado: validFacturaElectronicaRequest().gTimb,
          operation: { iTImp: 1, dDesTImp: "IVA", iTipTra: 1, dDesTipTra: "Venta de mercadería" },
          emissionType: { code: 1, description: "Normal" },
        },
        identity: {
          cdc: validFacturaElectronicaRequest().cdc,
          dDVId: validFacturaElectronicaRequest().dDVId,
          securityCode: "123456789",
          environment: "test",
        },
        signatureTimestamp: "2026-10-06T10:00:05",
        qrContent: validFacturaElectronicaRequest().gCamFuFD.dCarQR,
      });
      const result = await validateDeAgainstOfficialXsd(
        withStructuralSignature(buildDteXml(request)),
        schemaDirectory
      );

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("refuses an unusable directory instead of reporting a pass", async () => {
      const directory = "/definitely/not/a/schema/directory";
      const failure = validateDeAgainstOfficialXsd("<rDE/>", directory);

      await expect(failure).rejects.toMatchObject({ failure: "DIRECTORY_UNUSABLE" });
      // ADR-010 §3: the fail-closed reason names the directory, which is not
      // secret and is the first thing an operator needs.
      await expect(failure).rejects.toThrow(directory);
    });

    it("compiles the official schema once per process, keyed by the directory", async () => {
      const directory = await mkdtemp(join(tmpdir(), "newsaas-dte-cache-"));
      await cp(schemaDirectory, directory, { recursive: true });
      const xml = withStructuralSignature(buildDteXml(validFacturaElectronicaRequest()));

      parseXmlSpy.mockClear();
      const first = await validateDeAgainstOfficialXsd(xml, directory);
      const afterFirst = schemaCompiles();
      const second = await validateDeAgainstOfficialXsd(xml, directory);
      const afterSecond = schemaCompiles();

      expect(first.valid).toBe(true);
      expect(second.valid).toBe(true);
      expect(afterFirst).toBe(1);
      // The second submission validated against the cached compile: one compile
      // for two submissions, and the document itself was parsed both times.
      expect(afterSecond).toBe(1);
      // One schema compile plus one document parse per submission.
      expect(parseXmlSpy.mock.calls.length).toBe(3);
    });

    it("never caches a failed compile as a usable schema", async () => {
      const directory = await mkdtemp(join(tmpdir(), "newsaas-dte-broken-"));
      await cp(schemaDirectory, directory, { recursive: true });
      // Large enough and URL-free enough to pass the directory inspection, so
      // the failure is the compile and nothing earlier.
      const corrupted = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">${" ".repeat(
        32_000
      )}`;
      await writeFile(join(directory, DTE_XSD_ENTRY_ARTIFACT), corrupted, "utf8");

      await expect(
        validateDeAgainstOfficialXsd(
          withStructuralSignature(buildDteXml(validFacturaElectronicaRequest())),
          directory
        )
      ).rejects.toMatchObject({ failure: "SCHEMA_UNUSABLE" });

      await cp(
        join(schemaDirectory, DTE_XSD_ENTRY_ARTIFACT),
        join(directory, DTE_XSD_ENTRY_ARTIFACT)
      );
      const result = await validateDeAgainstOfficialXsd(
        withStructuralSignature(buildDteXml(validFacturaElectronicaRequest())),
        directory
      );

      // If the failed compile had been cached, this second call would still
      // have refused. It compiles again and accepts.
      expect(result.valid).toBe(true);
    });
  }
);
