/**
 * FISC-015 WU-D2 — the document assembly: the tenant's rows to a signed DE.
 *
 * `fiscal-document-builder.ts` declares the stage's seam and answers
 * `UNAVAILABLE` with a named reason, because a guessed document is worse than no
 * document. This module is the **real** implementation of that seam: it runs
 * [[FISC-012]]'s chain over the tenant's own rows and answers the stage with
 * `{ cdc, signedXml }`, or with a stable reason code an operator can act on.
 *
 * ## The chain, and the function that performs each step
 *
 * ```text
 *  1  the claimed document      fiscal_document -> invoice_id      this module
 *  2  the credential            credentialPort.read                FiscalCredentialPort
 *  3  the CSC                   cscPort.read                       FiscalCscPort (WU-C)
 *  4  the authorisation         invoiceAllocation.read             WU-B's read
 *  5  the range's dFeIniT       fiscal_timbrado_range by id        this module
 *  6  the profile, activities   profileReader.readProfile          WU-C's read
 *  7  the establishment         profileReader.readEstablishment    WU-C's read
 *  8  profile assembly          assembleEmitterProfile             FISC-011 WU-E
 *  9  the receptor              receptorReader.readReceptor        WU-D1's read
 * 10  the invoice snapshot      snapshotReader.readInvoiceSnapshot WU-D1's read
 * 11  identity                  generateSecurityCode + composeCdc   FISC-008
 * 12  mapping                   buildDteRequestFromInvoice         FISC-008 WU-C
 * 13  xml                       buildDteXml (QR placeholder inside) FISC-008 WU-A
 * 14  signature                 signDteXml                         FISC-009
 * 15  the QR                    buildQrContent + fillQrContent      FISC-012 WU-C
 * ```
 *
 * The order is not a preference. `dCodSeg` is both `gOpeDE.dCodSeg` and one of
 * the CDC's eleven fields, so the security code is drawn before the CDC is
 * composed; the CDC is `DE/@Id` and the signature's reference; and the QR
 * carries the **signature's digest** (§24.3), so it is built after the signature
 * and filled into `gCamFuFD`, outside the signed subtree (§4, §24.5). Steps 11
 * and 15 therefore straddle steps 12–14 rather than following the numbered list.
 *
 * ## The credential is read once and serves two uses
 *
 * One certificate does two jobs (baseline §6): its `privateKeyPem` and
 * `certificatePem` **sign this document here**, and the same pair
 * **authenticates the mutual-TLS call** the provider makes later. This module
 * reads the credential for the first job because the signature needs it — the
 * transport reads it again per call for the second (ADR-008 §2 makes the read
 * per call and never cached) — so a reader should not be surprised that the
 * assembly touches the credential at all.
 *
 * ## No transaction of its own
 *
 * The stage owns the claim, the custody and the XSD gate; this module only reads
 * and computes, and every read is one tenant-scoped statement. The facts it
 * consumes are the invoice's confirmed snapshot and the allocation, which is
 * written once inside the confirmation transaction and immutable by trigger.
 *
 * ## What it refuses, and why refusal is an outcome
 *
 * Every state that makes a document impossible is answered as `UNAVAILABLE` with
 * a stable code and a sentence: never a throw, because the stage records that as
 * a terminal `ERROR` row and an operator can act on it, while a throw would only
 * be a job retry. The codes come from three sources, and the provenance is
 * deliberate: this module's own states are in {@link FISCAL_ASSEMBLY_REASON_CODES};
 * a reader's refusal is its own code (`RATE_NOT_CLASSIFIED`,
 * `OPERATION_TYPE_NOT_DECLARED`, `ITEM_UNIT_NOT_DECLARED`, …), so a state has
 * one name wherever it is observed; and a pure builder's typed refusal is its
 * own `failure` (`INVALID_RECEPTOR`, `UNEXPECTED_SIGNATURE_SHAPE`, …), which is
 * what keeps a document the protocol itself rejects from being submitted.
 *
 * Two faults are deliberately **not** converted: an unexpected error (a bug),
 * and `SecretStoreIntegrityError` from a corrupt secret — the credential and CSC
 * boundaries fail closed on absence and propagate a fault, and this module
 * honours that boundary instead of flattening both into one answer.
 *
 * ## Nothing secret leaves here
 *
 * The private key and the CSC enter, and neither is written to the outcome: the
 * `BUILT` document is the signed XML (which carries the X.509 certificate, the
 * public half the schema requires) and the CDC, and every reason sentence names
 * a state, never material.
 */

