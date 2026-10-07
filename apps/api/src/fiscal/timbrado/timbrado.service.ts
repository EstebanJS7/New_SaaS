import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter } from "../../audit/audit-writer.service.js";
import { RequestContextService } from "../../context/request-context.service.js";
import { EntitlementsService } from "../../entitlements/entitlements.service.js";
import { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import {
  type EmitterProfileRow,
  type EstablishmentRow,
  type FiscalProfileClient,
  FiscalProfileRepository,
  type TimbradoRangeRow,
} from "./timbrado.repository.js";

export const FISCAL_FEATURE_NOT_ENTITLED_MESSAGE =
  "The fiscal capability is not enabled for this tenant.";
export const FISCAL_PROFILE_NOT_FOUND_MESSAGE = "The emitter fiscal profile was not found.";
export const FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE = "The establishment was not found.";
export const FISCAL_RANGE_NOT_FOUND_MESSAGE = "The timbrado range was not found.";

export const FISCAL_PROFILE_SAVED_ACTION = "fiscal.profile.saved";
export const FISCAL_ESTABLISHMENT_SAVED_ACTION = "fiscal.establishment.saved";
export const FISCAL_RANGE_CREATED_ACTION = "fiscal.timbrado_range.created";
export const FISCAL_RANGE_RETIRED_ACTION = "fiscal.timbrado_range.retired";

/** What the routes return for a profile. */
export interface EmitterProfileView {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: readonly { code: string; description: string }[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EstablishmentView {
  readonly id: string;
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly cityCode: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TimbradoRangeView {
  readonly id: string;
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly timbradoNumber: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: Date;
  readonly nextNumber: number;
  readonly status: TimbradoRangeRow["status"];
}

export interface SaveProfileInput {
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly responsibleIssuerType: number | null;
  readonly responsibleIssuerTypeName: string | null;
  readonly responsibleIssuerId: string | null;
  readonly responsibleIssuerName: string | null;
  readonly responsibleIssuerRole: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
  readonly activities: readonly { code: string; description: string }[];
}

export interface SaveEstablishmentInput {
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly addressComplement1: string | null;
  readonly addressComplement2: string | null;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly districtName: string | null;
  readonly cityCode: number;
  readonly cityName: string;
  readonly phone: string;
  readonly email: string;
  readonly branchName: string | null;
}

export interface CreateRangeInput {
  readonly establishmentId: string;
  readonly expeditionPoint: string;
  readonly documentType: number;
  readonly series: string | null;
  readonly timbradoNumber: string;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  readonly validityStart: Date;
}

/**
 * The operator-facing surface for the emitter profile and its numbering ranges.
 *
 * Gate order matches the rest of the Fiscal boundary: the `fiscal` entitlement
 * first, then `fiscal.profile.manage`. Every write is one transaction spanning
 * the rows and the audit row, so an unaudited change is structurally impossible.
 *
 * **Nothing here allocates a number.** The allocation is
 * `allocateDocumentNumber` over the Prisma store, and it is deliberately not a
 * route: exposing it would let a caller burn numbers without issuing anything.
 */
@Injectable()
export class FiscalProfileService {
  constructor(
    @Inject(PrismaService) private readonly prisma: FiscalProfileClient,
    private readonly repository: FiscalProfileRepository,
    private readonly context: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly entitlements: EntitlementsService,
    private readonly permissionResolver: PermissionResolver
  ) {}

  async getProfile(): Promise<EmitterProfileView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const row = await this.repository.findProfile();
    if (row === null) {
      throw new DomainError("NOT_FOUND", FISCAL_PROFILE_NOT_FOUND_MESSAGE);
    }
    return toProfileView(row, row.activities);
  }

  async listEstablishments(): Promise<EstablishmentView[]> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    return (await this.repository.listEstablishments()).map(toEstablishmentView);
  }

  async listRanges(): Promise<TimbradoRangeView[]> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    return (await this.repository.listRanges()).map(toRangeView);
  }

  async saveProfile(input: SaveProfileInput): Promise<EmitterProfileView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();
    const { activities, ...profile } = input;

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await this.repository.upsertProfile(profile, activities, tx);
      await this.audit.append(
        {
          action: FISCAL_PROFILE_SAVED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_emitter_profile",
          targetId: saved.id,
          // Field NAMES only: a profile carries a RUC and an address, and the
          // audit row is not the place for either.
          metadata: {
            schemaVersion: 1,
            fields: Object.keys(profile).sort(),
            activityCount: activities.length,
          },
        },
        tx
      );
      return saved;
    });
    // The rows the upsert just wrote, not a reconstructed shape: the stored
    // activities are what the DE would carry, in their stored order.
    return toProfileView(row, activities);
  }

  async createEstablishment(input: SaveEstablishmentInput): Promise<EstablishmentView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await this.repository.createEstablishment(input, tx);
      await this.audit.append(
        {
          action: FISCAL_ESTABLISHMENT_SAVED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_establishment",
          targetId: created.id,
          metadata: { schemaVersion: 1, code: created.code, created: true },
        },
        tx
      );
      return created;
    });
    return toEstablishmentView(row);
  }

  async updateEstablishment(id: string, input: SaveEstablishmentInput): Promise<EstablishmentView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await this.repository.findEstablishment({ id }, tx);
      if (existing === null) {
        throw new DomainError("NOT_FOUND", FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE);
      }
      const updated = await this.repository.updateEstablishment(id, input, tx);
      await this.audit.append(
        {
          action: FISCAL_ESTABLISHMENT_SAVED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_establishment",
          targetId: updated.id,
          metadata: { schemaVersion: 1, code: updated.code, created: false },
        },
        tx
      );
      return updated;
    });
    return toEstablishmentView(row);
  }

  async createRange(input: CreateRangeInput): Promise<TimbradoRangeView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const establishment = await this.repository.findEstablishment(
        { id: input.establishmentId },
        tx
      );
      if (establishment === null) {
        // A range belongs to an establishment in the SAME tenant, so a foreign
        // id is "not found" rather than a validation error.
        throw new DomainError("NOT_FOUND", FISCAL_ESTABLISHMENT_NOT_FOUND_MESSAGE);
      }
      const created = await this.repository.createRange(
        {
          establishmentId: input.establishmentId,
          expeditionPoint: input.expeditionPoint,
          documentType: input.documentType,
          series: input.series,
          timbradoNumber: input.timbradoNumber,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          validityStart: input.validityStart,
          // A new range has consumed nothing, and the series' start is set from
          // the first DE's signature date rather than from registration.
          nextNumber: input.rangeFrom,
          seriesStartedAt: null,
          status: "ACTIVE",
        },
        tx
      );
      await this.audit.append(
        {
          action: FISCAL_RANGE_CREATED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_timbrado_range",
          targetId: created.id,
          metadata: {
            schemaVersion: 1,
            timbradoNumber: created.timbradoNumber,
            expeditionPoint: created.expeditionPoint,
            documentType: created.documentType,
            series: created.series,
            rangeFrom: created.rangeFrom,
            rangeTo: created.rangeTo,
          },
        },
        tx
      );
      return created;
    });
    return toRangeView(row);
  }

  async retireRange(id: string, reason: string): Promise<TimbradoRangeView> {
    await this.assertFiscalEnabled();
    await this.requirePermission();
    const actorUserProfileId = this.context.requireUserProfileId();

    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await this.repository.findRange(id, tx);
      if (existing === null) {
        throw new DomainError("NOT_FOUND", FISCAL_RANGE_NOT_FOUND_MESSAGE);
      }
      const retired = await this.repository.retireRangeIfActive(id, tx);
      if (retired !== 1) {
        // Already exhausted or retired: the caller must not be told it worked.
        throw new DomainError("CONFLICT", "The timbrado range is not active.");
      }
      await this.audit.append(
        {
          action: FISCAL_RANGE_RETIRED_ACTION,
          tenantId: this.context.requireTenantId(),
          actorUserProfileId,
          targetType: "fiscal_timbrado_range",
          targetId: id,
          metadata: {
            schemaVersion: 1,
            reason,
            consumed: existing.nextNumber - existing.rangeFrom,
          },
        },
        tx
      );
      return { ...existing, status: "RETIRED" as const };
    });
    return toRangeView(row);
  }

  private async assertFiscalEnabled(): Promise<void> {
    const tenantId = this.context.requireTenantId();
    if (!(await this.entitlements.has(tenantId, "fiscal"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", FISCAL_FEATURE_NOT_ENTITLED_MESSAGE);
    }
  }

  private async requirePermission(): Promise<void> {
    const permissions = await this.permissionResolver.resolveForActiveRequest();
    if (!permissions.has(FISCAL_PERMISSIONS.profileManage)) {
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
    }
  }
}

function toProfileView(
  row: EmitterProfileRow,
  activities: readonly { code: string; description: string }[]
): EmitterProfileView {
  return {
    ruc: row.ruc,
    checkDigit: row.checkDigit,
    taxpayerType: row.taxpayerType,
    regimeCode: row.regimeCode,
    legalName: row.legalName,
    tradeName: row.tradeName,
    transactionType: row.transactionType,
    taxType: row.taxType,
    emissionType: row.emissionType,
    activities: activities.map(({ code, description }) => ({ code, description })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEstablishmentView(row: EstablishmentRow): EstablishmentView {
  return {
    id: row.id,
    code: row.code,
    addressLine: row.addressLine,
    houseNumber: row.houseNumber,
    departmentCode: row.departmentCode,
    districtCode: row.districtCode,
    cityCode: row.cityCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRangeView(row: TimbradoRangeRow): TimbradoRangeView {
  return {
    id: row.id,
    establishmentId: row.establishmentId,
    expeditionPoint: row.expeditionPoint,
    documentType: row.documentType,
    series: row.series,
    timbradoNumber: row.timbradoNumber,
    rangeFrom: row.rangeFrom,
    rangeTo: row.rangeTo,
    validityStart: row.validityStart,
    nextNumber: row.nextNumber,
    status: row.status,
  };
}
