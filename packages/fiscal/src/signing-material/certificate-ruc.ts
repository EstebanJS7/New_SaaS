import { X509Certificate } from "node:crypto";

/**
 * FISC-011 WU-G — the RUC inside the signing certificate.
 *
 * Baseline §22.4 pins the obligation — `D101 dRucEm`: _"Debe corresponder al RUC
 * del certificado digital utilizado para firmar el DE"_ — and baseline §6, from
 * the Manual's §7.5 and §7.9, pins **where** the RUC actually lives:
 *
 * ```text
 * legal person    Subject -> SerialNumber, OID 2.5.4.5, format RUCXXXXXXXXX-X
 * natural person  SubjectAlternativeName -> SerialNumber, plus the employing
 *                 entity's name and RUC
 * ```
 *
 * **Why this module refuses instead of returning nothing.** A certificate whose
 * RUC cannot be read in the pinned placement is a *failure*, not an absence: the
 * caller's obligation is "enforced or refused, never silently accepted", and a
 * `null` returned here would become exactly the silent acceptance the obligation
 * forbids. So every unreadable case has its own failure code and a caller that
 * wants to continue has to say so out loud.
 *
 * **Why the natural-person half reads the `serialNumber` ENTRY, not the first
 * RUC-shaped token.** Baseline §6 also requires a natural person's certificate
 * to carry **the employing entity's name and RUC**, so the alternative-name
 * string can hold two RUCs and only one of them is the signer's. Taking the
 * first token wherever it sits would compare a profile against the employer's,
 * which is a silent acceptance (review `R4-001`). The parse therefore selects
 * the `serialNumber` entry and refuses unless there is exactly one.
 *
 * **Why the natural-person half is read from the alternative-name string.** No
 * subject-alternative-name column is stored (`tenant_fiscal_signing_material`
 * carries the subject, not the SAN), so the SAN comes from the certificate
 * itself, and `node:crypto`'s `X509Certificate` exposes it only as its own
 * stringification. The token parse is therefore the same one the subject uses,
 * and a real PSC-issued natural-person container stays a homologation check
 * ([[FISC-013]]): the fixture is self-signed and its subject carries the RUC in
 * the `CN`, which is *not* the pinned placement and is refused here on purpose.
 */

/** The literal the certificate's token starts with, exactly as the baseline writes it. */
export const CERTIFICATE_RUC_LITERAL = "RUC";

/** The subject attribute the legal-person placement uses — OID `2.5.4.5`. */
export const CERTIFICATE_RUC_SUBJECT_ATTRIBUTE = "serialNumber";

/**
 * `RUCXXXXXXXXX-X`: the literal, 3..8 digits, one hyphen and one check
 * character. The width is `tRuc`'s own range from `DE_Types_v150.xsd`, so the
 * two sides of the comparison cannot disagree about it, and the check character
 * accepts `A`-`D` because `tRuc` itself ends `[0-9A-D]?`.
 *
 * The literal and the check character are matched in the certificate's own
 * case: the baseline writes `RUC` and the schema writes `[0-9A-D]`, and being
 * lenient about a protocol constant's spelling is how the constant drifts.
 *
 * The trailing lookahead is what keeps a longer identifier from being read as a
 * shorter valid token: without it, `RUC80012345-6k` would match its first ten
 * characters and a caller would compare against a RUC that is not the one the
 * certificate carries. The token has to END where it ends.
 */
const RUC_TOKEN = /RUC([1-9][0-9]{2,7})-([0-9A-D])(?![0-9A-Za-z-])/;

/**
 * One `TYPE:value` pair of the alternative-name stringification, which is what
 * `X509Certificate.subjectAltName` returns: `DNS:acme.example`,
 * `serialNumber:RUC80012345-6`. The type compares case-insensitively because
 * the runtime's spelling is not a protocol constant.
 */
const SUBJECT_ALT_NAME_ENTRY = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;

/**
 * `serialNumber=` inside a distinguished name. `X509Certificate.subject` is
 * OpenSSL's multi-line form — one `TYPE=value` per line, as the fixture's own
 * `TEST_CERTIFICATE_SUBJECT` records — and a comma-separated form is accepted
 * too, so the parse does not depend on which stringification the runtime picked.
 */
const SUBJECT_SERIAL_NUMBER = /(?:^|[\s,;])serialNumber\s*=\s*([^\s,;]+)/i;

/** Why reading a certificate's RUC failed. Stable and safe to branch on. */
export type CertificateRucFailure =
  | "CERTIFICATE_RUC_MISSING"
  | "CERTIFICATE_RUC_MALFORMED"
  | "CERTIFICATE_RUC_UNREADABLE"
  | "UNSUPPORTED_TAXPAYER_TYPE";

export class CertificateRucError extends Error {
  readonly failure: CertificateRucFailure;

  constructor(failure: CertificateRucFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CertificateRucError";
    this.failure = failure;
  }
}

/** The profile's own two halves: `D101 dRucEm` and `D102 dDVEmi`. */
export interface CertificateRuc {
  readonly ruc: string;
  readonly checkDigit: string;
}

function fail(failure: CertificateRucFailure, message: string, cause?: unknown): never {
  throw new CertificateRucError(failure, message, { cause });
}

