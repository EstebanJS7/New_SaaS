/**
 * FISC-010 WU-C — the local mutual-TLS double `sifen.transport.test.ts` asserts
 * ADR-008's transport against.
 *
 * The double exists because ADR-008's load-bearing properties are all about the
 * **handshake**, and none of them is provable against a mocked agent or a
 * stubbed `https.request`: "no pooled socket across tenants", "a client without
 * a certificate is refused" and "the tenant's certificate is presented" are
 * statements about a TLS session, so the suite runs a real one against
 * `localhost`.
 *
 * Four certificates, all built here with `pkijs` + `asn1js` (already
 * dependencies, no new ones) and signed with `node:crypto`:
 *
 * ```text
 * CA          self-signed, basicConstraints CA:TRUE, keyUsage keyCertSign
 * server      signed by the CA, subjectAltName DNS:localhost, EKU serverAuth
 * tenant A    signed by the CA, EKU clientAuth
 * tenant B    signed by the CA, EKU clientAuth
 * ```
 *
 * **Why `node:crypto` signs the TBS and not `pkijs`.** `pkijs` 3.4.1 has no
 * certificate factory (`createSelfSigned` is gone) and its own `sign()` writes a
 * `signatureAlgorithm` OpenSSL rejects — the same finding `pkcs12.fixture.ts`
 * records for its embedded certificate. So the ASN.1 structure is `pkijs`'s (its
 * `encodeTBS()` is the certificate body, field for field) and the signature is
 * `crypto.sign("sha256", tbs, caKey)` with `sha256WithRSAEncryption` written
 * explicitly, NULL parameters included. The result verifies under OpenSSL, which
 * is what the handshake needs.
 *
 * **Test-only, and exported as such.** This module is reachable through
 * `@newsaas/fiscal/testing`, never through the package's runtime barrel: it
 * carries throwaway key material and an `https` server, and neither belongs to
 * the boundary's public contract.
 */

import * as asn1js from "asn1js";
import { generateKeyPairSync, randomBytes, sign as signPayload, type KeyObject } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  Certificate,
  Extension,
  ExtKeyUsage,
  GeneralName,
  GeneralNames,
  PublicKeyInfo,
  RelativeDistinguishedNames,
  Time,
} from "pkijs";

import type { FiscalTransportCredential } from "../fiscal-credential.port.js";

/** `sha256WithRSAEncryption`, the signature algorithm every fixture cert uses. */
const SHA256_WITH_RSA_OID = "1.2.840.113549.1.1.11";

const BASIC_CONSTRAINTS_OID = "2.5.29.19";
const KEY_USAGE_OID = "2.5.29.15";
const EXTENDED_KEY_USAGE_OID = "2.5.29.37";
const SUBJECT_ALT_NAME_OID = "2.5.29.17";

const COUNTRY_OID = "2.5.4.6";
const ORGANIZATION_OID = "2.5.4.10";
const COMMON_NAME_OID = "2.5.4.3";

const SERVER_AUTH_OID = "1.3.6.1.5.5.7.3.1";
const CLIENT_AUTH_OID = "1.3.6.1.5.5.7.3.2";

/** GeneralName's context-specific tag 2 is `dNSName` (RFC 5280 §4.2.1.6). */
const DNS_NAME_GENERAL_NAME_TYPE = 2;

/** KeyUsage bit positions (RFC 5280 §4.2.1.3). */
const KEY_USAGE_DIGITAL_SIGNATURE = 0;
const KEY_USAGE_KEY_ENCIPHERMENT = 2;
const KEY_USAGE_KEY_CERT_SIGN = 5;
const KEY_USAGE_CRL_SIGN = 6;

export const SIFEN_TLS_FIXTURE_ORGANIZATION = "NewSaaS Test Fixture";
export const SIFEN_TLS_FIXTURE_COUNTRY = "PY";
export const SIFEN_TLS_FIXTURE_CA_COMMON_NAME = "NewSaaS SIFEN Test CA";
export const SIFEN_TLS_FIXTURE_SERVER_COMMON_NAME = "localhost";
export const SIFEN_TLS_FIXTURE_TENANT_A_COMMON_NAME = "RUC80012345-6 Tenant A";
export const SIFEN_TLS_FIXTURE_TENANT_B_COMMON_NAME = "RUC80012346-4 Tenant B";

