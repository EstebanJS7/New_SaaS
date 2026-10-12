import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SignedXml } from "xml-crypto";
import { buildEventGroupXml, buildEventXml } from "./dte.event.js";
import { signEventXml } from "./dte.event-signing.js";
import type { DteEventRequest } from "./dte.event.types.js";
import { FIXTURE_CERTIFICATE_PEM, FIXTURE_PRIVATE_KEY_PEM } from "./dte.fixture.js";
import { serializeEventReception } from "../sifen/sifen.serializer.js";
import {
  defaultDteSchemaDirectory,
  DTE_EVENT_XSD_ARTIFACTS,
  DTE_EVENT_XSD_ENTRY_ARTIFACT,
  DTE_XSD_PREPARED_ARTIFACTS,
  inspectDteSchemas,
} from "./xsd-artifacts.js";
import {
  DTE_EVENT_SCHEMA_ENTRY,
  validateDeAgainstOfficialXsd,
  validateEventAgainstOfficialXsd,
} from "./xsd-validator.js";

/**
 * ADR-010 §4: the compiled schema is cached per process, and the key is now the
 * directory **and** the entry artifact, because one directory serves two
 * document families. A key of the directory alone would hand one family the
 * other's compiled schema — so the observable that proves the key is right is
 * that each entry compiles on its own and neither recompiles.
 */
const { parseXmlSpy } = vi.hoisted(() => ({ parseXmlSpy: vi.fn() }));

vi.mock("libxmljs2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("libxmljs2")>();
  parseXmlSpy.mockImplementation((...args: Parameters<typeof actual.parseXml>) =>
    actual.parseXml(...args)
  );
  return { ...actual, parseXml: parseXmlSpy };
});

/** The event entry's compile is the parse whose source includes the event entry artifact. */
function eventSchemaCompiles(): number {
  return parseXmlSpy.mock.calls.filter(([source]) =>
    String(source).includes(DTE_EVENT_XSD_ENTRY_ARTIFACT)
  ).length;
}

/** The DE entry's compile is the parse whose source declares `rDE`. */
function deSchemaCompiles(): number {
  return parseXmlSpy.mock.calls.filter(([source]) => String(source).includes('name="rDE"')).length;
}

const CDC = `12${"1234567A"}${"0".repeat(34)}`;
const REASON = "Servicio no prestado";
const ISSUED_AT = "2026-10-11T09:35:17";
const LOT_ID = "123456789012345";

const schemaDirectory = defaultDteSchemaDirectory();
const required = process.env.DTE_XSD_REQUIRED === "1";
const inspection = await inspectDteSchemas(schemaDirectory);
const skipped = !inspection.usable && !required;
const skipReason = `[SKIPPED: official schemas absent from ${schemaDirectory}; run pnpm fetch:dte-schemas]`;

/**
 * FISC-016 WU-B — the acceptance criterion is "a built-and-signed event
 * validates against the official XSD before any submission".
 *
 * The official schemas are copyrighted and are NOT vendored, so this suite is
 * skipped when they are absent — and that skip is explicit and visible in the
 * title below. The dedicated CI job prepares the directory and sets
 * `DTE_XSD_REQUIRED=1`, which turns the absence into a failure instead, so a
 * green run can never be the product of having validated nothing. The discipline
 * is `xsd-validation.test.ts`'s exactly.
 */

function lot(overrides: Partial<DteEventRequest> = {}): DteEventRequest {
  return {
    dId: LOT_ID,
    events: [
      {
        id: "1",
        dFecFirma: ISSUED_AT,
        payload: { kind: "cancellation", cdc: CDC, reason: REASON },
      },
    ],
    ...overrides,
  };
}

function signedLot(request: DteEventRequest = lot()): string {
  return signEventXml({
    xml: buildEventXml(request),
    privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
    certificatePem: FIXTURE_CERTIFICATE_PEM,
  });
}

/** The event group alone, built and really signed — the hand-off surface. */
function signedGroup(request: DteEventRequest = lot()): string {
  return signEventXml({
    xml: buildEventGroupXml(request.events),
    privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
    certificatePem: FIXTURE_CERTIFICATE_PEM,
  });
}

/**
 * The signature element's own bytes, for a verifier that must be handed them.
 *
 * `xml-crypto` v6 requires the signature to be loaded explicitly rather than
 * discovered from the document, so this is the extraction the round trip needs
 * and nothing more: the first `Signature` element, which the schema allows
 * exactly one of.
 */
function signatureOf(xml: string): string {
  const match = /<Signature[\s\S]*?<\/Signature>/.exec(xml);
  if (match === null) {
    throw new Error("The document carries no signature.");
  }
  return match[0];
}

