import { Controller, Get, Param, Query } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { NOTIFICATIONS_PERMISSIONS } from "./notifications.permissions.js";
import { NotificationDeliveryService } from "./notification-delivery.service.js";
import {
  notificationDeliveryListQuerySchema,
  type NotificationDeliveryResponse,
} from "./notification-delivery.dto.js";

interface NotificationDeliveryListResponse {
  readonly deliveries: NotificationDeliveryResponse[];
}

/**
 * The staff notification-delivery surface ([[NOTIF-004]]).
 *
 * **Read-only, and there is deliberately no command route.** A generic
 * `PATCH status=...` is forbidden by `ENGINEERING-RULES.md`, and this epic adds no
 * delivery transition from the surface: the lifecycle moves through named commands
 * in the schedulers and the worker's handler, never through HTTP.
 *
 * Tenant identity is never an input — it comes from the request context — so there
 * is no cross-tenant-addressable resource and no body to validate. The query is a
 * CLOSED schema: an unknown key or an oversized `limit` is refused rather than
 * ignored, which is what keeps [[TD-026]]'s unbounded-list debt from growing.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly deliveries: NotificationDeliveryService) {}

  @Get("deliveries")
  @RequirePermissions(NOTIFICATIONS_PERMISSIONS.deliveryRead)
  async list(@Query() query: unknown): Promise<NotificationDeliveryListResponse> {
    const parsed = notificationDeliveryListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid notification delivery query.");
    }
    return { deliveries: await this.deliveries.list(parsed.data) };
  }

  @Get("deliveries/:id")
  @RequirePermissions(NOTIFICATIONS_PERMISSIONS.deliveryRead)
  async get(@Param("id") id: string): Promise<NotificationDeliveryResponse> {
    // The id's shape is validated here rather than in the service so a malformed
    // value cannot reach a query at all; the service asserts the tenant predicate.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new DomainError("VALIDATION_FAILED", "Invalid notification delivery id.");
    }
    return this.deliveries.get(id);
  }
}
