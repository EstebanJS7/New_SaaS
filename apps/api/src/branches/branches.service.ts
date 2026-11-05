import { Injectable } from "@nestjs/common";
// Value import: `PrismaService` is the DI token.
import { PrismaService, type Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { AuditWriter, type AuditAppendTx } from "../audit/audit-writer.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { MEMBERSHIP_NOT_FOUND_MESSAGE } from "../tenancy/tenant-membership.repository.js";
import { resolveAssignableBranchIds } from "./branch-assignment.js";
import { listWorkingBranches } from "./branch-scope.js";
import type { CreateBranchInput, UpdateBranchInput } from "./branches.zod.js";

/**
 * MB-001 / DEC-094 — branches as a managed aggregate, and the staff assigned
 * to them.
 *
 * Every write locks the tenant's branch rows first (`FOR UPDATE`), so two
 * concurrent commands cannot both pass the "one active branch without
 * `multi_branch`" or the "at least one active branch" rule. The audit row
 * co-commits with each change and carries ids only: a branch's name and
 * address are INTERNAL, and the trail outlives them.
 */

export const BRANCH_NOT_FOUND_MESSAGE = "La sucursal no existe.";
export const BRANCH_NAME_TAKEN_MESSAGE = "Ya hay una sucursal con ese nombre.";
export const BRANCH_MULTI_NOT_ENTITLED_MESSAGE =
  "Tu plan incluye una sola sucursal activa: para tener más, activá la función multi-sucursal.";
export const BRANCH_LAST_ACTIVE_MESSAGE = "Tiene que quedar al menos una sucursal activa.";
export const BRANCH_ALREADY_ACTIVE_MESSAGE = "La sucursal ya está activa.";
export const BRANCH_ALREADY_INACTIVE_MESSAGE = "La sucursal ya está desactivada.";
export const BRANCH_ESTABLISHMENT_NOT_FOUND_MESSAGE =
  "El establecimiento fiscal no existe en esta clínica.";
export const BRANCH_ISSUANCE_POINT_TAKEN_MESSAGE =
  "Otra sucursal ya emite con ese establecimiento y punto de expedición.";

export function branchHasUpcomingAppointmentsMessage(count: number): string {
  return count === 1
    ? "La sucursal tiene 1 turno pendiente: reprogramalo o cancelalo antes de desactivarla."
    : `La sucursal tiene ${count} turnos pendientes: reprogramalos o cancelalos antes de desactivarla.`;
}

export function assignmentDropsAppointmentsMessage(count: number): string {
  return count === 1
    ? "Esa persona tiene 1 turno pendiente en una sucursal que le quitás: reasignalo antes."
    : `Esa persona tiene ${count} turnos pendientes en sucursales que le quitás: reasignalos antes.`;
}

export const BRANCH_CREATED_ACTION = "branch.created";
export const BRANCH_UPDATED_ACTION = "branch.updated";
export const BRANCH_DEACTIVATED_ACTION = "branch.deactivated";
export const BRANCH_REACTIVATED_ACTION = "branch.reactivated";
export const MEMBERSHIP_BRANCHES_ASSIGNED_ACTION = "users.membership.branches_assigned";

/** Turnos that still have to happen: the ones a deactivation would strand. */
const UPCOMING_STATUSES = ["SCHEDULED", "CONFIRMED"] as const;

const MULTI_BRANCH_FEATURE = "multi_branch";

export interface BranchView {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
  /** MB-002: the branch's own issuance point, or `null` for the profile's default. */
  readonly fiscalEstablishmentId: string | null;
  readonly expeditionPoint: string | null;
  /** Staff assigned here, suspended members included. */
  readonly staffCount: number;
  readonly createdAt: string;
}

/** MB-002: an establishment a branch can issue from (code and address only). */
export interface FiscalEstablishmentOption {
  readonly id: string;
  readonly code: string;
  readonly addressLine: string;
}

export interface MembershipBranchesView {
  readonly membershipId: string;
  readonly branchIds: readonly string[];
}

type Tx = Prisma.TransactionClient;

interface BranchRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  fiscalEstablishmentId: string | null;
  expeditionPoint: string | null;
  createdAt: Date;
  _count: { memberships: number };
}

const BRANCH_SELECT = {
  id: true,
  name: true,
  address: true,
  phone: true,
  isActive: true,
  fiscalEstablishmentId: true,
  expeditionPoint: true,
  createdAt: true,
  _count: { select: { memberships: true } },
} as const;