/**
 * The SIFEN payload inside the SOAP message `serializeEventReception` emits.
 *
 * The official schema validates the message's payload — `rEnviEventoDe`, the
 * element `WS_SiRecepEvento_v150.xsd` declares — and the SOAP envelope is the
 * transport's, declared by no retrieved artifact. The slice uses the
 * serializer's own delimiter strings, so what is validated is exactly the
 * envelope the fix produced.
 */
function sifenBodyOf(soapMessage: string): string {
  const open = "<soap:Body>";
  const close = "</soap:Body>";
  const start = soapMessage.indexOf(open);
  const end = soapMessage.lastIndexOf(close);
  if (start === -1 || end < start) {
    throw new Error("The serializer did not emit a SOAP body.");
  }
  return soapMessage.slice(start + open.length, end);
}

describe.skipIf(skipped)(
  `event XML validates against the official DNIT XSD${skipped ? ` ${skipReason}` : ""}`,
  () => {
    it("has a prepared directory holding the union, event entry included", () => {
      expect({
        usable: inspection.usable,
        missing: inspection.missing,
        tooSmall: inspection.tooSmall,
        unrewrittenIncludes: inspection.unrewrittenIncludes,
      }).toEqual({ usable: true, missing: [], tooSmall: [], unrewrittenIncludes: [] });
      expect(DTE_EVENT_XSD_ARTIFACTS).toHaveLength(4);
      expect(DTE_XSD_PREPARED_ARTIFACTS).toHaveLength(11);
      expect(inspection.missing).not.toContain(DTE_EVENT_XSD_ENTRY_ARTIFACT);
    });

    it("accepts the WHOLE SUBMITTED ENVELOPE the serializer builds around a signed event group", async () => {
      // WU-C's acceptance criterion: the serializer's `dEvReg` carries the
      // `gGroupGesEve` wrapper §25.1 requires, the caller's signed group is
      // embedded verbatim, and the envelope that is actually posted validates.
      const group = signedGroup();
      const submitted = serializeEventReception({ dId: LOT_ID, eventGroupXml: group });

      expect(submitted).toContain(`<dEvReg>${group}</dEvReg>`);

      const result = await validateEventAgainstOfficialXsd(sifenBodyOf(submitted), schemaDirectory);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("still VERIFIES the signature once the serializer embeds the signed group", () => {
      // The refuter's finding, and the reason the group declares the namespace
      // itself: the signature covers the canonical form of `rEve`, the group is
      // signed standalone and then embedded under an envelope that declares the
      // same default namespace, and a namespace-less group would be signed in
      // one namespace and verified in another. Schema validity is not signature
      // validity -- the case above passed either way, which is exactly how a
      // namespace-induced mismatch would have shipped silently.
      const group = signedGroup();
      const body = sifenBodyOf(serializeEventReception({ dId: LOT_ID, eventGroupXml: group }));

      const embedded = new SignedXml({ publicCert: FIXTURE_CERTIFICATE_PEM });
      embedded.loadSignature(signatureOf(body));
      expect(embedded.checkSignature(body)).toBe(true);

      // And the same bytes still verify standalone, so the two contexts agree
      // rather than each being self-consistent.
      const standalone = new SignedXml({ publicCert: FIXTURE_CERTIFICATE_PEM });
      standalone.loadSignature(signatureOf(group));
      expect(standalone.checkSignature(group)).toBe(true);
    });

    it("accepts a built and REALLY SIGNED cancellation event", async () => {
      const result = await validateEventAgainstOfficialXsd(signedLot(), schemaDirectory);

      // §25.4: `rGesEve` is `{ rEve, ds:Signature }` with the signature
      // REQUIRED. This is the acceptance criterion: not "it produced a
      // signature", but "the signature it produced is the one the schema allows,
      // in the position the schema allows".
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("accepts a built and REALLY SIGNED inutilización, and a lot of both", async () => {
      const inutilizacion = lot({
        events: [
          {
            id: "1",
            dFecFirma: ISSUED_AT,
            payload: {
              kind: "inutilizacion",
              dNumTim: "12345678",
              dEst: "001",
              dPunExp: "002",
              dNumIn: "0000001",
              dNumFin: "0000010",
              iTiDE: 1,
              reason: REASON,
              dSerieNum: "AB",
            },
          },
        ],
      });
      const both = lot({
        events: [
          {
            id: "1",
            dFecFirma: ISSUED_AT,
            payload: { kind: "cancellation", cdc: CDC, reason: REASON },
          },
          {
            id: "2",
            dFecFirma: ISSUED_AT,
            payload: {
              kind: "inutilizacion",
              dNumTim: "12345678",
              dEst: "001",
              dPunExp: "002",
              dNumIn: "0000001",
              dNumFin: "0000010",
              iTiDE: 9,
              reason: REASON,
            },
          },
        ],
      });

      const single = await validateEventAgainstOfficialXsd(
        signedLot(inutilizacion),
        schemaDirectory
      );
      const mixed = await validateEventAgainstOfficialXsd(signedLot(both), schemaDirectory);

      expect(single.errors).toEqual([]);
      expect(single.valid).toBe(true);
      expect(mixed.errors).toEqual([]);
      expect(mixed.valid).toBe(true);
    });

    it("accepts the schema's maximum of fifteen events, each signed", async () => {
      const full = lot({
        events: Array.from({ length: 15 }, (_unused, index) => ({
          id: String(index + 1),
          dFecFirma: ISSUED_AT,
          payload: { kind: "cancellation" as const, cdc: CDC, reason: REASON },
        })),
      });
      const result = await validateEventAgainstOfficialXsd(signedLot(full), schemaDirectory);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("rejects the unsigned placeholder the builder emits on its own", async () => {
      const result = await validateEventAgainstOfficialXsd(buildEventXml(lot()), schemaDirectory);

      expect(result.valid).toBe(false);
      // The XSD's ds:Signature is ds:SignatureType, whose SignedInfo is
      // required: an unsigned event is schema-invalid, which is why the event
      // signer exists — and why the placeholder is a marker, not a signature.
      expect(result.errors.join(" ")).toContain("Signature");
    });

    it("rejects a version other than the profile's 150", async () => {
      const result = await validateEventAgainstOfficialXsd(
        signedLot().replace("<dVerFor>150</dVerFor>", "<dVerFor>160</dVerFor>"),
        schemaDirectory
      );

      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("dVerFor");
    });

    it("rejects a cancellation with no CDC, which the payload requires", async () => {
      const result = await validateEventAgainstOfficialXsd(
        signedLot().replace(`<Id>${CDC}</Id>`, ""),
        schemaDirectory
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(" ")).toContain("Id");
    });

    it("rejects the event's children in the wrong order", async () => {
      const signed = signedLot();
      const misplaced = signed
        .replace(`<dFecFirma>${ISSUED_AT}</dFecFirma>\n`, "")
        .replace("</rEve>", `<dFecFirma>${ISSUED_AT}</dFecFirma>\n</rEve>`);
      const result = await validateEventAgainstOfficialXsd(misplaced, schemaDirectory);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("compiles the event entry once per process, keyed by directory AND entry", async () => {
      const directory = await mkdtemp(join(tmpdir(), "newsaas-dte-event-cache-"));
      await cp(schemaDirectory, directory, { recursive: true });
      const xml = signedLot();

      // The DE entry is the other family's: compiled here only to prove the key
      // separates them.
      const deRequest =
        '<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd"><dVerFor>150</dVerFor></rDE>';

      parseXmlSpy.mockClear();
      await validateEventAgainstOfficialXsd(xml, directory);
      const afterEventCompile = eventSchemaCompiles();
      await validateDeAgainstOfficialXsd(deRequest, directory);
      const afterDeCompile = eventSchemaCompiles();
      const deCompiles = deSchemaCompiles();
      await validateEventAgainstOfficialXsd(xml, directory);
      const afterSecondEvent = eventSchemaCompiles();

      // One compile per (directory, entry): the event entry compiled once, the
      // DE entry once, and neither was replaced by the other's schema.
      expect(afterEventCompile).toBe(1);
      expect(afterDeCompile).toBe(1);
      expect(deCompiles).toBe(1);
      // The second event submission reused the event entry's compile.
      expect(afterSecondEvent).toBe(1);
      // Two schema compiles plus three document parses.
      expect(parseXmlSpy.mock.calls.length).toBe(5);
    });

    it("refuses an unusable directory instead of reporting a pass", async () => {
      const directory = "/definitely/not/a/schema/directory";
      const failure = validateEventAgainstOfficialXsd("<rEnviEventoDe/>", directory);

      await expect(failure).rejects.toMatchObject({ failure: "DIRECTORY_UNUSABLE" });
      await expect(failure).rejects.toThrow(directory);
    });

    it("never caches a failed event compile as a usable schema", async () => {
      const directory = await mkdtemp(join(tmpdir(), "newsaas-dte-event-broken-"));
      await cp(schemaDirectory, directory, { recursive: true });
      // Large enough and URL-free enough to pass the directory inspection, so
      // the failure is the compile and nothing earlier.
      const corrupted = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">${" ".repeat(
        1_500
      )}`;
      await writeFile(join(directory, DTE_EVENT_SCHEMA_ENTRY.entryArtifact), corrupted, "utf8");

      await expect(validateEventAgainstOfficialXsd(signedLot(), directory)).rejects.toMatchObject({
        failure: "SCHEMA_UNUSABLE",
      });

      await cp(
        join(schemaDirectory, DTE_EVENT_XSD_ENTRY_ARTIFACT),
        join(directory, DTE_EVENT_XSD_ENTRY_ARTIFACT)
      );
      const result = await validateEventAgainstOfficialXsd(signedLot(), directory);

      // If the failed compile had been cached, this second call would still have
      // refused. It compiles again and accepts.
      expect(result.valid).toBe(true);
    });
  }
);
