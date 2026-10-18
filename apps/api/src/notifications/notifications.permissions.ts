/**
 * The `notifications.*` permission family (EPIC-17 NOTIF-004).
 *
 * It has a READ key and no manage key, and that is deliberate rather than
 * incomplete: this epic adds **no delivery transition from the surface** — a
 * manual re-drive is excluded by [[NOTIF-001]] and nothing else moves a delivery's
 * status — so a `delivery.manage` key would guard a command nobody can call. A
 * permission with nothing behind it is one no operator can be denied by.
 *
 * The family is therefore `notifications.delivery.read` here plus
 * `notifications.settings.manage`, which the settings registry already requires
 * ([[NOTIF-003]]).
 */
export const NOTIFICATIONS_PERMISSIONS = Object.freeze({
  deliveryRead: "notifications.delivery.read",
});
