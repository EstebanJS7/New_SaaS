import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import type { SecretRecordClient } from "@newsaas/secret-store";
import { RequestContextService } from "../../context/request-context.service.js";
import type { AuditAppendTx } from "../../audit/audit-writer.service.js";
import type { FiscalSigningEnvironment } from "./signing-material.service.js";

export const FISCAL_SIGNING_MATERIAL_NOT_FOUND_MESSAGE = "Signing material was not found.";

export interface FiscalSigningMaterialRow {
  id: string;
  tenantId: string;
  environment: FiscalSigningEnvironment;
  status: "ACTIVE" | "RETIRED";
  credentialRef: string;
  certificatePem: string;
  certificateSubject: string;
  certificateSerial: string;
  certificateFingerprintSha256: string;
  keyAlgorithm: string;
  notBefore: Date;
  notAfter: Date;
  uploadedByUserProfileId: string | null;
  retiredAt: Date | null;
  retiredByUserProfileId: string | null;
  retirementReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The delegate surface the repository itself needs. */
export interface FiscalSigningMaterialDelegate {
  create(args: {
    data: Omit<FiscalSigningMaterialRow, "id" | "createdAt" | "updatedAt">;
  }): Promise<FiscalSigningMaterialRow>;
  findFirst(args: {
    where: {
      tenantId: string;
      id?: string;
      environment?: FiscalSigningEnvironment;
      status?: "ACTIVE" | "RETIRED";
    };
  }): Promise<FiscalSigningMaterialRow | null>;
  findMany(args: {
    where: { tenantId: string };
    orderBy: { createdAt: "desc" };
  }): Promise<FiscalSigningMaterialRow[]>;
  updateMany(args: {
    where: { tenantId: string; id: string; status: "ACTIVE" };
    data: {
      status: "RETIRED";
      retiredAt: Date;
      retiredByUserProfileId: string | null;
      retirementReason: string;
    };
  }): Promise<{ count: number }>;
}

/**
 * A read-only handle: just the aggregate's own delegate.
 *
 * The commands thread a {@link FiscalSigningMaterialWriteTx} instead, which adds
 * the secret-store delegate and the audit delegate. Keeping the two apart means
 * a read path cannot accidentally be handed a write surface.
 */
export interface FiscalSigningMaterialTx {
  tenantFiscalSigningMaterial: FiscalSigningMaterialDelegate;
}

/**
 * The transaction handle a command threads through the secret store and the
 * audit writer. It composes the three structural surfaces the command needs —
 * the same composition `FiscalWriteTx` performs — so the Prisma transaction
 * client satisfies all three without a cast.
 */
export type FiscalSigningMaterialWriteTx = FiscalSigningMaterialTx &
  SecretRecordClient & { auditLog: AuditAppendTx["auditLog"] };

export interface FiscalSigningMaterialClient {
  tenantFiscalSigningMaterial: FiscalSigningMaterialDelegate;
  tenantSecret: SecretRecordClient["tenantSecret"];
  auditLog: AuditAppendTx["auditLog"];
  $transaction: <T>(work: (tx: FiscalSigningMaterialWriteTx) => Promise<T>) => Promise<T>;
}

/**
 * Tenant-scoped persistence for the signing-material aggregate.
 *
 * The tenant always comes from the authenticated server context, never from a
 * caller-supplied value, so a foreign id can only ever produce "not found".
 */
@Injectable()
export class FiscalSigningMaterialRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalSigningMaterialClient,
    private readonly context: RequestContextService
  ) {}

  async list(): Promise<FiscalSigningMaterialRow[]> {
    return this.prisma.tenantFiscalSigningMaterial.findMany({
      where: { tenantId: this.context.requireTenantId() },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(
    id: string,
    tx: FiscalSigningMaterialTx = this.prisma
  ): Promise<FiscalSigningMaterialRow | null> {
    return tx.tenantFiscalSigningMaterial.findFirst({
      where: { tenantId: this.context.requireTenantId(), id },
    });
  }

  async findActive(
    environment: FiscalSigningEnvironment,
    tx: FiscalSigningMaterialTx
  ): Promise<FiscalSigningMaterialRow | null> {
    return tx.tenantFiscalSigningMaterial.findFirst({
      where: { tenantId: this.context.requireTenantId(), environment, status: "ACTIVE" },
    });
  }

  async create(
    data: Omit<FiscalSigningMaterialRow, "id" | "tenantId" | "createdAt" | "updatedAt">,
    tx: FiscalSigningMaterialTx
  ): Promise<FiscalSigningMaterialRow> {
    return tx.tenantFiscalSigningMaterial.create({
      data: { ...data, tenantId: this.context.requireTenantId() },
    });
  }

  /**
   * Compare-and-set: retires only a row the caller observed as `ACTIVE` and that
   * still is. A zero count means the caller lost the race and the material was
   * already retired, which the caller must report rather than overwrite.
   */
  async retireIfActive(
    args: {
      id: string;
      retiredAt: Date;
      retiredByUserProfileId: string | null;
      retirementReason: string;
    },
    tx: FiscalSigningMaterialTx
  ): Promise<number> {
    const result = await tx.tenantFiscalSigningMaterial.updateMany({
      where: { id: args.id, tenantId: this.context.requireTenantId(), status: "ACTIVE" },
      data: {
        status: "RETIRED",
        retiredAt: args.retiredAt,
        retiredByUserProfileId: args.retiredByUserProfileId,
        retirementReason: args.retirementReason,
      },
    });
    return result.count;
  }
}