/** Ten years, for the fixture that is meant to be valid. */
const DEFAULT_VALIDITY_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface SifenTlsFixtureOptions {
  /**
   * Validity window of **every** certificate in the fixture.
   *
   * Defaults to "started a day ago, ends in ten years" so a fixture built at any
   * real wall-clock instant is valid — which matters, because the server verifies
   * the client certificate against the real clock. Pass a past window for an
   * expired credential and a future one for a not-yet-valid credential; both are
   * used to prove the transport's local freshness check, and neither needs to
   * complete a handshake.
   */
  readonly notBefore?: Date;
  readonly notAfter?: Date;
}

export interface SifenTlsFixture {
  readonly caPem: string;
  readonly serverCertificatePem: string;
  readonly serverPrivateKeyPem: string;
  readonly tenantA: FiscalTransportCredential;
  readonly tenantB: FiscalTransportCredential;
  /** The window every certificate in this fixture was built with. */
  readonly notBefore: Date;
  readonly notAfter: Date;
}

/**
 * Builds the CA, the server certificate and the two tenant client certificates.
 *
 * Synchronous on purpose: RSA key generation and `pkijs`'s ASN.1 encoding are
 * both synchronous, and a promise here would only hide that. Four RSA-2048 key
 * pairs cost a few hundred milliseconds, which is why a suite builds the fixture
 * once and reuses it.
 */
export function createSifenTlsFixture(options: SifenTlsFixtureOptions = {}): SifenTlsFixture {
  const notBefore = options.notBefore ?? new Date(Date.now() - ONE_DAY_MS);
  const notAfter = options.notAfter ?? new Date(Date.now() + DEFAULT_VALIDITY_MS);

  const caKeys = generateFixtureKeyPair();
  const caSubject = fixtureName(SIFEN_TLS_FIXTURE_CA_COMMON_NAME);
  const caDer = buildFixtureCertificate({
    subject: caSubject,
    issuer: caSubject,
    subjectPublicKeyInfo: caKeys.publicKeyInfo,
    issuerPrivateKey: caKeys.privateKey,
    notBefore,
    notAfter,
    extensions: [
      basicConstraints(true),
      keyUsage([KEY_USAGE_DIGITAL_SIGNATURE, KEY_USAGE_KEY_CERT_SIGN, KEY_USAGE_CRL_SIGN]),
    ],
  });
  const caPem = encodePem(caDer);

  const serverKeys = generateFixtureKeyPair();
  const serverCertificatePem = encodePem(
    buildFixtureCertificate({
      subject: fixtureName(SIFEN_TLS_FIXTURE_SERVER_COMMON_NAME),
      issuer: caSubject,
      subjectPublicKeyInfo: serverKeys.publicKeyInfo,
      issuerPrivateKey: caKeys.privateKey,
      notBefore,
      notAfter,
      extensions: [
        basicConstraints(false),
        keyUsage([KEY_USAGE_DIGITAL_SIGNATURE, KEY_USAGE_KEY_ENCIPHERMENT]),
        extendedKeyUsage([SERVER_AUTH_OID]),
        subjectAltName(SIFEN_TLS_FIXTURE_SERVER_COMMON_NAME),
      ],
    })
  );

  const credential = (commonName: string): FiscalTransportCredential => {
    const keys = generateFixtureKeyPair();
    return {
      certificatePem: encodePem(
        buildFixtureCertificate({
          subject: fixtureName(commonName),
          issuer: caSubject,
          subjectPublicKeyInfo: keys.publicKeyInfo,
          issuerPrivateKey: caKeys.privateKey,
          notBefore,
          notAfter,
          extensions: [
            basicConstraints(false),
            keyUsage([KEY_USAGE_DIGITAL_SIGNATURE]),
            extendedKeyUsage([CLIENT_AUTH_OID]),
          ],
        })
      ),
      privateKeyPem: keys.privateKeyPem,
      notBefore,
      notAfter,
    };
  };

  return {
    caPem,
    serverCertificatePem,
    serverPrivateKeyPem: serverKeys.privateKeyPem,
    tenantA: credential(SIFEN_TLS_FIXTURE_TENANT_A_COMMON_NAME),
    tenantB: credential(SIFEN_TLS_FIXTURE_TENANT_B_COMMON_NAME),
    notBefore,
    notAfter,
  };
}

/** Answers every request with an empty `200 application/soap+xml`. */
function answerWithAnEmptySoapResponse(_request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { "content-type": "application/soap+xml; charset=utf-8" });
  response.end("");
}

export type SifenTlsServerHandler = (request: IncomingMessage, response: ServerResponse) => void;

