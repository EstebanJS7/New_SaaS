import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../../context/request-context.service.js";
import type { AuditAppendTx } from "../../audit/audit-writer.service.js";

/**
 * FISC-011 WU-E — tenant-scoped persistence for the emitter profile, its
 * establishments and the authorised numbering ranges.
 *
 * The tenant always comes from the authenticated server context, never from a
 * caller-supplied value, so a foreign id can only ever produce "not found" — the
 * same rule the signing-material repository follows.
 *
 * **The rows are returned whole and mapped by the service.** A read path that
 * projected columns here would put the DE's field mapping in two places, and the
 * assembly in `packages/fiscal` is the one that owns it.
 */

/** One row of `fiscal_emitter_profile`. */
export interface EmitterProfileRow {
  id: string;
  tenantId: string;
  ruc: string;
  checkDigit: string;
  taxpayerType: number;
  regimeCode: number | null;
  legalName: string;
  tradeName: string | null;
  responsibleIssuerType: number | null;
  responsibleIssuerTypeName: string | null;
  responsibleIssuerId: string | null;
  responsibleIssuerName: string | null;
  responsibleIssuerRole: string | null;
  transactionType: number | null;
  taxType: number;
  emissionType: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One row of `fiscal_emitter_activity`. */
export interface EmitterActivityRow {
  id: string;
  tenantId: string;
  profileId: string;
  position: number;
  code: string;
  description: string;
}

/** One row of `fiscal_establishment`. */
export interface EstablishmentRow {
  id: string;
  tenantId: string;
  code: string;
  addressLine: string;
  houseNumber: number;
  addressComplement1: string | null;
  addressComplement2: string | null;
  departmentCode: number;
  districtCode: number | null;
  districtName: string | null;
  cityCode: number;
  cityName: string;
  phone: string;
  email: string;
  branchName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One row of `fiscal_timbrado_range`. */
export interface TimbradoRangeRow {
  id: string;
  tenantId: string;
  establishmentId: string;
  expeditionPoint: string;
  documentType: number;
  series: string | null;
  timbradoNumber: string;
  rangeFrom: number;
  rangeTo: number;
  validityStart: Date;
  nextNumber: number;
  seriesStartedAt: Date | null;
  status: "ACTIVE" | "EXHAUSTED" | "RETIRED";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The delegate surface the repository needs, declared structurally so a test can
 * pass a fake — the same shape `FiscalSigningMaterialDelegate` uses.
 */
export interface FiscalProfileDelegate {
  fiscalEmitterProfile: {
    findUnique(args: {
      where: { tenantId: string };
      include: { activities: { orderBy: { position: "asc" } } };
    }): Promise<(EmitterProfileRow & { activities: EmitterActivityRow[] }) | null>;
    create(args: { data: Record<string, unknown> }): Promise<EmitterProfileRow>;
    update(args: {
      where: { tenantId: string };
      data: Record<string, unknown>;
    }): Promise<EmitterProfileRow>;
  };
  fiscalEmitterActivity: {
    deleteMany(args: {
      where: { tenantId: string; profileId: string };
    }): Promise<{ count: number }>;
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  fiscalEstablishment: {
    findMany(args: {
      where: { tenantId: string };
      orderBy: { code: "asc" };
    }): Promise<EstablishmentRow[]>;
    findFirst(args: {
      where: { tenantId: string; id?: string; code?: string };
    }): Promise<EstablishmentRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<EstablishmentRow>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<EstablishmentRow>;
  };
  fiscalTimbradoRange: {
    findMany(args: {
      where: { tenantId: string };
      orderBy: [{ establishmentId: "asc" }, { documentType: "asc" }, { series: "asc" }];
    }): Promise<TimbradoRangeRow[]>;
    findFirst(args: { where: { tenantId: string; id: string } }): Promise<TimbradoRangeRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<TimbradoRangeRow>;
    updateMany(args: {
      where: { id: string; tenantId: string; status: "ACTIVE" };
      data: { status: "RETIRED" };
    }): Promise<{ count: number }>;
  };
}

export interface FiscalProfileTx {
  fiscalEmitterProfile: FiscalProfileDelegate["fiscalEmitterProfile"];
  fiscalEmitterActivity: FiscalProfileDelegate["fiscalEmitterActivity"];
  fiscalEstablishment: FiscalProfileDelegate["fiscalEstablishment"];
  fiscalTimbradoRange: FiscalProfileDelegate["fiscalTimbradoRange"];
}

export type FiscalProfileWriteTx = FiscalProfileTx & {
  auditLog: AuditAppendTx["auditLog"];
};

export interface FiscalProfileClient extends FiscalProfileDelegate {
  auditLog: AuditAppendTx["auditLog"];
  $transaction: <T>(work: (tx: FiscalProfileWriteTx) => Promise<T>) => Promise<T>;
}

@Injectable()
export class FiscalProfileRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalProfileClient,
    private readonly context: RequestContextService
  ) {}