function toView(row: BranchRow): BranchView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    isActive: row.isActive,
    fiscalEstablishmentId: row.fiscalEstablishmentId,
    expeditionPoint: row.expeditionPoint,
    staffCount: row._count.memberships,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditWriter
  ) {}

  /** Active first, then by name. Inactive branches stay listed: they can be reactivated. */
  async list(): Promise<BranchView[]> {
    const tenantId = this.context.requireTenantId();
    const rows = await this.prisma.branch.findMany({
      where: { tenantId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: BRANCH_SELECT,
    });
    return rows.map(toView);
  }

  /** MB-002: the establishments a branch can be linked to, by code. */
  async listEstablishments(): Promise<FiscalEstablishmentOption[]> {
    const tenantId = this.context.requireTenantId();
    return this.prisma.fiscalEstablishment.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
      select: { id: true, code: true, addressLine: true },
    });
  }

  /** MB-002: the active branches the caller works at (counter, cash screen). */
  async listMine(): Promise<{ id: string; name: string }[]> {
    return listWorkingBranches(this.prisma, {
      tenantId: this.context.requireTenantId(),
      userProfileId: this.context.requireUserProfileId(),
    });
  }

  async create(input: CreateBranchInput): Promise<BranchView> {
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();
    const entitled = await this.entitlements.has(tenantId, MULTI_BRANCH_FEATURE);

    return this.prisma.$transaction(async (tx) => {
      const branches = await lockBranches(tx, tenantId);
      if (!entitled && branches.some((branch) => branch.is_active)) {
        throw new DomainError("FEATURE_NOT_ENTITLED", BRANCH_MULTI_NOT_ENTITLED_MESSAGE);
      }
      assertNameFree(branches, input.name);

      const row = await tx.branch.create({
        data: {
          tenantId,
          name: input.name,
          address: input.address ?? null,
          phone: input.phone ?? null,
        },
        select: BRANCH_SELECT,
      });
      await this.appendAudit(tx, BRANCH_CREATED_ACTION, tenantId, actorUserProfileId, row.id);
      return toView(row);
    });
  }

  async update(id: string, input: UpdateBranchInput): Promise<BranchView> {
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();

    return this.prisma.$transaction(async (tx) => {
      const branches = await lockBranches(tx, tenantId);
      if (!branches.some((branch) => branch.id === id)) {
        throw new DomainError("NOT_FOUND", BRANCH_NOT_FOUND_MESSAGE);
      }
      if (input.name !== undefined) assertNameFree(branches, input.name, id);
      if (input.fiscalEstablishmentId) {
        const establishment = await tx.fiscalEstablishment.findFirst({
          where: { id: input.fiscalEstablishmentId, tenantId },
          select: { id: true },
        });
        if (!establishment) {
          throw new DomainError("VALIDATION_FAILED", BRANCH_ESTABLISHMENT_NOT_FOUND_MESSAGE);
        }
        if (
          branches.some(
            (other) =>
              other.id !== id &&
              other.fiscal_establishment_id === input.fiscalEstablishmentId &&
              other.expedition_point === input.expeditionPoint
          )
        ) {
          throw new DomainError("CONFLICT", BRANCH_ISSUANCE_POINT_TAKEN_MESSAGE);
        }
      }

      const data: Prisma.BranchUncheckedUpdateManyInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.address !== undefined) data.address = input.address;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.fiscalEstablishmentId !== undefined) {
        data.fiscalEstablishmentId = input.fiscalEstablishmentId;
        data.expeditionPoint = input.expeditionPoint ?? null;
      }
      await tx.branch.updateMany({ where: { id, tenantId }, data });

      const fields = Object.keys(data).sort();
      await this.appendAudit(tx, BRANCH_UPDATED_ACTION, tenantId, actorUserProfileId, id, {
        fields,
      });
      return toView(await readBranch(tx, tenantId, id));
    });
  }

  /**
   * Refuses the last active branch (DEC-094 §2) and a branch that still has
   * turnos to happen (§7): they would be left at a place nobody can book or
   * reschedule into.
   */
  async deactivate(id: string): Promise<BranchView> {
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();

    return this.prisma.$transaction(async (tx) => {
      const branches = await lockBranches(tx, tenantId);
      const branch = branches.find((candidate) => candidate.id === id);
      if (!branch) throw new DomainError("NOT_FOUND", BRANCH_NOT_FOUND_MESSAGE);
      if (!branch.is_active) throw new DomainError("CONFLICT", BRANCH_ALREADY_INACTIVE_MESSAGE);
      if (!branches.some((other) => other.id !== id && other.is_active)) {
        throw new DomainError("CONFLICT", BRANCH_LAST_ACTIVE_MESSAGE);
      }

      const upcoming = await tx.appointment.count({
        where: {
          tenantId,
          branchId: id,
          status: { in: [...UPCOMING_STATUSES] },
          endAt: { gt: new Date() },
        },
      });
      if (upcoming > 0) {
        throw new DomainError("CONFLICT", branchHasUpcomingAppointmentsMessage(upcoming));
      }

      await tx.branch.updateMany({ where: { id, tenantId }, data: { isActive: false } });
      await this.appendAudit(tx, BRANCH_DEACTIVATED_ACTION, tenantId, actorUserProfileId, id);
      return toView(await readBranch(tx, tenantId, id));
    });
  }

  async reactivate(id: string): Promise<BranchView> {
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();
    const entitled = await this.entitlements.has(tenantId, MULTI_BRANCH_FEATURE);

    return this.prisma.$transaction(async (tx) => {
      const branches = await lockBranches(tx, tenantId);
      const branch = branches.find((candidate) => candidate.id === id);
      if (!branch) throw new DomainError("NOT_FOUND", BRANCH_NOT_FOUND_MESSAGE);
      if (branch.is_active) throw new DomainError("CONFLICT", BRANCH_ALREADY_ACTIVE_MESSAGE);
      if (!entitled && branches.some((other) => other.is_active)) {
        throw new DomainError("FEATURE_NOT_ENTITLED", BRANCH_MULTI_NOT_ENTITLED_MESSAGE);
      }

      await tx.branch.updateMany({ where: { id, tenantId }, data: { isActive: true } });
      await this.appendAudit(tx, BRANCH_REACTIVATED_ACTION, tenantId, actorUserProfileId, id);
      return toView(await readBranch(tx, tenantId, id));
    });
  }

  /**
   * Replaces a membership's branches with an explicit, non-empty set of active
   * branches. Assignments to branches that are now inactive are kept if listed
   * nowhere: they are history and grant nothing. Removing a branch where the
   * person still has turnos to attend is refused, so no appointment is left
   * with a professional who no longer works there.
   */
  async assignMembershipBranches(
    membershipId: string,
    branchIds: readonly string[]
  ): Promise<MembershipBranchesView> {
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();

    return this.prisma.$transaction(async (tx) => {
      await lockBranches(tx, tenantId);
      const membership = await tx.tenantMembership.findFirst({
        where: { id: membershipId, tenantId },
        select: { id: true },
      });
      if (!membership) throw new DomainError("NOT_FOUND", MEMBERSHIP_NOT_FOUND_MESSAGE);

      const wanted = await resolveAssignableBranchIds(tx, tenantId, branchIds);
      const current = await tx.membershipBranch.findMany({
        where: { tenantId, membershipId },
        select: { branchId: true, branch: { select: { isActive: true } } },
      });
      // Only ACTIVE assignments are "removed" by omission; inactive ones stay as history.
      const removed = current
        .filter((row) => row.branch.isActive && !wanted.includes(row.branchId))
        .map((row) => row.branchId);
      const added = wanted.filter((id) => !current.some((row) => row.branchId === id));

      if (removed.length > 0) {
        const stranded = await tx.appointment.count({
          where: {
            tenantId,
            professionalMembershipId: membershipId,
            branchId: { in: removed },
            status: { in: [...UPCOMING_STATUSES] },
            endAt: { gt: new Date() },
          },
        });
        if (stranded > 0) {
          throw new DomainError("CONFLICT", assignmentDropsAppointmentsMessage(stranded));
        }
        await tx.membershipBranch.deleteMany({
          where: { tenantId, membershipId, branchId: { in: removed } },
        });
      }
      if (added.length > 0) {
        await tx.membershipBranch.createMany({
          data: added.map((branchId) => ({ tenantId, membershipId, branchId })),
          skipDuplicates: true,
        });
      }

      await this.appendAudit(
        tx,
        MEMBERSHIP_BRANCHES_ASSIGNED_ACTION,
        tenantId,
        actorUserProfileId,
        membershipId,
        { added, removed },
        "membership"
      );

      const after = await tx.membershipBranch.findMany({
        where: { tenantId, membershipId },
        select: { branchId: true },
        orderBy: { branchId: "asc" },
      });
      return { membershipId, branchIds: after.map((row) => row.branchId) };
    });
  }

  private async appendAudit(
    tx: Tx,
    action: string,
    tenantId: string,
    actorUserProfileId: string,
    targetId: string,
    metadata?: Record<string, unknown>,
    targetType = "branch"
  ): Promise<void> {
    await this.audit.append(
      { action, tenantId, actorUserProfileId, targetType, targetId, metadata },
      tx as unknown as AuditAppendTx
    );
  }
}

