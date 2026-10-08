import {
  CertificateRucError,
  type CertificateRucFailure,
  type CertificateRuc,
  certificateRucMatches,
  readCertificateRuc,
} from "@newsaas/fiscal";
import { DomainError } from "@newsaas/shared";

/**
 * FISC-011 WU-G — the invariant between the emitter profile and the certificate.
 *
 * Baseline §22.4 pins the obligation, `D101 dRucEm`: _"Debe corresponder al RUC
 * del certificado digital utilizado para firmar el DE."_ Both sides of it are
 * API-owned writes, and this module is the one place they meet, so the two
 * services refuse the same way and with the same wording.
 *
 * **Why both write paths check.** The invariant has an ordering hole if only one
 * does: a profile saved before the certificate exists cannot be compared with
 * anything, and a certificate uploaded afterwards would then be the first write
 * that could disagree. So the profile write checks every ACTIVE material, and
 * the upload checks the profile — whichever is written second is refused. The
 * reads happen outside their write transactions on purpose (they are cheap,
 * tenant-scoped reads and holding a transaction across the certificate parse
 * buys nothing); a genuinely concurrent pair can therefore slip past both and is
 * caught by the next write of either side, which is the honest bound of a
 * two-table invariant that no single constraint can express.
 *
 * **Why a certificate that cannot expose a RUC is a refusal.** The obligation is
 * "enforced or refused, never silently accepted": a material whose certificate
 * does not carry the RUC in the placement `SIFEN-BASELINE.md` §6 pins would
 * otherwise become a document SIFEN rejects, discovered at submission time
 * instead of at configuration time.
 */

export const FISCAL_PROFILE_RUC_MISMATCH_MESSAGE =
  "The emitter profile's RUC does not match the RUC in the tenant's signing certificate.";

/**
 * One operator-facing message per failure, typed as an exhaustive record over
 * the failure union so a new failure reason without a message is a compile
 * error rather than a runtime surprise — the shape `EXTRACTION_MESSAGES` uses.
 */
const CERTIFICATE_RUC_MESSAGES: Record<CertificateRucFailure, string> = {
  CERTIFICATE_RUC_MISSING:
    "The tenant's signing certificate does not carry the RUC where SIFEN requires it for the profile's taxpayer type.",
  CERTIFICATE_RUC_MALFORMED:
    "The tenant's signing certificate carries a malformed RUC; SIFEN requires RUCXXXXXXXXX-X.",
  CERTIFICATE_RUC_UNREADABLE: "The RUC in the tenant's signing certificate could not be read.",
  UNSUPPORTED_TAXPAYER_TYPE:
    "The emitter profile's taxpayer type is neither a natural person nor a legal person, so the certificate's RUC placement is unknown.",
};

/** The profile fields the comparison needs: `D101`, `D102` and `D103`. */
export interface ProfileRucFields {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
}

/** The stored material fields the comparison needs. */
export interface CertificateBearingMaterial {
  readonly certificatePem: string;
  readonly certificateSubject: string;
}

/**
 * Refuses unless every material carries the profile's RUC. No materials means
 * nothing to compare — the profile write is then the side that proceeds, and the
 * upload that follows is the side that refuses.
 */
export function assertProfileRucMatchesCertificates(args: {
  readonly profile: ProfileRucFields;
  readonly materials: readonly CertificateBearingMaterial[];
}): void {
  for (const material of args.materials) {
    let certificate: CertificateRuc;
    try {
      certificate = readCertificateRuc({
        certificatePem: material.certificatePem,
        certificateSubject: material.certificateSubject,
        taxpayerType: args.profile.taxpayerType,
      });
    } catch (error) {
      if (!(error instanceof CertificateRucError)) throw error;
      throw new DomainError("VALIDATION_FAILED", CERTIFICATE_RUC_MESSAGES[error.failure]);
    }
    if (!certificateRucMatches(args.profile, certificate)) {
      throw new DomainError("VALIDATION_FAILED", FISCAL_PROFILE_RUC_MISMATCH_MESSAGE);
    }
  }
}
