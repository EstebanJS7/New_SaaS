"use client";

import type { JSX } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationDeliveryStatus,
} from "./notifications-api";
import {
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_SOURCE_LABELS,
  NOTIFICATION_STATUS_LABELS,
  deliveryFailureReason,
  formatTimestamp,
  notificationInputClassName,
  shortId,
} from "./notifications-display";

export type NotificationStatusFilter = NotificationDeliveryStatus | "ALL";
export type NotificationChannelFilter = NotificationChannel | "ALL";

interface DeliveryListPanelProps {
  readonly deliveries: readonly NotificationDelivery[];
  readonly isLoading: boolean;
  readonly permissionDenied: boolean;
  readonly errorMessage: string | null;
  readonly statusFilter: NotificationStatusFilter;
  readonly channelFilter: NotificationChannelFilter;
  readonly onStatusFilterChange: (value: NotificationStatusFilter) => void;
  readonly onChannelFilterChange: (value: NotificationChannelFilter) => void;
  readonly selectedDeliveryId: string | null;
  readonly onSelectDelivery: (delivery: NotificationDelivery) => void;
}

/**
 * The delivery list, presentational. The five states are distinct and ordered:
 * loading, permission-denied, error, empty, and content — a permission denial is not
 * an error to retry, so it is never rendered as one.
 */
export function NotificationDeliveryListPanel({
  deliveries,
  isLoading,
  permissionDenied,
  errorMessage,
  statusFilter,
  channelFilter,
  onStatusFilterChange,
  onChannelFilterChange,
  selectedDeliveryId,
  onSelectDelivery,
}: DeliveryListPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification deliveries</CardTitle>
        <CardDescription>The tenant&apos;s deliveries, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="notification-status-filter" className="text-sm font-medium">
              Status
            </label>
            <select
              id="notification-status-filter"
              value={statusFilter}
              onChange={(event) =>
                onStatusFilterChange(event.target.value as NotificationStatusFilter)
              }
              className={notificationInputClassName}
            >
              <option value="ALL">All statuses</option>
              {NOTIFICATION_DELIVERY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {NOTIFICATION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="notification-channel-filter" className="text-sm font-medium">
              Channel
            </label>
            <select
              id="notification-channel-filter"
              value={channelFilter}
              onChange={(event) =>
                onChannelFilterChange(event.target.value as NotificationChannelFilter)
              }
              className={notificationInputClassName}
            >
              <option value="ALL">All channels</option>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {NOTIFICATION_CHANNEL_LABELS[channel] ?? channel}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <p data-testid="notification-list-loading" className="text-sm text-muted-foreground">
            Loading deliveries...
          </p>
        ) : permissionDenied ? (
          <p data-testid="notification-permission-denied" className="text-sm text-muted-foreground">
            You do not have permission to read notification deliveries.
          </p>
        ) : errorMessage !== null ? (
          <p data-testid="notification-list-error" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : deliveries.length === 0 ? (
          <p data-testid="notification-list-empty" className="text-sm text-muted-foreground">
            No deliveries match these filters.
          </p>
        ) : (
          <ul className="space-y-2">
            {deliveries.map((delivery) => {
              const selected = delivery.id === selectedDeliveryId;
              const reason = deliveryFailureReason(delivery);
              return (
                <li
                  key={delivery.id}
                  data-testid="notification-list-item"
                  data-selected={selected}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {`${NOTIFICATION_STATUS_LABELS[delivery.status as NotificationDeliveryStatus] ?? delivery.status} · ${NOTIFICATION_CHANNEL_LABELS[delivery.channel] ?? delivery.channel} · ${NOTIFICATION_SOURCE_LABELS[delivery.sourceType] ?? delivery.sourceType}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`${formatTimestamp(delivery.scheduledAt)} · ${delivery.attemptCount} attempts${reason === null ? "" : ` · ${reason}`}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectDelivery(delivery)}
                    className="rounded-md border border-input px-3 py-1 text-sm text-foreground hover:bg-accent"
                  >
                    {selected ? "Selected" : "Details"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface DeliveryDetailPanelProps {
  readonly delivery: NotificationDelivery | null;
  readonly isLoading: boolean;
  /**
   * A denial is its own state, not a failure to retry ([[TD-047]], review R3-002).
   *
   * Until this existed the detail read fell through to its EMPTY state when it was
   * refused, telling the reader "select a delivery to see its detail" about a delivery
   * they had just selected. Benign while both reads carry the same permission, and a
   * lie the moment they diverge.
   */
  readonly permissionDenied: boolean;
  readonly errorMessage: string | null;
}

/** One delivery's detail: references and counts, never a datum or a message body. */
export function NotificationDeliveryDetailPanel({
  delivery,
  isLoading,
  permissionDenied,
  errorMessage,
}: DeliveryDetailPanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery detail</CardTitle>
        <CardDescription>What the platform recorded about this delivery.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p data-testid="notification-detail-loading" className="text-sm text-muted-foreground">
            Loading delivery...
          </p>
        ) : permissionDenied ? (
          <p
            data-testid="notification-detail-permission-denied"
            className="text-sm text-muted-foreground"
          >
            You do not have permission to read this delivery.
          </p>
        ) : errorMessage !== null ? (
          <p data-testid="notification-detail-error" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : delivery === null ? (
          <p data-testid="notification-detail-empty" className="text-sm text-muted-foreground">
            Select a delivery to see its detail.
          </p>
        ) : (
          <dl data-testid="notification-detail" className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-foreground">
                {NOTIFICATION_STATUS_LABELS[delivery.status as NotificationDeliveryStatus] ??
                  delivery.status}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Channel</dt>
              <dd className="text-foreground">
                {NOTIFICATION_CHANNEL_LABELS[delivery.channel] ?? delivery.channel}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="text-foreground">{`${NOTIFICATION_SOURCE_LABELS[delivery.sourceType] ?? delivery.sourceType} #${shortId(delivery.sourceId)}`}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Recipient</dt>
              <dd className="text-foreground">{`Customer #${shortId(delivery.recipientId)}`}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Scheduled</dt>
              <dd className="text-foreground">{formatTimestamp(delivery.scheduledAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Attempts</dt>
              <dd className="text-foreground">
                {`${delivery.attemptCount}${delivery.lastAttemptAt === null ? "" : ` · last ${formatTimestamp(delivery.lastAttemptAt)}`}`}
              </dd>
            </div>
            {delivery.sentAt === null ? null : (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Sent</dt>
                <dd className="text-foreground">{formatTimestamp(delivery.sentAt)}</dd>
              </div>
            )}
            {delivery.cancelledAt === null ? null : (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd className="text-foreground">
                  {`${formatTimestamp(delivery.cancelledAt)}${delivery.cancellationReason === null ? "" : ` · ${delivery.cancellationReason}`}`}
                </dd>
              </div>
            )}
            {deliveryFailureReason(delivery) === null ? null : (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="text-foreground">{deliveryFailureReason(delivery)}</dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
