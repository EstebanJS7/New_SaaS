import { DomainError } from "@newsaas/shared";
import { AuditAppendTx, AuditWriter } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { CLINICAL_DTO_SCHEMA_VERSION } from "./clinical.dto.js";

/** Read-only Patient view used to prove tenant ownership before anchoring. */
export interface ClinicalPatientDelegate {
  findFirst: (args: {
    where: { id: string; tenantId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
}

/** Audit descriptor for one clinical mutation; stable IDs and field names only. */
export interface RecordAudit {
  action: string;
  targetType: string;
  targetId: string;
  changedFields: string[];
  metadata?: Record<string, unknown>;
}

/** Minimal Prisma surface shared by every clinical application boundary. */
export interface ClinicalBasePrisma {
  patient: ClinicalPatientDelegate;
}

/**
 * Shared clinical application boundary (EPIC-06, WU2A).
 *
 * - Tenant identity comes exclusively from `RequestContextService`; a foreign
 *   Patient UUID surfaces as a byte-equivalent 404.
 * - Every operation re-applies the `veterinary` entitlement (403
 *   `FEATURE_NOT_ENTITLED`) and its granular `vet.clinical.*` permission (403
 *   `FORBIDDEN`) as defense in depth; WU3 routes declare the same permissions.
 * - Every mutation appends exactly one audit row co-committed in the SAME
 *   transaction, carrying stable IDs and field names only — never free text.
 *
 * The encounter boundary (WU2A) and the specialized-records boundary (WU2B)
 * both extend this class so tenant, entitlement, permission and audit behavior
 * stay identical and are defined exactly once.
 */
export abstract class ClinicalServiceBase<TPrisma extends ClinicalBasePrisma> {
  protected constructor(
    protected readonly prisma: TPrisma,
    protected readonly requestContext: RequestContextService,
    protected readonly entitlements: EntitlementsService,
    protected readonly permissionResolver: PermissionResolver,
    protected readonly audit: AuditWriter
  ) {}

  /**
   * Resolves the server-owned tenant and re-applies the `veterinary`
   * entitlement; `FEATURE_NOT_ENTITLED` (403) is the only rejection path.
   */
  protected async requireTenantContext(): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "veterinary"))) {
      throw new DomainError(
        "FEATURE_NOT_ENTITLED",
        "Veterinary features are not enabled for this tenant."
      );
    }
    return tenantId;
  }

  /**
   * Defense-in-depth permission gate for non-HTTP callers and forgotten route
   * metadata; WU3 routes declare the same `vet.clinical.*` keys.
   */
  protected async requirePermission(key: string): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(key)) {
      throw new DomainError("FORBIDDEN", "The required clinical permission is missing.");
    }
  }

  protected async assertPatient(tenantId: string, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
      select: { id: true },
    });
    if (!patient) {
      throw new DomainError("NOT_FOUND", "Patient was not found.");
    }
  }

  /** One co-committed audit row per mutation; stable IDs and field names only. */
  protected async appendAudit(
    tx: AuditAppendTx,
    descriptor: RecordAudit,
    tenantId: string,
    actorUserProfileId: string
  ): Promise<void> {
    await this.audit.append(
      {
        action: descriptor.action,
        tenantId,
        actorUserProfileId,
        targetType: descriptor.targetType,
        targetId: descriptor.targetId,
        metadata: {
          schemaVersion: CLINICAL_DTO_SCHEMA_VERSION,
          changedFields: descriptor.changedFields,
          ...(descriptor.metadata ?? {}),
        },
      },
      tx
    );
  }
}
