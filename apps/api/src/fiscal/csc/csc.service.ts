import { Inject, Injectable } from "@nestjs/common";
import { PrismaService, type Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import {
  createOpaqueSecretKey,
  SECRET_KEY_PREFIXES,
  SECRET_STORE,
  type SecretRecordClient,
  type SecretStore,
} from "@newsaas/secret-store";
import { AuditWriter, type AuditAppendTx } from "../../audit/audit-writer.service.js";
import { RequestContextService } from "../../context/request-context.service.js";
import { EntitlementsService } from "../../entitlements/entitlements.service.js";
import { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import { FISCAL_FEATURE_NOT_ENTITLED_MESSAGE } from "../fiscal.service.js";

type CscWriteTx = Pick<Prisma.TransactionClient, "tenantFiscalCsc"> &
  SecretRecordClient &
  AuditAppendTx;

interface CscClient {
  tenantFiscalCsc: Prisma.TransactionClient["tenantFiscalCsc"];
  $transaction<T>(
    work: (tx: CscWriteTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" }
  ): Promise<T>;
}

type Environment = "TEST" | "PRODUCTION";

export const FISCAL_CSC_LOAD_ACTION = "fiscal.csc.loaded";
export const FISCAL_CSC_RETIRE_ACTION = "fiscal.csc.retired";
export const FISCAL_CSC_NOT_FOUND_MESSAGE = "CSC was not found.";
export const FISCAL_CSC_ALREADY_RETIRED_MESSAGE = "CSC is already retired.";
export const FISCAL_CSC_ALREADY_ACTIVE_MESSAGE =
  "A CSC with this identifier is already active in this environment.";
export const FISCAL_CSC_TWO_ACTIVE_MESSAGE =
  "Two CSCs are already active in this environment; retire one first.";
export const FISCAL_CSC_CONCURRENT_CHANGE_MESSAGE =
  "Another operation changed the CSCs at the same time; refresh and try again.";

/** The partial unique index `(tenant_id, environment, id_csc) WHERE status = 'ACTIVE'`. */
const ONE_ACTIVE_PER_ID_INDEX = "tenant_fiscal_csc_one_active_per_id_key";
const ONE_ACTIVE_PER_ID_FIELDS: readonly string[] = ["tenantid", "environment", "idcsc"];
/** What the `tenant_fiscal_csc_at_most_two_active` trigger raises (SQLSTATE 23001). */
const TWO_ACTIVE_TRIGGER_SIGNALS: readonly string[] = [
  "tenant_fiscal_csc_at_most_two_active",
  "two ACTIVE CSCs",
];

export interface CscMetadata {
  id: string;
  environment: Environment;
  idCsc: string;
  status: "ACTIVE" | "RETIRED";
  createdAt: Date;
  retiredAt: Date | null;
  retirementReason: string | null;
}

/** Explicit allowlist: never return a Prisma row or its opaque secret reference. */
function metadata(row: CscMetadata): CscMetadata {
  return {
    id: row.id,
    environment: row.environment,
    idCsc: row.idCsc,
    status: row.status,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt,
    retirementReason: row.retirementReason,
  };
}

function normalize(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isDuplicateActiveId(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  const tokens = (Array.isArray(target) ? target : [target])
    .filter((token): token is string => typeof token === "string")
    .map(normalize);
  if (tokens.length === 1 && tokens[0] === normalize(ONE_ACTIVE_PER_ID_INDEX)) return true;
  return (
    tokens.length === ONE_ACTIVE_PER_ID_FIELDS.length &&
    ONE_ACTIVE_PER_ID_FIELDS.every((field) => tokens.includes(field))
  );
}

function isTwoActiveTrigger(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { message?: unknown; meta?: { message?: unknown } };
  return [candidate.message, candidate.meta?.message]
    .filter((signal): signal is string => typeof signal === "string")
    .some((signal) => TWO_ACTIVE_TRIGGER_SIGNALS.some((expected) => signal.includes(expected)));
}

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034"
  );
}

/**
 * Loads, lists and retires a tenant's SIFEN CSCs (FISC-019).
 *
 * Mirrors the signing material: the `fiscal` entitlement first, then
 * `fiscal.signing_material.manage`; every write is one transaction spanning the
 * row, the sealed value in `tenant_secret` and the audit row. The two SIFEN
 * bounds (one ACTIVE row per identifier, at most two ACTIVE per environment)
 * are the database's: the row is inserted BEFORE the value is stored, so a
 * refused insert never reaches the secret store, and SERIALIZABLE closes the
 * READ COMMITTED window the migration records for the counting trigger.
 *
 * The value is RESTRICTED: it reaches only `SecretStore.put`. It is never
 * returned, audited, logged or interpolated into an error.
 */
@Injectable()
export class FiscalCscService {
  constructor(
    @Inject(PrismaService) private readonly prisma: CscClient,
    private readonly context: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionResolver,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore
  ) {}

  /** Tenant-scoped, metadata-only, unaudited — the Fiscal read contract. */
  async list(): Promise<CscMetadata[]> {
    await this.authorize();
    const rows = await this.prisma.tenantFiscalCsc.findMany({
      where: { tenantId: this.context.requireTenantId() },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(metadata);
  }

  async load(input: {
    environment: Environment;
    idCsc: string;
    value: string;
  }): Promise<CscMetadata> {
    await this.authorize();
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();
    const secretRef = createOpaqueSecretKey(SECRET_KEY_PREFIXES.fiscalCsc);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const row = await tx.tenantFiscalCsc.create({
            data: {
              tenantId,
              environment: input.environment,
              idCsc: input.idCsc,
              status: "ACTIVE",
              secretRef,
              uploadedByUserProfileId: actorUserProfileId,
            },
          });
          await this.secrets.put({ tenantId, key: secretRef, value: input.value, tx });
          await this.audit.append(
            {
              tenantId,
              actorUserProfileId,
              action: FISCAL_CSC_LOAD_ACTION,
              targetType: "fiscal_csc",
              targetId: row.id,
              metadata: { environment: row.environment, idCsc: row.idCsc },
            },
            tx
          );
          return metadata(row);
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      // Stable messages only: a database error is never interpolated.
      if (isDuplicateActiveId(error)) {
        throw new DomainError("CONFLICT", FISCAL_CSC_ALREADY_ACTIVE_MESSAGE);
      }
      if (isTwoActiveTrigger(error)) {
        throw new DomainError("CONFLICT", FISCAL_CSC_TWO_ACTIVE_MESSAGE);
      }
      if (isSerializationFailure(error)) {
        throw new DomainError("CONFLICT", FISCAL_CSC_CONCURRENT_CHANGE_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Takes a CSC out of service: the row survives as the record and the sealed
   * value is destroyed in the same transaction. Unknown and foreign ids are
   * indistinguishable on purpose.
   */
  async retire(input: { id: string; reason: string }): Promise<CscMetadata> {
    await this.authorize();
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.tenantFiscalCsc.findFirst({ where: { tenantId, id: input.id } });
      if (!row) throw new DomainError("NOT_FOUND", FISCAL_CSC_NOT_FOUND_MESSAGE);
      const retiredAt = new Date();
      const result = await tx.tenantFiscalCsc.updateMany({
        where: { tenantId, id: row.id, status: "ACTIVE" },
        data: {
          status: "RETIRED",
          retiredAt,
          retiredByUserProfileId: actorUserProfileId,
          retirementReason: input.reason,
        },
      });
      if (result.count === 0) throw new DomainError("CONFLICT", FISCAL_CSC_ALREADY_RETIRED_MESSAGE);
      await this.secrets.delete({ tenantId, key: row.secretRef, tx });
      await this.audit.append(
        {
          tenantId,
          actorUserProfileId,
          action: FISCAL_CSC_RETIRE_ACTION,
          targetType: "fiscal_csc",
          targetId: row.id,
          metadata: { environment: row.environment, idCsc: row.idCsc },
        },
        tx
      );
      return metadata({ ...row, status: "RETIRED", retiredAt, retirementReason: input.reason });
    });
  }

  private async authorize(): Promise<void> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "fiscal"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", FISCAL_FEATURE_NOT_ENTITLED_MESSAGE);
    }
    const granted = await this.permissions.resolveForActiveRequest();
    if (!granted.has(FISCAL_PERMISSIONS.signingMaterialManage)) {
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
    }
  }
}
