"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getNotificationDelivery,
  isNotificationPermissionDenied,
  listNotificationDeliveries,
  type NotificationDelivery,
  type NotificationDeliveryDetail,
} from "./notifications-api";
import {
  NotificationDeliveryDetailPanel,
  NotificationDeliveryListPanel,
  type NotificationChannelFilter,
  type NotificationStatusFilter,
} from "./notification-delivery-panel";

/**
 * Staff workspace for notification deliveries: the reads are owned here and the
 * panels are presentational. There is no command to own — the surface is read-only
 * by design ([[NOTIF-004]]), so a delivery's fate is changed by the lifecycle, not
 * from here.
 */
export function NotificationsSurface(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<NotificationStatusFilter>("ALL");
  const [channelFilter, setChannelFilter] = useState<NotificationChannelFilter>("ALL");
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);

  const deliveriesQuery = useQuery({
    queryKey: ["notifications", "deliveries", statusFilter, channelFilter],
    queryFn: () =>
      listNotificationDeliveries({
        ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
        ...(channelFilter === "ALL" ? {} : { channel: channelFilter }),
      }),
    retry: false,
  });
  const detailQuery = useQuery({
    queryKey: ["notifications", "delivery", selectedDeliveryId ?? "none"],
    queryFn: () =>
      selectedDeliveryId === null
        ? Promise.resolve<NotificationDeliveryDetail | null>(null)
        : getNotificationDelivery(selectedDeliveryId),
    retry: false,
    enabled: selectedDeliveryId !== null,
  });

  function selectDelivery(delivery: NotificationDelivery): void {
    setSelectedDeliveryId((current) => (current === delivery.id ? null : delivery.id));
  }

  const listPermissionDenied = isNotificationPermissionDenied(deliveriesQuery.error);
  const forbiddenDetail = isNotificationPermissionDenied(detailQuery.error);

  return (
    <main data-testid="notifications-surface" className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Notificaciones</h1>
        <p className="text-sm text-muted-foreground">
          Cada recordatorio y aviso fiscal que programó esta organización, y qué pasó con él.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <NotificationDeliveryListPanel
          deliveries={deliveriesQuery.data ?? []}
          isLoading={deliveriesQuery.isLoading}
          permissionDenied={listPermissionDenied}
          errorMessage={
            listPermissionDenied || deliveriesQuery.error === null
              ? null
              : "No se pudieron cargar las entregas. Volvé a intentar."
          }
          statusFilter={statusFilter}
          channelFilter={channelFilter}
          onStatusFilterChange={setStatusFilter}
          onChannelFilterChange={setChannelFilter}
          selectedDeliveryId={selectedDeliveryId}
          onSelectDelivery={selectDelivery}
        />
        <NotificationDeliveryDetailPanel
          delivery={detailQuery.data ?? null}
          isLoading={selectedDeliveryId !== null && detailQuery.isLoading}
          permissionDenied={forbiddenDetail}
          errorMessage={
            detailQuery.error === null || forbiddenDetail
              ? null
              : "No se pudo cargar esta entrega. Volvé a intentar."
          }
        />
      </div>
    </main>
  );
}
