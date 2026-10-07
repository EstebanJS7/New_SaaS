import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TEST_CERTIFICATE_SUBJECT, testCertificateDer } from "./pkcs12.fixture.js";
import {
  CertificateRucError,
  type CertificateRucFailure,
  certificateRucMatches,
  parseCertificateRucToken,
  readCertificateRuc,
  readRucFromSubject,
  readRucFromSubjectAlternativeName,
} from "./certificate-ruc.js";

/** The fixture's own PEM, which is what a stored material hands the reader. */
const FIXTURE_PEM = new X509Certificate(Buffer.from(testCertificateDer())).toString();
const FIXTURE_SUBJECT = new X509Certificate(Buffer.from(testCertificateDer())).subject;

/** The failure code a call raises, which is the part a caller branches on. */
function failureOf(run: () => unknown): CertificateRucFailure {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CertificateRucError);
    return (error as CertificateRucError).failure;
  }
  throw new Error("Expected the call to fail.");
}

describe("the pinned token", () => {
  it("parses the literal, the number and the check character", () => {
    expect(parseCertificateRucToken("RUC80012345-6")).toEqual({ ruc: "80012345", checkDigit: "6" });
    // `tRuc` itself ends `[0-9A-D]?`, so a letter check character is a real case.
    expect(parseCertificateRucToken("RUC123456-A")).toEqual({ ruc: "123456", checkDigit: "A" });
  });

  it("finds the token inside a longer value, which is what the SAN string is", () => {
    expect(parseCertificateRucToken("serialNumber:RUC80012345-6")).toEqual({
      ruc: "80012345",
      checkDigit: "6",
    });
  });

  it("refuses everything that is not the pinned shape", () => {
    // The literal is matched as the baseline writes it: a lenient spelling of a
    // protocol constant is how the constant drifts.
    expect(parseCertificateRucToken("ruc80012345-6")).toBeNull();
    expect(parseCertificateRucToken("NIT80012345-6")).toBeNull();
    // No check character, no hyphen, a leading zero and a lowercase DV are all
    // outside `tdRuc`/`tDVer` as the schema writes them.
    expect(parseCertificateRucToken("RUC80012345")).toBeNull();
    expect(parseCertificateRucToken("RUC800123456")).toBeNull();
    expect(parseCertificateRucToken("RUC08001234-6")).toBeNull();
    // The token must end where it ends: a suffix would otherwise be read as a
    // shorter, valid-looking RUC.
    expect(parseCertificateRucToken("RUC80012345-6k")).toBeNull();
    expect(parseCertificateRucToken("RUC80012345-6-7")).toBeNull();
    expect(parseCertificateRucToken(undefined)).toBeNull();
  });
});

describe("the legal-person placement", () => {
  it("reads the subject's serialNumber attribute, however the DN is laid out", () => {
    expect(readRucFromSubject("C=PY\nO=Acme S.A.\nserialNumber=RUC80012345-6")).toEqual({
      ruc: "80012345",
      checkDigit: "6",
    });
    expect(readRucFromSubject("C=PY,O=Acme S.A.,serialNumber=RUC80012345-6")).toEqual({
      ruc: "80012345",
      checkDigit: "6",
    });
  });

  it("refuses a subject whose RUC is somewhere the Manual does not allow", () => {
    // The test fixture puts it in the CN, which is exactly the shape a
    // non-conformant certificate has, and the pinned placement is the only one
    // SIFEN accepts.
    expect(failureOf(() => readRucFromSubject(TEST_CERTIFICATE_SUBJECT))).toBe(
      "CERTIFICATE_RUC_MISSING"
    );
    expect(failureOf(() => readRucFromSubject("C=PY\nO=Acme S.A."))).toBe(
      "CERTIFICATE_RUC_MISSING"
    );
  });

  it("refuses a serialNumber that is not the pinned token", () => {
    expect(failureOf(() => readRucFromSubject("C=PY\nserialNumber=80012345-6"))).toBe(
      "CERTIFICATE_RUC_MALFORMED"
    );
    expect(failureOf(() => readRucFromSubject("C=PY\nserialNumber=RUC12345678"))).toBe(
      "CERTIFICATE_RUC_MALFORMED"
    );
  });
});

