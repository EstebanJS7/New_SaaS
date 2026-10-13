import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import type { FiscalRangeVoidOutcome } from "@newsaas/fiscal";
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
  /**
   * `VOIDING` is the claim: an in-flight void holds the range, and no allocation
   * may draw from it (`findCurrentRange` selects `ACTIVE`).
   */
  status: "ACTIVE" | "VOIDING" | "EXHAUSTED" | "RETIRED";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The claim's own states, as the record's enum declares them: `PENDING` is the
 * written claim, `IN_FLIGHT` the claim whose submission is being awaited.
 */
export type FiscalRangeVoidClaimState = "PENDING" | "IN_FLIGHT";

/**
 * One row of `fiscal_range_void`, in the shape this boundary reads and writes.
 *
 * The record is written `PENDING` and enters `IN_FLIGHT` in the claim's own
 * transaction, before any provider call; those two are claim states, and never
 * the outcome of a settled row.
 */
export interface FiscalRangeVoidWriteRow {
  id: string;
  tenantId: string;
  rangeId: string;
  fromNumber: number;
  toNumber: number;
  reason: string;
  outcome: FiscalRangeVoidOutcome | FiscalRangeVoidClaimState;
  /** The claim's identity: the adoption bumps it and the settlement CASes on it. */
  attempt: number;
  /** The in-flight claim's lease; `null` on a record that never entered flight. */
  claimedAt: Date | null;
  reasonCode: string | null;
  providerReason: string | null;
  providerReference: string | null;
  rangeStatus: TimbradoRangeRow["status"];
  createdAt: Date;
}

/** What one void attempt records; the caller has already made every decision. */
export type RecordRangeVoidInput = Omit<FiscalRangeVoidWriteRow, "id" | "tenantId" | "createdAt">;