  /** The tenant's profile with its activities, or null. One per tenant. */
  async findProfile(
    tx: FiscalProfileTx = this.prisma
  ): Promise<(EmitterProfileRow & { activities: EmitterActivityRow[] }) | null> {
    return tx.fiscalEmitterProfile.findUnique({
      where: { tenantId: this.context.requireTenantId() },
      include: { activities: { orderBy: { position: "asc" } } },
    });
  }

  async listEstablishments(tx: FiscalProfileTx = this.prisma): Promise<EstablishmentRow[]> {
    return tx.fiscalEstablishment.findMany({
      where: { tenantId: this.context.requireTenantId() },
      orderBy: { code: "asc" },
    });
  }

  async findEstablishment(
    where: { id: string } | { code: string },
    tx: FiscalProfileTx = this.prisma
  ): Promise<EstablishmentRow | null> {
    return tx.fiscalEstablishment.findFirst({
      where: { tenantId: this.context.requireTenantId(), ...where },
    });
  }

  async listRanges(tx: FiscalProfileTx = this.prisma): Promise<TimbradoRangeRow[]> {
    return tx.fiscalTimbradoRange.findMany({
      where: { tenantId: this.context.requireTenantId() },
      orderBy: [{ establishmentId: "asc" }, { documentType: "asc" }, { series: "asc" }],
    });
  }

  async findRange(id: string, tx: FiscalProfileTx = this.prisma): Promise<TimbradoRangeRow | null> {
    return tx.fiscalTimbradoRange.findFirst({
      where: { tenantId: this.context.requireTenantId(), id },
    });
  }

  async createEstablishment(
    data: Omit<EstablishmentRow, "id" | "tenantId" | "createdAt" | "updatedAt">,
    tx: FiscalProfileTx
  ): Promise<EstablishmentRow> {
    return tx.fiscalEstablishment.create({
      data: { ...data, tenantId: this.context.requireTenantId() },
    });
  }

  async updateEstablishment(
    id: string,
    data: Partial<Omit<EstablishmentRow, "id" | "tenantId" | "createdAt" | "updatedAt">>,
    tx: FiscalProfileTx
  ): Promise<EstablishmentRow> {
    // `updateMany`-shaped CAS is not needed here: the row was read in this
    // transaction, and the tenant is in the `where` of the read that found it.
    return tx.fiscalEstablishment.update({
      where: { id },
      data: { ...data, tenantId: this.context.requireTenantId() },
    });
  }

  async createRange(
    data: Omit<TimbradoRangeRow, "id" | "tenantId" | "createdAt" | "updatedAt">,
    tx: FiscalProfileTx
  ): Promise<TimbradoRangeRow> {
    return tx.fiscalTimbradoRange.create({
      data: { ...data, tenantId: this.context.requireTenantId() },
    });
  }

  /**
   * Retires a range **only if it is still ACTIVE**, so a range already exhausted
   * or retired cannot be retired twice and the caller learns which happened.
   */
  async retireRangeIfActive(id: string, tx: FiscalProfileTx): Promise<number> {
    const result = await tx.fiscalTimbradoRange.updateMany({
      where: { id, tenantId: this.context.requireTenantId(), status: "ACTIVE" },
      data: { status: "RETIRED" },
    });
    return result.count;
  }

  /** The profile and its activities, written together: activities are replaced. */
  async upsertProfile(
    data: Omit<EmitterProfileRow, "id" | "tenantId" | "createdAt" | "updatedAt">,
    activities: readonly { code: string; description: string }[],
    tx: FiscalProfileTx
  ): Promise<EmitterProfileRow> {
    const tenantId = this.context.requireTenantId();
    const existing = await tx.fiscalEmitterProfile.findUnique({
      where: { tenantId },
      include: { activities: { orderBy: { position: "asc" } } },
    });

    const row =
      existing === null
        ? await tx.fiscalEmitterProfile.create({ data: { ...data, tenantId } })
        : await tx.fiscalEmitterProfile.update({
            where: { tenantId },
            data: { ...data, tenantId },
          });

    // Replaced wholesale rather than diffed: `gActEco` is an ordered list the DE
    // carries verbatim, so a partial update would leave a position gap.
    await tx.fiscalEmitterActivity.deleteMany({ where: { tenantId, profileId: row.id } });
    if (activities.length > 0) {
      await tx.fiscalEmitterActivity.createMany({
        data: activities.map((activity, position) => ({
          tenantId,
          profileId: row.id,
          position,
          code: activity.code,
          description: activity.description,
        })),
      });
    }
    return row;
  }
}