import { randomInt } from "node:crypto";
import {
  assembleEmitterProfile,
  buildDteRequestFromInvoice,
  buildDteXml,
  buildQrContent,
  composeCdc,
  DteQrError,
  DteSigningError,
  DteValidationError,
  EmitterProfileAssemblyError,
  fillQrContent,
  generateSecurityCode,
  isCredentialFresh,
  QR_PLACEHOLDER,
  signDteXml,
  type DteReceptor,
  type FiscalCredentialPort,
  type FiscalSigningEnvironment,
} from "@newsaas/fiscal";
import {
  createFiscalProfileReader,
  createInvoiceAllocationReader,
  createInvoiceSnapshotReader,
  createReceptorReader,
  InvoiceSnapshotReadError,
  ReceptorReadError,
  type FiscalCscPort,
  type FiscalProfileReadClient,
  type InvoiceAllocationReadClient,
  type InvoiceSnapshotReadClient,
  type ReceptorReadClient,
} from "@newsaas/fiscal-persistence";
import type {
  FiscalDocumentBuildOutcome,
  FiscalDocumentBuildRequest,
  FiscalDocumentBuilder,
} from "./fiscal-document-builder.js";

/**
 * The injection token the composition root provides the CSC port under.
 *
 * WU-C declared the read (`createFiscalCscReader`) and deliberately declared no
 * port in `packages/fiscal`, because that package owns no CSC boundary today.
 * The token lives here, beside its only consumer, and the worker provides it the
 * same way it provides `FISCAL_CREDENTIAL_PORT`.
 */
export const FISCAL_CSC_PORT = Symbol("FISCAL_CSC_PORT");

/**
 * The stable codes this module answers `UNAVAILABLE` with.
 *
 * Frozen and exported so a test and an operator runbook name the same states.
 * The three credential codes are the transport's own vocabulary (ADR-008 §2
 * makes the freshness rule one pure function; using its names here is what keeps
 * "the certificate is expired" one state instead of two), and `CREDENTIAL_UNAVAILABLE`
 * is the code the SIFEN adapter already answers a null credential read with.
 */
export const FISCAL_ASSEMBLY_REASON_CODES = Object.freeze({
  /** The document the stage claimed is not readable in this tenant. */
  DOCUMENT_UNAVAILABLE: "FISCAL_DOCUMENT_UNAVAILABLE",
  /** The invoice behind that document is not readable in this tenant. */
  INVOICE_UNAVAILABLE: "INVOICE_UNAVAILABLE",
  /** No ACTIVE signing material for this environment: nothing to sign with. */
  CREDENTIAL_UNAVAILABLE: "CREDENTIAL_UNAVAILABLE",
  /** The material exists and its validity window is closed already. */
  CREDENTIAL_EXPIRED: "CREDENTIAL_EXPIRED",
  /** The material exists and its validity window has not opened yet. */
  CREDENTIAL_NOT_YET_VALID: "CREDENTIAL_NOT_YET_VALID",
  /** No ACTIVE CSC for this environment: the QR's hash has no input (§24.2). */
  CSC_UNAVAILABLE: "CSC_UNAVAILABLE",
  /**
   * The invoice carries no allocation: it was confirmed on Billing's counter
   * path, which [[DEC-056]] left as the non-fiscal path.
   */
  FISCAL_NUMBER_NOT_ALLOCATED: "FISCAL_NUMBER_NOT_ALLOCATED",
  /** The range the allocation names is not readable, so `dFeIniT` has no source. */
  TIMBRADO_RANGE_UNAVAILABLE: "TIMBRADO_RANGE_UNAVAILABLE",
  /** The tenant has no emitter fiscal profile. */
  FISCAL_PROFILE_UNAVAILABLE: "FISCAL_PROFILE_UNAVAILABLE",
  /** The establishment the allocation names is not readable in this tenant. */
  ESTABLISHMENT_UNAVAILABLE: "FISCAL_ESTABLISHMENT_UNAVAILABLE",
  /**
   * The invoice is issued in a currency other than PYG. `F023 dTotalGs` is a
   * caller-supplied input no row carries, and NT 008 states its formula with no
   * rounding rule, so converting here would be a money arithmetic this module
   * does not own.
   */
  CURRENCY_NOT_SUPPORTED: "CURRENCY_NOT_SUPPORTED",
} as const);