/**
 * Parses the pinned token out of a value that is supposed to be one. `null`
 * when the value is not a token **at all** — the caller distinguishes that from
 * "the placement was not there", which is why this returns instead of throwing.
 */
export function parseCertificateRucToken(value: string | null | undefined): CertificateRuc | null {
  if (typeof value !== "string") return null;
  const match = RUC_TOKEN.exec(value);
  if (match === null) return null;
  const [, ruc, checkDigit] = match;
  return { ruc, checkDigit };
}

/**
 * The legal-person placement: the subject's `serialNumber` attribute. A subject
 * with no such attribute is a *missing* RUC — the common shape of a certificate
 * that carries the RUC somewhere the Manual does not allow, such as the `CN`.
 */
export function readRucFromSubject(subject: string): CertificateRuc {
  const attribute = SUBJECT_SERIAL_NUMBER.exec(subject)?.[1];
  if (attribute === undefined) {
    fail(
      "CERTIFICATE_RUC_MISSING",
      `The certificate's subject carries no ${CERTIFICATE_RUC_SUBJECT_ATTRIBUTE} attribute, which is where SIFEN expects the RUC for a legal person (SIFEN-BASELINE.md §6).`
    );
  }
  const parsed = parseCertificateRucToken(attribute);
  if (parsed === null) {
    fail(
      "CERTIFICATE_RUC_MALFORMED",
      `The certificate's ${CERTIFICATE_RUC_SUBJECT_ATTRIBUTE} attribute is not RUCXXXXXXXXX-X.`
    );
  }
  return parsed;
}

/**
 * The natural-person placement: the `serialNumber` entry of the alternative
 * names — the entry, not the first RUC-shaped token, because the same string
 * carries the employing entity's RUC too. Zero `serialNumber` entries means the
 * placement is absent and two means which RUC is the signer's cannot be told
 * from what the certificate stores, so both refuse rather than report a value.
 */
export function readRucFromSubjectAlternativeName(
  subjectAltName: string | undefined
): CertificateRuc {
  if (subjectAltName === undefined || subjectAltName.trim() === "") {
    fail(
      "CERTIFICATE_RUC_UNREADABLE",
      "The certificate carries no subject alternative name, which is where SIFEN expects the RUC for a natural person (SIFEN-BASELINE.md §6)."
    );
  }
  const serials: string[] = [];
  for (const entry of subjectAltName.split(",")) {
    const match = SUBJECT_ALT_NAME_ENTRY.exec(entry);
    if (match === null) continue;
    if (match[1].trim().toLowerCase() !== CERTIFICATE_RUC_SUBJECT_ATTRIBUTE.toLowerCase()) continue;
    serials.push(match[2]);
  }
  if (serials.length !== 1) {
    fail(
      "CERTIFICATE_RUC_UNREADABLE",
      `The certificate's subject alternative name exposes ${String(serials.length)} ${CERTIFICATE_RUC_SUBJECT_ATTRIBUTE} entries; SIFEN's natural-person placement is exactly one and only that one is the signer's RUC.`
    );
  }
  const parsed = parseCertificateRucToken(serials[0]);
  if (parsed === null) {
    fail(
      "CERTIFICATE_RUC_UNREADABLE",
      "The certificate's subject alternative name does not expose a readable RUCXXXXXXXXX-X token."
    );
  }
  return parsed;
}

/**
 * The RUC the certificate carries, in the placement the taxpayer type implies.
 * `taxpayerType` is `D103 iTipCont`: `1` is a natural person and `2` is a legal
 * person, and anything else is refused rather than guessed.
 */
export function readCertificateRuc(args: {
  readonly certificatePem: string;
  readonly certificateSubject: string;
  readonly taxpayerType: number;
}): CertificateRuc {
  if (args.taxpayerType === 2) return readRucFromSubject(args.certificateSubject);
  if (args.taxpayerType !== 1) {
    fail(
      "UNSUPPORTED_TAXPAYER_TYPE",
      `iTipCont ${String(args.taxpayerType)} is neither a natural person (1) nor a legal person (2), so the certificate's RUC placement is unknown.`
    );
  }
  return readRucFromSubjectAlternativeName(readSubjectAlternativeName(args.certificatePem));
}

function readSubjectAlternativeName(certificatePem: string): string | undefined {
  try {
    return new X509Certificate(certificatePem).subjectAltName;
  } catch (cause) {
    // A PEM the runtime cannot parse is not a certificate we can reason about,
    // and it must not read as "this material has no opinion about the RUC".
    fail(
      "CERTIFICATE_RUC_UNREADABLE",
      "The certificate could not be parsed to read its subject alternative name.",
      cause
    );
  }
}

/**
 * The comparison the obligation is about. The number must match exactly — both
 * sides store digits, so a difference is a difference — while the check
 * character compares case-insensitively: the profile is operator input and its
 * column has no case rule, so `a` and `A` are the same check character.
 */
export function certificateRucMatches(
  profile: { readonly ruc: string; readonly checkDigit: string },
  certificate: CertificateRuc
): boolean {
  return (
    profile.ruc === certificate.ruc &&
    profile.checkDigit.toUpperCase() === certificate.checkDigit.toUpperCase()
  );
}
