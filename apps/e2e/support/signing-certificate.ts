import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A throwaway PKCS#12 signing container, generated at run time and never written to the repository.
 *
 * The RUC sits where `SIFEN-BASELINE.md` §6 pins it for a legal person — the subject's
 * `serialNumber` (OID 2.5.4.5), as `RUCXXXXXXXX-X` — because the API refuses a certificate whose RUC
 * cannot be read there or does not match the emitter profile (FISC-011 WU-G). The package fixture
 * (`pkcs12.fixture.ts`) carries its RUC in the `CN`, which is refused on purpose, so it cannot serve.
 *
 * OpenSSL builds it because Node cannot issue an X.509 certificate and pkijs's certificate signing
 * is broken (see the fixture's own note). The key is RSA-2048, the baseline's minimum.
 */
export interface SigningContainer {
  readonly file: Buffer;
  readonly password: string;
}

export function buildSigningContainer(ruc: string, checkDigit: string): SigningContainer {
  const dir = mkdtempSync(join(tmpdir(), "newsaas-e2e-cert-"));
  const password = `e2e-${Date.now().toString(36)}`;
  try {
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    const container = join(dir, "container.p12");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "30",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        `/C=PY/O=NewSaaS E2E/CN=NewSaaS E2E/serialNumber=RUC${ruc}-${checkDigit}`,
        "-addext",
        "keyUsage=digitalSignature,nonRepudiation",
        "-addext",
        "extendedKeyUsage=clientAuth",
      ],
      { stdio: "pipe" }
    );
    execFileSync(
      "openssl",
      [
        "pkcs12",
        "-export",
        "-inkey",
        key,
        "-in",
        cert,
        "-out",
        container,
        "-passout",
        `pass:${password}`,
      ],
      { stdio: "pipe" }
    );
    return { file: readFileSync(container), password };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