/** One reason code this module answers with, from its own frozen set. */
export type FiscalAssemblyReasonCode =
  (typeof FISCAL_ASSEMBLY_REASON_CODES)[keyof typeof FISCAL_ASSEMBLY_REASON_CODES];

/**
 * What the factory needs: the reads, the two ports, the deployment's environment,
 * and the two injected sources the chain's determinism depends on.
 */
export interface FiscalDocumentAssemblyArgs {
  /** The Prisma client (or a test double), structural: no Prisma type crosses here. */
  readonly client: FiscalDocumentAssemblyClient;
  /** The same port the provider's transport reads the mutual-TLS credential from. */
  readonly credentialPort: FiscalCredentialPort;
  /** The tenant's CSC for this environment (WU-C's read). */
  readonly cscPort: FiscalCscPort;
  /** The deployment's DNIT environment, from `SIFEN_ENVIRONMENT`. */
  readonly environment: FiscalSigningEnvironment;
  /**
   * The clock behind `dFecFirma` and the credential's freshness read — one read
   * per build, so the signature's timestamp and the validity decision agree.
   */
  readonly now?: () => Date;
  /**
   * The random source `generateSecurityCode` draws `dCodSeg` from. Injected
   * because the Manual requires an unpredictability a test cannot assert on a
   * `node:crypto` call and *can* assert on a deterministic source.
   */
  readonly randomDigit?: () => number;
}

/**
 * The invoice row this module needs: the snapshot's two fields plus the customer
 * the receptor is read for.
 *
 * One member, three fields, because the same `invoice` delegate serves both the
 * snapshot read and this module's own customer lookup and the two shapes must
 * agree.
 */
export interface FiscalDocumentAssemblyInvoiceRow {
  /** `D015 cMoneOpe`, which the snapshot read maps too. */
  readonly currency: string;
  /** `D002 dFeEmiDE`'s source, which the snapshot read maps too. */
  readonly confirmedAt: Date | null;
  /** `Invoice.customerId`; `null` for a walk-in invoice, which is refused. */
  readonly customerId: string | null;
}

/**
 * What this module reads, in the shapes the persistence factories accept.
 *
 * The three extra members are the resolution of the ids the stage hands over —
 * the document, the invoice's customer and the range's `dFeIniT` — and they are
 * declared structurally, exactly like the readers' own clients, so the worker
 * imports no Prisma type here and a test passes a plain object.
 */
export type FiscalDocumentAssemblyClient = FiscalProfileReadClient &
  ReceptorReadClient &
  InvoiceAllocationReadClient &
  Omit<InvoiceSnapshotReadClient, "invoice"> & {
    /** The claimed document, whose `invoice_id` the whole chain hangs off. */
    readonly fiscalDocument: {
      findFirst(args: {
        where: { tenantId: string; id: string };
      }): Promise<{ invoiceId: string } | null>;
    };
    /** The invoice, for the one column the receptor read needs. */
    readonly invoice: {
      findFirst(args: {
        where: { tenantId: string; id: string };
        select?: { customerId?: true };
      }): Promise<FiscalDocumentAssemblyInvoiceRow | null>;
    };
    /** The authorisation the allocation names, read for its own `dFeIniT`. */
    readonly fiscalTimbradoRange: {
      findFirst(args: {
        where: { tenantId: string; id: string };
      }): Promise<{ validityStart: Date } | null>;
    };
  };

