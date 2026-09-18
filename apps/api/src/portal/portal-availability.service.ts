import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { RequestContextService } from "../context/request-context.service.js";
import { TenantSettingsService } from "../settings/tenant-settings.service.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  loadSchedulingSettings,
} from "../scheduling/appointment-invariants.js";
import { zonedDayMinuteToUtc } from "../scheduling/appointment-availability.js";
import {
  toPortalAvailabilityResponse,
  type PortalAvailabilityQuery,
  type PortalAvailabilityResponse,
} from "./portal-availability.dto.js";
import {
  computePortalAvailableSlots,
  resolvePortalAvailabilityGrid,
  type PortalAvailabilityAppointment,
  type PortalAvailabilityMembership,
} from "./portal-availability.js";

/** Role code every candidate professional must carry (the write-path rule). */
const PROFESSIONAL_ROLE_CODE = "VETERINARIAN";

/**
 * Structural Prisma surface consumed by the portal availability boundary.
 * Declared explicitly (design pattern shared with `PortalReadService`) so the
 * service is unit-testable and the in-memory fake can satisfy it.
 */
interface PortalAvailabilityPrisma {
  tenantMembership: {
    findMany: (args: {
      where: { tenantId: string; role: { code: string } };
    }) => Promise<PortalAvailabilityMembership[]>;
  };
  appointment: {
    findMany: (args: {
      where: {
        tenantId: string;
        professionalMembershipId: { in: string[] };
        status: { in: string[] };
        startAt: { lt: Date };
        endAt: { gt: Date };
      };
    }) => Promise<PortalAvailabilityAppointment[]>;
  };
}

/**
 * Holder-facing availability read (DEC-007 A2a).
 *
 * The tenant comes ONLY from the authenticated portal context; the route
 * carries no staff permission metadata and is enforced by `PortalAuthGuard`.
 * The read is a UNION across every in-tenant VETERINARIAN, computed by CALLING
 * the shared scheduling predicates — see `portal-availability.ts` for the reuse
 * contract.
 *
 * READ-ONLY: it writes no appointment, no booking request, no audit row and no
 * settings change.
 *
 * Efficiency — THREE database reads per request, none inside the candidate
 * loop and none per professional:
 *   1. the tenant's VETERINARIAN memberships (one set-based read);
 *   2. the `scheduling` settings namespace (one read);
 *   3. ONE set-based active-appointment read for every candidate professional,
 *      bounded to the day window and the shared active status list.
 * When the grid is empty (no professional contributes a candidate) the
 * appointment read is skipped, so such a request issues two reads. Candidate
 * filtering then happens entirely in memory against those rows.
 */
@Injectable()
export class PortalAvailabilityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PortalAvailabilityPrisma,
    private readonly requestContext: RequestContextService,
    private readonly settings: TenantSettingsService
  ) {}

  async listAvailability(query: PortalAvailabilityQuery): Promise<PortalAvailabilityResponse> {
    const tenantId = this.requestContext.requireTenantId();

    const [memberships, scheduling] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: { tenantId, role: { code: PROFESSIONAL_ROLE_CODE } },
      }),
      loadSchedulingSettings(this.settings),
    ]);
    const membershipIds = memberships.map((membership) => membership.id);

    const grid = resolvePortalAvailabilityGrid(scheduling, membershipIds, query.date);
    if (!grid.hasCandidates) {
      return toPortalAvailabilityResponse(query, []);
    }

    // ONE set-based overlap read for the whole day window across every candidate
    // professional. Per-candidate filtering happens in memory against this
    // result — never a query per slot or per professional in the loop.
    const activeAppointments = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        professionalMembershipId: { in: membershipIds },
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
        startAt: { lt: zonedDayMinuteToUtc(query.date, grid.endMinute) },
        endAt: { gt: zonedDayMinuteToUtc(query.date, grid.startMinute) },
      },
    });

    const slots = computePortalAvailableSlots({
      query,
      settings: scheduling,
      membershipIds,
      activeAppointments,
    });
    return toPortalAvailabilityResponse(query, slots);
  }
}