/** The provider's answer as the settlement closes the claim with it. */
export interface SettleRangeVoidInput {
  readonly id: string;
  readonly attempt: number;
  readonly outcome: FiscalRangeVoidOutcome;
  readonly reasonCode: string | null;
  readonly providerReason: string | null;
  readonly providerReference: string | null;
  readonly rangeStatus: "ACTIVE" | "RETIRED";
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
      where: {
        id: string;
        tenantId: string;
        status: TimbradoRangeRow["status"];
        nextNumber?: number;
        voids?: { some: { outcome: FiscalRangeVoidClaimState; attempt: number } };
      };
      data: { status: TimbradoRangeRow["status"] };
    }): Promise<{ count: number }>;
  };
  /**
   * The void's own record. The claim inserts it `PENDING` and flips it
   * `IN_FLIGHT` before the provider is asked, the settlement closes it exactly
   * once; this structural declaration is what lets a fake satisfy it in a unit
   * test.
   */
  fiscalRangeVoid: {
    create(args: { data: Record<string, unknown> }): Promise<FiscalRangeVoidWriteRow>;
    findFirst(args: {
      where: { tenantId: string; rangeId: string; outcome: FiscalRangeVoidClaimState };
      orderBy: { createdAt: "desc" };
    }): Promise<FiscalRangeVoidWriteRow | null>;
    updateMany(args: {
      where: {
        id: string;
        tenantId: string;
        outcome: FiscalRangeVoidClaimState;
        attempt?: number;
        claimedAt?: { lte: Date };
      };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export interface FiscalProfileTx {
  fiscalEmitterProfile: FiscalProfileDelegate["fiscalEmitterProfile"];
  fiscalEmitterActivity: FiscalProfileDelegate["fiscalEmitterActivity"];
  fiscalEstablishment: FiscalProfileDelegate["fiscalEstablishment"];
  fiscalTimbradoRange: FiscalProfileDelegate["fiscalTimbradoRange"];
  fiscalRangeVoid: FiscalProfileDelegate["fiscalRangeVoid"];
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

  /**
   * Claims the range for a void: `ACTIVE → VOIDING` only while the counter is
   * still the one the caller observed. `0` means the range moved, was retired or
   * is already claimed by another void — and the caller must not submit.
   */
  async claimRangeVoid(
    id: string,
    expectedNextNumber: number,
    tx: FiscalProfileTx
  ): Promise<number> {
    const result = await tx.fiscalTimbradoRange.updateMany({
      where: {
        id,
        tenantId: this.context.requireTenantId(),
        status: "ACTIVE",
        nextNumber: expectedNextNumber,
      },
      data: { status: "VOIDING" },
    });
    return result.count;
  }

  /**
   * Adopts a STALE in-flight claim as a compare-and-swap on its lease and its
   * attempt together: only a claim whose lease is at or before `staleBefore`
   * matches, and winning refreshes the lease to `claimedAt`. `0` means the
   * lease is live or a newer adoption moved the attempt, so the caller must not
   * re-drive the submission. A live lease is the guard an observer cannot
   * bypass: it is read and CASed in the same statement.
   */
  async adoptRangeVoid(
    id: string,
    expectedAttempt: number,
    staleBefore: Date,
    claimedAt: Date,
    tx: FiscalProfileTx
  ): Promise<number> {
    const result = await tx.fiscalRangeVoid.updateMany({
      where: {
        id,
        tenantId: this.context.requireTenantId(),
        outcome: "IN_FLIGHT",
        attempt: expectedAttempt,
        claimedAt: { lte: staleBefore },
      },
      data: { attempt: { increment: 1 }, claimedAt },
    });
    return result.count;
  }

  /**
   * Moves the claim the transaction just wrote from `PENDING` into `IN_FLIGHT`,
   * stamping its lease. Called inside the claim's transaction, before any
   * provider call, so a second arrival sees a claim in flight rather than a
   * merely planned submission. `0` means the row was not the caller's.
   */
  async markRangeVoidInFlight(
    id: string,
    expectedAttempt: number,
    claimedAt: Date,
    tx: FiscalProfileTx
  ): Promise<number> {
    const result = await tx.fiscalRangeVoid.updateMany({
      where: {
        id,
        tenantId: this.context.requireTenantId(),
        outcome: "PENDING",
        attempt: expectedAttempt,
      },
      data: { outcome: "IN_FLIGHT", claimedAt },
    });
    return result.count;
  }

  /**
   * Settles a claimed range on the same counter and attempt: `VOIDING → RETIRED`
   * when the provider accepted, `VOIDING → ACTIVE` when it refused. `0` means the
   * claim is gone or a newer adoption replaced this attempt.
   */
  async settleRangeVoid(
    id: string,
    expectedNextNumber: number,
    expectedAttempt: number,
    status: "ACTIVE" | "RETIRED",
    tx: FiscalProfileTx
  ): Promise<number> {
    const result = await tx.fiscalTimbradoRange.updateMany({
      where: {
        id,
        tenantId: this.context.requireTenantId(),
        status: "VOIDING",
        nextNumber: expectedNextNumber,
        // A stale attempt settles nothing: the claim's attempt is its identity.
        voids: { some: { outcome: "IN_FLIGHT", attempt: expectedAttempt } },
      },
      data: { status },
    });
    return result.count;
  }

  /**
   * Writes the claim's `PENDING` row inside the caller's transaction.
   *
   * The write precedes any provider call, so a crash after the service accepted
   * still leaves the attempt durably recorded. The tenant is the resolved request
   * context's, never a caller-supplied value, which is what makes a cross-tenant
   * range id unrepresentable here.
   */
  async recordRangeVoid(
    input: RecordRangeVoidInput,
    tx: FiscalProfileTx
  ): Promise<FiscalRangeVoidWriteRow> {
    return tx.fiscalRangeVoid.create({
      data: { ...input, tenantId: this.context.requireTenantId() },
    });
  }

  /**
   * The range's open claim, if any: the `IN_FLIGHT` record a fresh void adopts
   * once the claim's lease is stale. `null` means the range and its record
   * disagree, and the caller refuses by name rather than guessing.
   */
  async findOpenRangeVoid(rangeId: string): Promise<FiscalRangeVoidWriteRow | null> {
    return this.prisma.fiscalRangeVoid.findFirst({
      where: { tenantId: this.context.requireTenantId(), rangeId, outcome: "IN_FLIGHT" },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Closes an `IN_FLIGHT` claim with the provider's answer. `0` means there was
   * no claim in flight matching this attempt: the settlement is idempotent and
   * cannot rewrite a settled record or a newer adoption's claim.
   */
  async settleRangeVoidRecord(input: SettleRangeVoidInput, tx: FiscalProfileTx): Promise<number> {
    const result = await tx.fiscalRangeVoid.updateMany({
      where: {
        id: input.id,
        tenantId: this.context.requireTenantId(),
        outcome: "IN_FLIGHT",
        attempt: input.attempt,
      },
      data: {
        outcome: input.outcome,
        reasonCode: input.reasonCode,
        providerReason: input.providerReason,
        providerReference: input.providerReference,
        rangeStatus: input.rangeStatus,
      },
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