interface LockedBranch {
  id: string;
  name: string;
  is_active: boolean;
  fiscal_establishment_id: string | null;
  expedition_point: string | null;
}

/** Serializes every branch command of one tenant (DEC-094 §2–3). */
async function lockBranches(tx: Tx, tenantId: string): Promise<LockedBranch[]> {
  return tx.$queryRaw<LockedBranch[]>`
    SELECT "id", "name", "is_active", "fiscal_establishment_id", "expedition_point"
    FROM "branch"
    WHERE "tenant_id" = ${tenantId}::uuid
    ORDER BY "id"
    FOR UPDATE`;
}

/** Same rule as `branch_tenant_id_lower_name_key`, checked first for a Spanish 409. */
function assertNameFree(branches: readonly LockedBranch[], name: string, exceptId?: string): void {
  const wanted = name.trim().toLocaleLowerCase("es");
  if (
    branches.some(
      (branch) => branch.id !== exceptId && branch.name.trim().toLocaleLowerCase("es") === wanted
    )
  ) {
    throw new DomainError("CONFLICT", BRANCH_NAME_TAKEN_MESSAGE);
  }
}

async function readBranch(tx: Tx, tenantId: string, id: string): Promise<BranchRow> {
  const row = await tx.branch.findFirst({ where: { id, tenantId }, select: BRANCH_SELECT });
  if (!row) throw new DomainError("NOT_FOUND", BRANCH_NOT_FOUND_MESSAGE);
  return row;
}
