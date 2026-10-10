/**
 * FISC-012 WU-C — the QR: its composition, its placeholder, and the one fill
 * that replaces the placeholder once the signature's digest exists.
 *
 * Source of record: `docs/06-fiscal/SIFEN-BASELINE.md` **§24**, which reads the
 * Manual's §13.8.2 (what the QR carries), §13.8.3 (the hexadecimal conversion
 * and the SHA-256) and §13.8.4 (the five steps and a worked example). Where the
 * Manual contradicts itself, §24.4's three defects record which reading wins —
 * no `www.`, `nVersion=150`, `dTotGralOpe` rather than `dTotOpe` — and this
 * module follows those readings.
 *
 * Three facts shape every function here:
 *
 * 1. **The QR is built AFTER the signature** (§24.5). Its `Id` is the CDC and
 *    its `DigestValue` is the signature's digest; neither exists before
 *    `signDteXml` runs. `dCarQR` lives in `gCamFuFD`, outside the signed `DE`
 *    subtree (baseline §4), which is why the fill below cannot invalidate the
 *    signature.
 * 2. **The CSC is secret and is hashed, never sent** (§24.2, §13.8.4.2-3):
 *    `buildQrContent` appends it to the hashed string only, and the returned URL
 *    never carries it.
 * 3. **Steps 4 and 5 produce different strings** (§24.3): `buildQrContent`
 *    returns the URL unescaped, and `fillQrContent` is what turns every `&` into
 *    `&amp;` before the value enters `<dCarQR>`.
 *
 * Pure: no I/O, no ambient clock, no randomness. The CSC, the digest and the
 * timestamp are inputs, and `node:crypto` supplies the hash.
 */

import { createHash } from "node:crypto";
import { DTE_XML_VERSION } from "./dte.types.js";

/**
 * §24.3 quotes §13.8.2's two consultation addresses, and §24.4's **first**
 * defect records that §13.8.4.4's "Donde" writes them with `www.` while
 * §13.8.2 and the worked example both write them **without** it: the example
 * wins, so neither value below carries `www.`.
 *
 * Keyed by `DocumentIdentity.environment`'s vocabulary (`"test" |
 * "production"`), which is the vocabulary the QR's host follows.
 */
export const QR_CONSULTATION_URLS = Object.freeze({
  production: "https://ekuatia.set.gov.py/consultas/qr?",
  test: "https://ekuatia.set.gov.py/consultas-test/qr?",
} as const);

/**
 * The XSD's own `dCarQR` facets: its `simpleType` restricts `noEmptyString` with
 * `minLength=100` and `maxLength=600` (§24.6.3; baseline §21.6 records the same
 * pair). `dte.rules.ts` enforces it on the builder's `dCarQR`, and this module
 * enforces it on the fill's replacement, so neither path can emit a document
 * the schema refuses on length.
 */
export const QR_CONTENT_MIN_LENGTH = 100;
export const QR_CONTENT_MAX_LENGTH = 600;

export type DteQrFailure =
  "MISSING_PLACEHOLDER" | "MULTIPLE_PLACEHOLDERS" | "QR_CONTENT_OUT_OF_RANGE";

export class DteQrError extends Error {
  readonly failure: DteQrFailure;

  constructor(failure: DteQrFailure, message: string) {
    super(message);
    this.name = "DteQrError";
    this.failure = failure;
  }
}

export interface BuildQrContentArgs {
  /** `DocumentIdentity`'s vocabulary; selects the §24.3 consultation address. */
  readonly environment: "test" | "production";
  /** `A002`: the DE's CDC, which is also the signature's reference. */
  readonly cdc: string;
  /** `D002`, as it is emitted: `AAAA-MM-DDThh:mm:ss`. */
  readonly dFeEmiDE: string;
  /** `D206`/`D210`. */
  readonly dRucRec: string;
  /** `F014`, or null — a null becomes "0" (§13.8.2's own footnote). */
  readonly dTotGralOpe: string | null;
  /** `F017`, or null — a null becomes "0" (§13.8.2's own footnote). */
  readonly dTotIVA: string | null;
  /** The number of `E701` occurrences (§13.8.2: "cuenta E701"). */
  readonly cItems: number;
  /** `XS17`: the signature's `DigestValue`, base64 as the signature carries it. */
  readonly digestValue: string;
  /** The CSC's identifier, `IdCSC` (§13.8.2). */
  readonly idCsc: string;
  /** The CSC itself (§24.2). **Secret**: hashed, and never in the URL. */
  readonly csc: string;
}

/**
 * §13.8.4's steps 1–4: the consultation URL for `gCamFuFD dCarQR`, **unescaped**.
 *
 * ```text
 * step 1  concatenate, in this order and with no spaces:
 *           nVersion=<DTE_XML_VERSION>&Id=<cdc>&dFeEmiDE=<hex>&dRucRec=<dRucRec>
 *           &dTotGralOpe=<n>&dTotIVA=<n>&cItems=<n>&DigestValue=<hex>&IdCSC=<id>
 * step 2  append the CSC to the end of step 1's string
 * step 3  SHA-256 over step 2's bytes, hexadecimal, lowercase
 * step 4  URL = <consultation URL> + step 1 + "&cHashQR=" + step 3
 * ```
 *
 * Step 5 — escaping every `&` as `&amp;` — is **not** here: the URL is the value
 * the QR encodes, and the escaping belongs to the XML text written by
 * {@link fillQrContent} (§24.3).
 */
