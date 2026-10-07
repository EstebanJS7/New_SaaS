import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  extractSigningMaterial,
  Pkcs12ExtractionError,
  type ExtractedSigningMaterial,
  type Pkcs12ExtractionFailure,
} from "@newsaas/fiscal";
import {
  createOpaqueSecretKey,
  SECRET_KEY_PREFIXES,
  SECRET_STORE,
  type SecretStore,
} from "@newsaas/secret-store";
import { AuditWriter } from "../../audit/audit-writer.service.js";
import { RequestContextService } from "../../context/request-context.service.js";
import { EntitlementsService } from "../../entitlements/entitlements.service.js";
import { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import { assertProfileRucMatchesCertificates } from "../fiscal-ruc-consistency.js";
import { FISCAL_FEATURE_NOT_ENTITLED_MESSAGE } from "../fiscal.service.js";
import { FiscalProfileRepository } from "../timbrado/timbrado.repository.js";
import {
  FISCAL_SIGNING_MATERIAL_NOT_FOUND_MESSAGE,
  FiscalSigningMaterialRepository,
  type FiscalSigningMaterialClient,
  type FiscalSigningMaterialRow,
} from "./signing-material.repository.js";

export type FiscalSigningEnvironment = "TEST" | "PRODUCTION";

export const FISCAL_SIGNING_MATERIAL_UPLOAD_ACTION = "fiscal.signing_material.uploaded";
export const FISCAL_SIGNING_MATERIAL_RETIRE_ACTION = "fiscal.signing_material.retired";

/** The reason recorded when a new material replaces the current one. */
export const FISCAL_SIGNING_MATERIAL_ROTATION_REASON = "rotated";

export const FISCAL_SIGNING_MATERIAL_ALREADY_RETIRED_MESSAGE =
  "Signing material is already retired.";
export const FISCAL_SIGNING_MATERIAL_INVALID_CONTAINER_MESSAGE =
  "The uploaded file is not a valid PKCS#12 container.";
export const FISCAL_SIGNING_MATERIAL_INVALID_PASSWORD_MESSAGE =
  "The PKCS#12 password is incorrect.";
export const FISCAL_SIGNING_MATERIAL_MISSING_CERTIFICATE_MESSAGE =
  "The PKCS#12 container has no certificate.";
export const FISCAL_SIGNING_MATERIAL_AMBIGUOUS_CERTIFICATE_MESSAGE =
  "The PKCS#12 container holds more than one certificate; load the signing certificate alone.";
export const FISCAL_SIGNING_MATERIAL_UNSUPPORTED_KEY_MESSAGE =
  "The PKCS#12 signing key is unsupported.";
export const FISCAL_SIGNING_MATERIAL_KEY_CERTIFICATE_MISMATCH_MESSAGE =
  "The PKCS#12 private key does not match the certificate in the container.";
export const FISCAL_SIGNING_MATERIAL_CERTIFICATE_NOT_YET_VALID_MESSAGE =
  "The PKCS#12 certificate is not valid yet.";
export const FISCAL_SIGNING_MATERIAL_CERTIFICATE_EXPIRED_MESSAGE =
  "The PKCS#12 certificate has expired.";

/**
 * One operator-facing message per extraction failure. Typed as an exhaustive
 * record over the failure union, so adding a failure reason without a message is
 * a compile error rather than a runtime surprise.
 */
const EXTRACTION_MESSAGES: Record<Pkcs12ExtractionFailure, string> = {
  INVALID_CONTAINER: FISCAL_SIGNING_MATERIAL_INVALID_CONTAINER_MESSAGE,
  INVALID_PASSWORD: FISCAL_SIGNING_MATERIAL_INVALID_PASSWORD_MESSAGE,
  MISSING_CERTIFICATE: FISCAL_SIGNING_MATERIAL_MISSING_CERTIFICATE_MESSAGE,
  AMBIGUOUS_CERTIFICATE: FISCAL_SIGNING_MATERIAL_AMBIGUOUS_CERTIFICATE_MESSAGE,
  UNSUPPORTED_KEY: FISCAL_SIGNING_MATERIAL_UNSUPPORTED_KEY_MESSAGE,
  KEY_CERTIFICATE_MISMATCH: FISCAL_SIGNING_MATERIAL_KEY_CERTIFICATE_MISMATCH_MESSAGE,
  CERTIFICATE_NOT_YET_VALID: FISCAL_SIGNING_MATERIAL_CERTIFICATE_NOT_YET_VALID_MESSAGE,
  CERTIFICATE_EXPIRED: FISCAL_SIGNING_MATERIAL_CERTIFICATE_EXPIRED_MESSAGE,
};

/**
 * The only projection this aggregate ever returns.
 *
 * Metadata only: no `credentialRef`, no certificate PEM, no private key and no
 * password. Exported as a mapper so the HTTP layer cannot invent a second
 * projection and leak one of them by accident.
 */
export interface FiscalSigningMaterialView {
  id: string;
  environment: FiscalSigningEnvironment;
  status: "ACTIVE" | "RETIRED";
  certificateSubject: string;
  certificateSerial: string;
  certificateFingerprintSha256: string;
  keyAlgorithm: string;
  notBefore: Date;
  notAfter: Date;
  createdAt: Date;
  retiredAt: Date | null;
}

export function toSigningMaterialView(row: FiscalSigningMaterialRow): FiscalSigningMaterialView {
  return {
    id: row.id,
    environment: row.environment,
    status: row.status,
    certificateSubject: row.certificateSubject,
    certificateSerial: row.certificateSerial,
    certificateFingerprintSha256: row.certificateFingerprintSha256,
    keyAlgorithm: row.keyAlgorithm,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt,
  };
}

/**
 * Loads, lists and retires a tenant's SIFEN signing material.
 *
 * Gate order matches the rest of the Fiscal boundary: the `fiscal` entitlement
 * first, then `fiscal.signing_material.manage`. Every write is one transaction
 * that spans the aggregate row, the stored secret and the audit row, so a
 * retired material can never leave a live key behind and an unaudited write is
 * structurally impossible.
 */
@Injectable()
export class FiscalSigningMaterialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalSigningMaterialClient,
    private readonly repository: FiscalSigningMaterialRepository,
    private readonly context: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly entitlements: EntitlementsService,
    private readonly permissionResolver: PermissionResolver,
    @Inject(SECRET_STORE) private readonly secretStore: SecretStore,
    /**
     * FISC-011 WU-G: the upload is the other place the profile's RUC obligation
     * can be broken, because the operator may configure the profile before the
     * certificate exists. It reads the profile only; nothing here writes one.
     */
    private readonly profileRepository: FiscalProfileRepository
  ) {}

  /** Tenant-scoped, metadata-only, unaudited — mirroring the Fiscal read contract. */
  async list(): Promise<FiscalSigningMaterialView[]> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const rows = await this.repository.list();
    return rows.map(toSigningMaterialView);
  }

  /**
   * Loads a material and, when one is already active for the same environment,
   * rotates: the previous row is retired **and its stored key destroyed in the
   * same transaction** (ADR-005/D5, D6). An out-of-service material therefore
   * never keeps a usable private key.
   */
  async upload(args: {
    environment: FiscalSigningEnvironment;
    container: Uint8Array;
    password: string;
  }): Promise<FiscalSigningMaterialView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();

    // Parsing happens outside any transaction: it is CPU work over an untrusted
    // file, and holding a database transaction across it would be waste.
    const extracted = await this.extract(args.container, args.password);

    // The other half of the RUC obligation ([[FISC-011]] WU-G): a certificate
    // that disagrees with an existing profile is refused here, so an onboarding
    // that configures the profile first cannot end with a material that would
    // sign as a different taxpayer.
    const profile = await this.profileRepository.findProfile();
    if (profile !== null) {
      assertProfileRucMatchesCertificates({ profile, materials: [extracted] });
    }

    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();
    const credentialRef = createOpaqueSecretKey(SECRET_KEY_PREFIXES.fiscalSigningKey);

    const row = await this.prisma.$transaction(async (tx) => {
      const active = await this.repository.findActive(args.environment, tx);
      if (active) {
        await this.repository.retireIfActive(
          {
            id: active.id,
            retiredAt: new Date(),
            retiredByUserProfileId: actorUserProfileId,
            retirementReason: FISCAL_SIGNING_MATERIAL_ROTATION_REASON,
          },
          tx
        );
        await this.secretStore.delete({ tenantId, key: active.credentialRef, tx });
      }

      await this.secretStore.put({
        tenantId,
        key: credentialRef,
        value: extracted.privateKeyPem,
        tx,
      });

      const created = await this.repository.create(
        {
          environment: args.environment,
          status: "ACTIVE",
          credentialRef,
          certificatePem: extracted.certificatePem,
          certificateSubject: extracted.certificateSubject,
          certificateSerial: extracted.certificateSerial,
          certificateFingerprintSha256: extracted.certificateFingerprintSha256,
          keyAlgorithm: extracted.keyAlgorithm,
          notBefore: extracted.notBefore,
          notAfter: extracted.notAfter,
          uploadedByUserProfileId: actorUserProfileId,
          retiredAt: null,
          retiredByUserProfileId: null,
          retirementReason: null,
        },
        tx
      );

      await this.audit.append(
        {
          action: FISCAL_SIGNING_MATERIAL_UPLOAD_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: "fiscal_signing_material",
          targetId: created.id,
          metadata: {
            schemaVersion: 1,
            environment: created.environment,
            certificateSerial: created.certificateSerial,
            certificateFingerprintSha256: created.certificateFingerprintSha256,
          },
        },
        tx
      );

      return created;
    });

    return toSigningMaterialView(row);
  }

  /**
   * Takes a material out of service. Retirement is an explicit operation, not a
   * delete: the row survives as the record, and the stored private key is
   * destroyed in the same transaction.
   */
  async retire(args: { id: string; reason: string }): Promise<FiscalSigningMaterialView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();

    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const found = await this.repository.findById(args.id, tx);
      if (!found) {
        // Unknown and foreign ids are indistinguishable on purpose.
        throw new DomainError("NOT_FOUND", FISCAL_SIGNING_MATERIAL_NOT_FOUND_MESSAGE);
      }

      const retiredAt = new Date();
      const retired = await this.repository.retireIfActive(
        {
          id: found.id,
          retiredAt,
          retiredByUserProfileId: actorUserProfileId,
          retirementReason: args.reason,
        },
        tx
      );
      if (retired === 0) {
        throw new DomainError("CONFLICT", FISCAL_SIGNING_MATERIAL_ALREADY_RETIRED_MESSAGE);
      }

      await this.secretStore.delete({ tenantId, key: found.credentialRef, tx });

      await this.audit.append(
        {
          action: FISCAL_SIGNING_MATERIAL_RETIRE_ACTION,
          tenantId,
          actorUserProfileId,
          targetType: "fiscal_signing_material",
          targetId: found.id,
          metadata: {
            schemaVersion: 1,
            environment: found.environment,
            certificateSerial: found.certificateSerial,
            reason: args.reason,
          },
        },
        tx
      );

      return {
        ...found,
        status: "RETIRED" as const,
        retiredAt,
        retiredByUserProfileId: actorUserProfileId,
        retirementReason: args.reason,
      };
    });

    return toSigningMaterialView(row);
  }

  private async extract(
    container: Uint8Array,
    password: string
  ): Promise<ExtractedSigningMaterial> {
    try {
      return await extractSigningMaterial({ container, password });
    } catch (error) {
      if (error instanceof Pkcs12ExtractionError) {
        throw new DomainError("VALIDATION_FAILED", EXTRACTION_MESSAGES[error.failure]);
      }
      throw error;
    }
  }

  private async assertFiscalEnabled(): Promise<void> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "fiscal"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", FISCAL_FEATURE_NOT_ENTITLED_MESSAGE);
    }
  }

  private async requirePermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(FISCAL_PERMISSIONS.signingMaterialManage)) {
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
    }
  }
}