describe("the natural-person placement", () => {
  it("reads the signer's RUC, not the employing entity's", () => {
    // Baseline §6 requires the employing entity's name AND RUC in the same
    // string, so a RUC-shaped token can precede the signer's own entry.
    // Selecting the `serialNumber` entry is what makes the comparison about the
    // signer (review `R4-001`); reading the first token would compare against
    // the employer's and silently accept a mismatch.
    expect(
      readRucFromSubjectAlternativeName(
        "othername:RUC80099999-7, serialNumber:RUC80012345-6, DNS:acme.example"
      )
    ).toEqual({ ruc: "80012345", checkDigit: "6" });
  });

  it("refuses when the placement is absent or ambiguous", () => {
    // The employer's RUC alone: nothing says it is the signer's.
    expect(failureOf(() => readRucFromSubjectAlternativeName("othername:RUC80099999-7"))).toBe(
      "CERTIFICATE_RUC_UNREADABLE"
    );
    // Two placements: which one is the signer's cannot be told.
    expect(
      failureOf(() =>
        readRucFromSubjectAlternativeName("serialNumber:RUC80099999-7, serialNumber:RUC80012345-6")
      )
    ).toBe("CERTIFICATE_RUC_UNREADABLE");
  });

  it("records that the fixture itself carries no alternative name", () => {
    // Which is why the natural-person success case above is a synthetic SAN
    // string: a real PSC-issued natural-person container is [[FISC-013]]'s
    // homologation check, and pretending the fixture proves it would be worse
    // than saying so.
    expect(new X509Certificate(Buffer.from(testCertificateDer())).subjectAltName).toBeUndefined();
  });

  it("refuses an alternative name that carries no usable entry", () => {
    expect(failureOf(() => readRucFromSubjectAlternativeName("DNS:acme.example"))).toBe(
      "CERTIFICATE_RUC_UNREADABLE"
    );
    expect(failureOf(() => readRucFromSubjectAlternativeName("serialNumber:not-a-ruc"))).toBe(
      "CERTIFICATE_RUC_UNREADABLE"
    );
    expect(failureOf(() => readRucFromSubjectAlternativeName(undefined))).toBe(
      "CERTIFICATE_RUC_UNREADABLE"
    );
    expect(failureOf(() => readRucFromSubjectAlternativeName("  "))).toBe(
      "CERTIFICATE_RUC_UNREADABLE"
    );
  });
});

describe("reading the certificate the taxpayer type implies", () => {
  it("uses the subject for a legal person", () => {
    expect(
      readCertificateRuc({
        certificatePem: FIXTURE_PEM,
        certificateSubject: "C=PY\nserialNumber=RUC80012345-6",
        taxpayerType: 2,
      })
    ).toEqual({ ruc: "80012345", checkDigit: "6" });
  });

  it("uses the alternative name for a natural person, and refuses the fixture's", () => {
    expect(
      failureOf(() =>
        readCertificateRuc({
          certificatePem: FIXTURE_PEM,
          certificateSubject: FIXTURE_SUBJECT,
          taxpayerType: 1,
        })
      )
    ).toBe("CERTIFICATE_RUC_UNREADABLE");
  });

  it("refuses a taxpayer type the Manual does not define", () => {
    expect(
      failureOf(() =>
        readCertificateRuc({
          certificatePem: FIXTURE_PEM,
          certificateSubject: "C=PY\nserialNumber=RUC80012345-6",
          taxpayerType: 3,
        })
      )
    ).toBe("UNSUPPORTED_TAXPAYER_TYPE");
  });
});

describe("the comparison", () => {
  const certificate = { ruc: "80012345", checkDigit: "6" };

  it("accepts the same RUC, whatever the check character's case", () => {
    expect(certificateRucMatches({ ruc: "80012345", checkDigit: "6" }, certificate)).toBe(true);
    expect(certificateRucMatches({ ruc: "80012345", checkDigit: "A" }, certificate)).toBe(false);
    expect(
      certificateRucMatches(
        { ruc: "80012345", checkDigit: "a" },
        { ruc: "80012345", checkDigit: "A" }
      )
    ).toBe(true);
  });

  it("refuses a different number, which is the case the obligation is about", () => {
    expect(certificateRucMatches({ ruc: "80012346", checkDigit: "6" }, certificate)).toBe(false);
  });
});