/**
 * [[FISC-012]] §24: `DocumentIdentity.environment` speaks `"test" |
 * "production"` while `SIFEN_ENVIRONMENT` speaks `"TEST" | "PRODUCTION"`.
 *
 * **The mapping lives here and nowhere else.** The upper-case vocabulary is the
 * deployment's — it reaches `credentialPort.read`, `cscPort.read` and therefore
 * the DNIT host — and the lower-case one is the document's: it selects the
 * emitter's name (§22.5) and the QR's consultation address (§24.3). A second
 * mapping would be a second place the two could disagree about which host a
 * document was issued for.
 */
export const DOCUMENT_IDENTITY_ENVIRONMENT: Readonly<
  Record<FiscalSigningEnvironment, "test" | "production">
> = Object.freeze({
  TEST: "test",
  PRODUCTION: "production",
});

/** `fecHhmmss` (§21.3): UTC, no timezone suffix, no fractional seconds. */
function fecHhmmss(instant: Date): string {
  return instant.toISOString().slice(0, 19);
}

/** The `UNAVAILABLE` answer, in one place so no call site forgets the shape. */
function unavailable(reasonCode: string, reason: string): FiscalDocumentBuildOutcome {
  return { outcome: "UNAVAILABLE", reasonCode, reason };
}

/**
 * The typed refusals the pure builders raise, as a reason code and a sentence.
 *
 * All four carry a `failure` that is already a stable code, so the row an
 * operator reads names the violated rule instead of a generic assembly failure.
 * `null` means "not a refusal this module converts", and the caller rethrows.
 */
function builderRefusal(error: unknown): { reasonCode: string; reason: string } | null {
  if (
    error instanceof DteValidationError ||
    error instanceof DteSigningError ||
    error instanceof DteQrError ||
    error instanceof EmitterProfileAssemblyError
  ) {
    return { reasonCode: error.failure, reason: error.message };
  }
  return null;
}

/**
 * §24.3's parameter is `dRucRec/dNumIDRec` — the receptor's **identification**,
 * whichever of the two the document carries.
 *
 * The table names both fields with one parameter because the two are mutually
 * exclusive by §22.11's rules: a contributor (`iNatRec = 1`) carries `dRucRec`
 * and is forbidden an identity document, and a non-contributor carries the
 * document number — or `"0"` as the innominado case completes it. Reaching
 * neither means the receptor did not come from `receptor.read.ts`, so this is a
 * refusal rather than an empty parameter.
 */
function qrReceptorIdentity(receptor: DteReceptor): string {
  const identity = receptor.dRucRec ?? receptor.dNumIDRec;
  if (identity === undefined) {
    throw new DteValidationError(
      "INVALID_RECEPTOR",
      "gDatRec carries neither dRucRec nor dNumIDRec, and the QR's dRucRec/dNumIDRec " +
        "parameter has no value."
    );
  }
  return identity;
}

/**
 * `SignDteXmlArgs` -> `string`, and the digest the QR needs is inside that
 * string: [[FISC-009]]'s signer returns the signed document and not a pair, so
 * `DigestValue` is read from the signature it produced.
 *
 * It is exactly one element: the profile pins **one** `Reference` with one
 * `DigestValue` (§5), and `signDteXml` refuses a document with any other number
 * of signatures. A missing value is a signer defect, not a tenant state, so it
 * is thrown as the signing failure it is and reaches an operator through the
 * job's own failure path.
 */