export interface SifenTlsServerHandle {
  /** `https://localhost:<port>`, the origin an endpoint is built from. */
  readonly origin: string;
  readonly port: number;
  /**
   * TCP connections accepted, whether or not the handshake completed.
   *
   * Cumulative, not live: with `agent: false` every call's socket is closed when
   * the call ends, so a live count would read zero exactly when the interesting
   * assertion is "two connections were opened". The distinction from
   * {@link acceptedPeerSubjects} is the other half: a client that fails a local
   * check before the request is opened must leave this at zero, while a client
   * the server *rejects* still leaves it at one.
   */
  readonly connectionCount: number;
  /**
   * The common name of the client certificate on each completed mutual
   * handshake, in connection order. Live: the server appends.
   */
  readonly acceptedPeerSubjects: string[];
  /** The `code` of each failed handshake the server saw. Live: the server appends. */
  readonly handshakeFailures: string[];
  close(): Promise<void>;
}

/**
 * Starts an `https` server that **requires** a client certificate signed by the
 * fixture's CA.
 *
 * `requestCert: true, rejectUnauthorized: true` is what makes the double
 * non-vacuous: a request without a certificate fails the handshake instead of
 * quietly succeeding, so "the transport presented the credential" is asserted by
 * the TLS stack rather than by the transport's own options.
 */
