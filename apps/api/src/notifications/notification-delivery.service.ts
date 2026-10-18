import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";
import { PermissionResolver } from "../rbac/permission-resolver.service.js";
import { NOTIFICATIONS_PERMISSIONS } from "./notifications.permissions.js";
import {
  NOTIFICATION_DELIVERY_LIST_LIMIT_DEFAULT,
  toNotificationDeliveryResponse,
  type NotificationDeliveryListQuery,
  type NotificationDeliveryResponse,
  type NotificationDeliveryRow,
} from "./notification-delivery.dto.js";

/**
 * The delivery read surface ([[NOTIF-004]]).
 *
 * Tenant identity comes from the request context and never from an argument, and a
 * foreign or unknown id is a byte-equivalent `404` — the repository's rule for every
 * private aggregate. The permission is re-asserted here as defense in depth behind
 * the route's decorator, the same way `AppointmentService` and `FiscalService` do.
 *
 * The narrow client is declared with Prisma's OWN arg types so the real client fits
 * by construction and a suite can pass a stub (`fiscal-persistence`'s pattern).
 */
export interface NotificationDeliveryReadPrisma {
  notificationDelivery: {
    findMany(args: Prisma.NotificationDeliveryFindManyArgs): Promise<NotificationDeliveryRow[]>;
    findFirst(
      args: Prisma.NotificationDeliveryFindFirstArgs
    ): Promise<NotificationDeliveryRow | null>;
  };
}

/** The projection every read selects; the mapper names what leaves the process. */
const DELIVERY_SELECT = Object.freeze({
  id: true,
  channel: true,
  status: true,
  sourceType: true,
  sourceId: true,
  recipientType: true,
  recipientId: true,
  scheduledAt: true,
  attemptCount: true,
  lastAttemptAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  providerReference: true,
  sentAt: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
} as const);

@Injectable()
export class NotificationDeliveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: NotificationDeliveryReadPrisma,
    private readonly requestContext: RequestContextService,
    private readonly permissionResolver: PermissionResolver
  ) {}

  /**
   * The tenant's deliveries, newest first, bounded.
   *
   * The order is deterministic (`scheduledAt` descending, then `id`) so a page is a
   * page rather than an arbitrary slice: two calls with the same query return the
   * same rows.
   */
  async list(query: NotificationDeliveryListQuery): Promise<NotificationDeliveryResponse[]> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireReadPermission();

    const rows = await this.prisma.notificationDelivery.findMany({
      where: {
        tenantId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.channel === undefined ? {} : { channel: query.channel }),
        ...(query.sourceType === undefined ? {} : { sourceType: query.sourceType }),
        ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
      },
      orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
      take: query.limit ?? NOTIFICATION_DELIVERY_LIST_LIMIT_DEFAULT,
      select: DELIVERY_SELECT,
    });
    return rows.map(toNotificationDeliveryResponse);
  }

  /** One delivery, or a `404` indistinguishable from a foreign tenant's. */
  async get(id: string): Promise<NotificationDeliveryResponse> {
    const tenantId = this.requestContext.requireTenantId();
    await this.requireReadPermission();

    const row = await this.prisma.notificationDelivery.findFirst({
      // `tenantId` is part of the predicate, so a foreign id does not match at all:
      // there is no branch that could reveal it exists.
      where: { id, tenantId },
      select: DELIVERY_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND", "Notification delivery was not found.");
    }
    return toNotificationDeliveryResponse(row);
  }

  private async requireReadPermission(): Promise<void> {
    const held = await this.permissionResolver.resolveForActiveRequest();
    if (!held.has(NOTIFICATIONS_PERMISSIONS.deliveryRead)) {
      throw new DomainError("FORBIDDEN", "Notification delivery read permission is required.");
    }
  }
}