const DIGEST_VALUE_PATTERN = /<DigestValue>([^<]*)<\/DigestValue>/;

function digestValueOf(signedXml: string): string {
  const digest = DIGEST_VALUE_PATTERN.exec(signedXml)?.[1];
  if (digest === undefined || digest === "") {
    throw new DteSigningError(
      "UNEXPECTED_SIGNATURE_SHAPE",
      "The signed document carries no DigestValue, and the QR's parameter is the signature's " +
        "own digest (§24.3)."
    );
  }
  return digest;
}

/**
 * Builds the assembly the worker's composition root provides as
 * `FISCAL_DOCUMENT_BUILDER`.
 *
 * Pure wiring: construction reads no credential, no clock and no row, so a
 * deployment that wires it pays nothing until a document is actually built.
 */
export function createFiscalDocumentAssembly(
  args: FiscalDocumentAssemblyArgs
): FiscalDocumentBuilder {
  const profiles = createFiscalProfileReader(args.client);
  const allocations = createInvoiceAllocationReader(args.client);
  const receptors = createReceptorReader(args.client);
  const snapshots = createInvoiceSnapshotReader(args.client);
  const now = args.now ?? ((): Date => new Date());
  const randomDigit = args.randomDigit ?? ((): number => randomInt(0, 10));
  const identityEnvironment = DOCUMENT_IDENTITY_ENVIRONMENT[args.environment];

  return {
    async build(request: FiscalDocumentBuildRequest): Promise<FiscalDocumentBuildOutcome> {
      const { tenantId, fiscalDocumentId } = request;

      // ---- the claimed document -------------------------------------------
      const document = await args.client.fiscalDocument.findFirst({
        where: { tenantId, id: fiscalDocumentId },
      });
      if (document === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.DOCUMENT_UNAVAILABLE,
          "The fiscal document the stage claimed is not readable in this tenant, so there is " +
            "no invoice to assemble a document from."
        );
      }
      const invoiceId = document.invoiceId;

      // ---- the credential, read once, serving the signature here and the ---
      // ---- mutual-TLS call later (baseline §6) -----------------------------
      const credential = await args.credentialPort.read({
        tenantId,
        environment: args.environment,
      });
      if (credential === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.CREDENTIAL_UNAVAILABLE,
          `The tenant has no ACTIVE signing material for ${args.environment}, so this document ` +
            "cannot be signed; nothing was built."
        );
      }
      const at = now();
      // ADR-008 §2 exports `isCredentialFresh` as a pure function so "the
      // certificate is not valid now" is one boundary every caller shares. A
      // document signed outside it would be a document the transport refuses,
      // and the signature's own timestamp would sit outside the certificate.
      if (!isCredentialFresh(credential, at)) {
        return at.getTime() < credential.notBefore.getTime()
          ? unavailable(
              FISCAL_ASSEMBLY_REASON_CODES.CREDENTIAL_NOT_YET_VALID,
              `The tenant's signing certificate for ${args.environment} is not valid before ` +
                `${credential.notBefore.toISOString()}, and the document's signature is ` +
                `timestamped now.`
            )
          : unavailable(
              FISCAL_ASSEMBLY_REASON_CODES.CREDENTIAL_EXPIRED,
              `The tenant's signing certificate for ${args.environment} stopped being valid at ` +
                `${credential.notAfter.toISOString()}, and the document's signature is ` +
                "timestamped now."
            );
      }

      // ---- the CSC: the QR's hash input, never emitted (§24.2) --------------
      const csc = await args.cscPort.read({ tenantId, environment: args.environment });
      if (csc === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.CSC_UNAVAILABLE,
          `The tenant has no ACTIVE CSC for ${args.environment}; the QR's hash needs one ` +
            "(§24.2) and no value is invented in its place."
        );
      }

      // ---- the authorisation the number was drawn from ---------------------
      const allocation = await allocations.read(tenantId, invoiceId);
      if (allocation === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.FISCAL_NUMBER_NOT_ALLOCATED,
          "The invoice carries no fiscal allocation, so no timbrado authorises a document " +
            "number for it: it was confirmed on Billing's counter path, which DEC-056 left as " +
            "the non-fiscal path. Nothing is built from a number no authorisation covers."
        );
      }
      // `dFeIniT` is the ONE field the allocation's own snapshot does not carry:
      // the range row is its source, and the identity the document states stays
      // the allocation's snapshot rather than a fresh read of a range that may
      // have rolled over since (see `invoice-allocation.read.ts`).
      const range = await args.client.fiscalTimbradoRange.findFirst({
        where: { tenantId, id: allocation.rangeId },
      });
      if (range === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.TIMBRADO_RANGE_UNAVAILABLE,
          "The timbrado range the allocation names is not readable in this tenant, so gTimb's " +
            "dFeIniT has no source."
        );
      }

      // ---- the emitter profile and the establishment -----------------------
      const profileRead = await profiles.readProfile(tenantId);
      if (profileRead === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.FISCAL_PROFILE_UNAVAILABLE,
          "The tenant has no emitter fiscal profile, so gEmis and gTimb have no source."
        );
      }
      const establishment = await profiles.readEstablishment(tenantId, allocation.establishmentId);
      if (establishment === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.ESTABLISHMENT_UNAVAILABLE,
          "The establishment the allocation names is not readable in this tenant, so dEst and " +
            "gEmis' address have no source."
        );
      }

      // ---- the profile the mapper takes ------------------------------------
      // Guarded with the rest of the chain: `assembleEmitterProfile` refuses an
      // empty `gActEco` and a half-filled `gRespDE`, and those are the tenant's
      // own rows rather than this module's defect.
      let profile;
      try {
        profile = assembleEmitterProfile({
          profile: profileRead.profile,
          establishment,
          activities: profileRead.activities,
          // The authorisation's identity is the allocation's snapshot; the range
          // row contributes only the validity start it alone carries.
          range: {
            timbradoNumber: allocation.timbradoNumber,
            expeditionPoint: allocation.expeditionPoint,
            documentType: allocation.documentType,
            validityStart: range.validityStart,
          },
          // `dNumDoc` and `dSerieNum` are the emitted forms; the allocation read
          // answers both, and the DE is signed with the number it claimed.
          allocated: {
            documentNumber: allocation.documentNumber,
            series: allocation.series,
          },
        });
      } catch (error) {
        const refusal = builderRefusal(error);
        if (refusal === null) throw error;
        return unavailable(refusal.reasonCode, refusal.reason);
      }

      // ---- the receptor ----------------------------------------------------
      const invoice = await args.client.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        select: { customerId: true },
      });
      if (invoice === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.INVOICE_UNAVAILABLE,
          "The invoice behind the fiscal document is not readable in this tenant, so the " +
            "receptor has no customer to be read from."
        );
      }
      // `documentType` is the assembled `C002 iTiDE`: two of the receptor's rules
      // are conditional on it (innominado on a note, and the address).
      const documentType = profile.timbrado.iTiDE;
      let receptor: DteReceptor;
      try {
        receptor = await receptors.readReceptor({
          tenantId,
          customerId: invoice.customerId,
          documentType,
        });
      } catch (error) {
        // The read's own refusal code travels as the reason code (a missing
        // declaration, an innominado outside B2C, an address this repository
        // cannot build), so the state has one name wherever it is observed.
        if (error instanceof ReceptorReadError) {
          return unavailable(error.refusal, error.message);
        }
        throw error;
      }

      // ---- the confirmed invoice snapshot ----------------------------------
      let invoiceSnapshot;
      try {
        invoiceSnapshot = await snapshots.readInvoiceSnapshot({
          tenantId,
          invoiceId,
          receptor,
        });
      } catch (error) {
        if (error instanceof InvoiceSnapshotReadError) {
          return unavailable(error.refusal, error.message);
        }
        throw error;
      }
      if (invoiceSnapshot === null) {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.INVOICE_UNAVAILABLE,
          "The invoice behind the fiscal document is not readable in this tenant."
        );
      }

      // ---- the currency: PYG only, and that is a refusal rather than a ------
      // ---- conversion ------------------------------------------------------
      if (invoiceSnapshot.currency !== "PYG") {
        return unavailable(
          FISCAL_ASSEMBLY_REASON_CODES.CURRENCY_NOT_SUPPORTED,
          `The invoice is issued in ${invoiceSnapshot.currency} and F023 dTotalGs is not ` +
            "carried by any row: NT 008 states the guaraníes total's formula and no rounding " +
            "rule, so converting it here would be a money arithmetic this assembly does not " +
            "own. Only PYG invoices can be built until the conversion has a source."
        );
      }

      // ---- identity, mapping, xml, signature and the QR --------------------
      try {
        const security = generateSecurityCode({
          randomDigit,
          documentNumber: allocation.documentNumber,
        });
        // `composeCdc` composes the eleven fields in the Manual's order and
        // computes the check digit; the CDC is never reconstructed by hand.
        const identity = composeCdc({
          iTiDE: profile.timbrado.iTiDE,
          dRucEm: profile.emitter.dRucEm,
          dDVEmi: profile.emitter.dDVEmi,
          dEst: profile.timbrado.dEst,
          dPunExp: profile.timbrado.dPunExp,
          dNumDoc: profile.timbrado.dNumDoc,
          iTipCont: profile.emitter.iTipCont,
          dFeEmiDE: invoiceSnapshot.issuedAt,
          iTipEmi: profile.emissionType.code,
          dCodSeg: security.dCodSeg,
        });

        // `dFecFirma` is the signature's own instant, and the same `at` the
        // credential's validity was decided against.
        const mapped = buildDteRequestFromInvoice({
          invoice: invoiceSnapshot,
          profile,
          identity: {
            cdc: identity.cdc,
            dDVId: identity.dDVId,
            securityCode: security.dCodSeg,
            environment: identityEnvironment,
          },
          signatureTimestamp: fecHhmmss(at),
          // The document is built with the placeholder and the QR is filled in
          // after signing: `dCarQR` is required by the schema, and its content
          // depends on the signature (§24.5).
          qrContent: QR_PLACEHOLDER,
        });

        const signed = signDteXml({
          xml: buildDteXml(mapped.request),
          privateKeyPem: credential.privateKeyPem,
          certificatePem: credential.certificatePem,
          cdc: identity.cdc,
        });

        const qrContent = buildQrContent({
          // The QR's host follows the DOCUMENT's vocabulary, which is the one
          // mapping above; the credential and the CSC were read with the
          // deployment's.
          environment: identityEnvironment,
          cdc: identity.cdc,
          // The DE's own `D002`, taken from the request the document was built
          // from, so the QR states the instant the document states.
          dFeEmiDE: mapped.request.gDatGralOpe.dFeEmiDE,
          dRucRec: qrReceptorIdentity(mapped.request.gDatGralOpe.gDatRec),
          // `F014` and `F017` as the document carries them: the mapper's own
          // totals, not a second computation.
          dTotGralOpe: mapped.totals.general,
          dTotIVA: mapped.totals.taxAmount,
          // §13.8.2: "cuenta E701" — one `gCamItem` per line, which is what the
          // mapper emits.
          cItems: invoiceSnapshot.lines.length,
          digestValue: digestValueOf(signed),
          idCsc: csc.idCsc,
          csc: csc.csc,
        });

        return {
          outcome: "BUILT",
          document: {
            cdc: identity.cdc,
            signedXml: fillQrContent({ signedXml: signed, qrContent }),
          },
        };
      } catch (error) {
        const refusal = builderRefusal(error);
        if (refusal === null) throw error;
        return unavailable(refusal.reasonCode, refusal.reason);
      }
    },
  };
}