export function buildQrContent(args: BuildQrContentArgs): string {
  const parameters = [
    // §13.8.2's AA002 is the document's version. §24.4's second defect records
    // that the example's own URL says 150 while its "Datos del Paso 1" says
    // 142; the version the DTE carries is what wins, imported rather than
    // restated so a version drift cannot leave the QR behind.
    `nVersion=${DTE_XML_VERSION}`,
    // `A002`, §24.3: the same CDC the signature references.
    `Id=${args.cdc}`,
    // §13.8.3: "su equivalente hexadecimal" is the hex of the string's UTF-8
    // bytes, which the example's own `2017-01-25T09:35:17` proves.
    `dFeEmiDE=${hexOfUtf8(args.dFeEmiDE)}`,
    // §24.3: `dRucRec`/`dNumIDRec`, `D206`/`D210`.
    `dRucRec=${args.dRucRec}`,
    // §13.8.2's footnote: "En caso de que estos campos no contengan valor
    // completar con un 0".
    `dTotGralOpe=${args.dTotGralOpe ?? "0"}`,
    `dTotIVA=${args.dTotIVA ?? "0"}`,
    // §24.3: the count of `E701`, not a schema field.
    `cItems=${String(args.cItems)}`,
    // §24.3: `XS17`, the signature's digest, in the same hexadecimal form.
    `DigestValue=${hexOfUtf8(args.digestValue)}`,
    // §24.3: the CSC's identifier, which names which of up to two active CSC
    // values was used (§24.2).
    `IdCSC=${args.idCsc}`,
  ].join("&");

  // Steps 2 and 3: the CSC is appended to the hashed string and never enters
  // the URL (§13.8.3, §13.8.4.2-3).
  const cHashQr = createHash("sha256").update(`${parameters}${args.csc}`, "utf8").digest("hex");

  return `${QR_CONSULTATION_URLS[args.environment]}${parameters}&cHashQR=${cHashQr}`;
}

/** §13.8.3: the hexadecimal of the string's UTF-8 bytes — an encoding, not a decode. */
function hexOfUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/**
 * The sentinel the caller passes as `gCamFuFD dCarQR` before the document is
 * signed, and which {@link fillQrContent} replaces once the digest exists.
 *
 * §24.5 pins the build order `buildDteXml -> signDteXml -> buildQrContent ->
 * fill the QR placeholder`, and the builder emits `dCarQR` verbatim, so the
 * unsigned document carries this value. Its length matters: `buildDteXml` runs
 * the XSD's own 100..600 rule over `dCarQR` (`dte.rules.ts`), and a placeholder
 * outside that range would make the unsigned document unbuildable. It is exactly
 * the minimum, it contains no `&`, `<` or `>`, and `escapeXmlText` therefore
 * passes it through byte for byte.
 */
export const QR_PLACEHOLDER = "QR-PLACEHOLDER-FISC-012-AWAITING-SIGNATURE".padEnd(
  QR_CONTENT_MIN_LENGTH,
  "0"
);

export interface FillQrContentArgs {
  /** The document `signDteXml` produced, still carrying {@link QR_PLACEHOLDER}. */
  readonly signedXml: string;
  /** The URL {@link buildQrContent} returned, unescaped. */
  readonly qrContent: string;
}

/**
 * §13.8.4's step 5: replaces the placeholder with the QR content as **XML
 * text**, so every `&` becomes `&amp;` (and the other XML-special characters are
 * escaped too).
 *
 * Exactly one occurrence is replaced. A document with no placeholder was not
 * built for the QR, and a document with two cannot say which one was intended —
 * replacing "the first" of a duplicated value is how a document gets a QR
 * nobody validated, so both are typed refusals.
 *
 * The length rule is checked on the **unescaped** content: the XSD's facets
 * apply to the element's text after entity expansion, which is this value, and
 * it is also the value `dte.rules.ts` measures on the builder's path.
 */
export function fillQrContent(args: FillQrContentArgs): string {
  const length = args.qrContent.length;
  if (length < QR_CONTENT_MIN_LENGTH || length > QR_CONTENT_MAX_LENGTH) {
    throw new DteQrError(
      "QR_CONTENT_OUT_OF_RANGE",
      `gCamFuFD dCarQR must be ${String(QR_CONTENT_MIN_LENGTH)} to ` +
        `${String(QR_CONTENT_MAX_LENGTH)} characters, got ${String(length)}.`
    );
  }

  const first = args.signedXml.indexOf(QR_PLACEHOLDER);
  if (first === -1) {
    throw new DteQrError(
      "MISSING_PLACEHOLDER",
      "The document carries no QR placeholder; it was not built with QR_PLACEHOLDER, " +
        "or its QR was already filled."
    );
  }
  const second = args.signedXml.indexOf(QR_PLACEHOLDER, first + QR_PLACEHOLDER.length);
  if (second !== -1) {
    throw new DteQrError(
      "MULTIPLE_PLACEHOLDERS",
      "The document carries the QR placeholder more than once; exactly one occurrence " +
        "is replaceable."
    );
  }

  const escaped = escapeXmlText(args.qrContent);
  return (
    args.signedXml.slice(0, first) + escaped + args.signedXml.slice(first + QR_PLACEHOLDER.length)
  );
}

/** §24.3's Paso 5, and the same escaping `buildDteXml` applies to text values. */
function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