export async function startSifenTlsServer(args: {
  readonly fixture: SifenTlsFixture;
  /** Defaults to an empty `200 application/soap+xml` answer. */
  readonly handler?: SifenTlsServerHandler;
}): Promise<SifenTlsServerHandle> {
  const handler = args.handler ?? answerWithAnEmptySoapResponse;
  const sockets = new Set<Socket>();
  let connectionCount = 0;
  const acceptedPeerSubjects: string[] = [];
  const handshakeFailures: string[] = [];

  const server = createHttpsServer(
    {
      key: args.fixture.serverPrivateKeyPem,
      cert: args.fixture.serverCertificatePem,
      ca: [args.fixture.caPem],
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    handler
  );

  server.on("connection", (socket: Socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("secureConnection", (socket: TLSSocket) => {
    acceptedPeerSubjects.push(commonNameOf(socket));
  });

  server.on("tlsClientError", (error: Error) => {
    handshakeFailures.push(readErrorCode(error));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The SIFEN TLS fixture server did not bind a TCP port.");
  }

  return {
    origin: `https://localhost:${address.port}`,
    port: address.port,
    get connectionCount(): number {
      return connectionCount;
    },
    acceptedPeerSubjects,
    handshakeFailures,
    async close(): Promise<void> {
      server.closeAllConnections();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

interface FixtureKeyPair {
  readonly privateKey: KeyObject;
  readonly privateKeyPem: string;
  readonly publicKeyInfo: PublicKeyInfo;
}

function generateFixtureKeyPair(): FixtureKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey,
    privateKeyPem: exportPrivateKeyPem(privateKey),
    publicKeyInfo: PublicKeyInfo.fromBER(
      toArrayBuffer(publicKey.export({ type: "spki", format: "der" }))
    ),
  };
}

/** A PKCS#8 PEM private key, the shape `FiscalTransportCredential` declares. */
function exportPrivateKeyPem(privateKey: KeyObject): string {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  if (typeof pem !== "string") {
    throw new Error("The fixture's private key did not export as a PEM string.");
  }
  return pem;
}

/** `C`, `O` and `CN`, in the order OpenSSL prints them. */
function fixtureName(commonName: string): RelativeDistinguishedNames {
  return new RelativeDistinguishedNames({
    typesAndValues: [
      newAttribute(COUNTRY_OID, new asn1js.PrintableString({ value: SIFEN_TLS_FIXTURE_COUNTRY })),
      newAttribute(
        ORGANIZATION_OID,
        new asn1js.Utf8String({ value: SIFEN_TLS_FIXTURE_ORGANIZATION })
      ),
      newAttribute(COMMON_NAME_OID, new asn1js.Utf8String({ value: commonName })),
    ],
  });
}

function newAttribute(
  type: string,
  value: asn1js.PrintableString | asn1js.Utf8String
): AttributeTypeAndValue {
  return new AttributeTypeAndValue({ type, value });
}

/** `basicConstraints`, critical for a CA and advisory for a leaf. */
function basicConstraints(isCertificateAuthority: boolean): Extension {
  return newExtension(
    BASIC_CONSTRAINTS_OID,
    isCertificateAuthority,
    new asn1js.Sequence({
      value: [new asn1js.Boolean({ value: isCertificateAuthority })],
    })
  );
}

/**
 * `keyUsage`, whose value is a DER BIT STRING over named bit positions.
 *
 * Trailing zero bits are removed, as DER requires: `keyCertSign` alone is
 * `03 02 02 04`, not `03 02 00 04`. `pkijs` 3.4.1 dropped its `KeyUsage` class,
 * so the BIT STRING is written here rather than borrowed.
 */
function keyUsage(bits: readonly number[]): Extension {
  const highestBit = Math.max(...bits);
  const bytes = new Uint8Array(Math.floor(highestBit / 8) + 1);
  for (const bit of bits) {
    bytes[Math.floor(bit / 8)] |= 0x80 >> (bit % 8);
  }
  let lastByte = bytes[bytes.length - 1];
  let unusedBits = 0;
  while (lastByte !== 0 && (lastByte & 1) === 0) {
    unusedBits += 1;
    lastByte >>= 1;
  }
  return newExtension(
    KEY_USAGE_OID,
    true,
    new asn1js.BitString({ unusedBits, valueHex: toArrayBuffer(bytes) })
  );
}

function extendedKeyUsage(purposes: readonly string[]): Extension {
  return newExtension(
    EXTENDED_KEY_USAGE_OID,
    false,
    new ExtKeyUsage({ keyPurposes: [...purposes] }).toSchema()
  );
}

/** `subjectAltName` with a single `dNSName`. */
function subjectAltName(dnsName: string): Extension {
  return newExtension(
    SUBJECT_ALT_NAME_OID,
    false,
    new GeneralNames({
      names: [new GeneralName({ type: DNS_NAME_GENERAL_NAME_TYPE, value: dnsName })],
    }).toSchema()
  );
}

function newExtension(extnID: string, critical: boolean, schema: asn1js.BaseBlock): Extension {
  return new Extension({
    extnID,
    critical,
    extnValue: toArrayBuffer(Buffer.from(schema.toBER(false))),
  });
}

interface BuildFixtureCertificateArgs {
  readonly subject: RelativeDistinguishedNames;
  readonly issuer: RelativeDistinguishedNames;
  readonly subjectPublicKeyInfo: PublicKeyInfo;
  readonly issuerPrivateKey: KeyObject;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly extensions: readonly Extension[];
}

/**
 * Assembles one X.509 v3 certificate and signs its TBS with the issuer's key.
 *
 * `encodeTBS()` is the certificate body; the signature covers exactly those bytes,
 * which is what makes the certificate verifiable. `toSchema(true)` re-encodes the
 * TBS from the fields set here rather than returning a parsed view — the flag
 * matters, because `pkijs`'s `toSchema(false)` tries to read a `tbsView` that was
 * never parsed and throws.
 */
function buildFixtureCertificate(args: BuildFixtureCertificateArgs): Buffer {
  const certificate = new Certificate();
  certificate.version = 2; // X.509 v3: extensions require it.
  certificate.serialNumber = new asn1js.Integer({ valueHex: toArrayBuffer(fixtureSerial()) });
  certificate.signature = sha256WithRsaAlgorithm();
  certificate.signatureAlgorithm = sha256WithRsaAlgorithm();
  certificate.issuer = args.issuer;
  certificate.notBefore = new Time({ type: 0, value: args.notBefore });
  certificate.notAfter = new Time({ type: 0, value: args.notAfter });
  certificate.subject = args.subject;
  certificate.subjectPublicKeyInfo = args.subjectPublicKeyInfo;
  certificate.extensions = [...args.extensions];

  const tbs = Buffer.from(certificate.encodeTBS().toBER(false));
  certificate.signatureValue = new asn1js.BitString({
    valueHex: toArrayBuffer(signPayload("sha256", tbs, args.issuerPrivateKey)),
  });

  return Buffer.from(certificate.toSchema(true).toBER(false));
}

/**
 * `sha256WithRSAEncryption`, parameters **explicitly NULL**.
 *
 * RFC 4055 requires the NULL parameters for the PKCS#1 v1.5 RSA algorithms, and
 * their absence is the malformation `pkcs12.fixture.ts` records. Writing them
 * here is what makes OpenSSL accept the fixture's chain.
 */
function sha256WithRsaAlgorithm(): AlgorithmIdentifier {
  return new AlgorithmIdentifier({
    algorithmId: SHA256_WITH_RSA_OID,
    algorithmParams: new asn1js.Null(),
  });
}

/** A positive 64-bit serial: the high bit cleared so the INTEGER stays unsigned. */
function fixtureSerial(): Buffer {
  const serial = randomBytes(8);
  serial[0] &= 0x7f;
  serial[0] |= 0x01;
  return serial;
}

function encodePem(der: Buffer): string {
  const base64 = der.toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function commonNameOf(socket: TLSSocket): string {
  const peer = socket.getPeerCertificate();
  const commonName: unknown = peer.subject?.CN;
  return typeof commonName === "string" ? commonName : "";
}

function readErrorCode(error: Error): string {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : error.name;
}
