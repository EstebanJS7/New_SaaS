/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  REMINDER_CHANNELS,
  REMINDER_LEAD_HOURS_MAX,
  REMINDER_LEAD_HOURS_MIN,
  changedFields,
  normalizeChannels,
  visibleSections,
} from "./general-settings-rules";

/**
 * The web cannot import `@newsaas/notifications` (it carries BullMQ and the
 * mailer), so the reminder bounds are mirrored. This reads the package SOURCE so
 * a change there fails here instead of letting the form accept what the API
 * refuses, or refuse what it accepts.
 */
const POLICY_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../../../../packages/notifications/src/reminder.policy.ts",
      import.meta.url
    )
  ),
  "utf8"
);

function exported(name: string): string {
  const match = new RegExp(`export const ${name} = ([^;]+);`).exec(POLICY_SOURCE);
  if (!match?.[1]) throw new Error(`${name} not found in reminder.policy.ts`);
  return match[1];
}

describe("general settings rules (CFG-001)", () => {
  it("mirrors the reminder lead-hour bounds of @newsaas/notifications", () => {
    expect(String(REMINDER_LEAD_HOURS_MIN)).toBe(exported("NOTIFICATION_REMINDER_LEAD_HOURS_MIN"));
    expect(String(REMINDER_LEAD_HOURS_MAX)).toBe(exported("NOTIFICATION_REMINDER_LEAD_HOURS_MAX"));
  });

  it("mirrors the reminder channels of @newsaas/notifications in order", () => {
    expect(exported("NOTIFICATION_REMINDER_CHANNELS")).toBe(
      `Object.freeze(${JSON.stringify(REMINDER_CHANNELS).replace(/,/g, ", ")} as const)`
    );
  });

  it("normalizes channels to unique values in the API's order", () => {
    expect(normalizeChannels(["WHATSAPP", "EMAIL", "WHATSAPP"])).toEqual(["EMAIL", "WHATSAPP"]);
    expect(normalizeChannels(["SMS", "EMAIL"])).toEqual(["EMAIL"]);
  });

  it("reports only the keys whose value changed", () => {
    expect(
      changedFields({ a: 1, b: ["EMAIL"], c: true }, { a: 1, b: ["EMAIL", "WHATSAPP"], c: true })
    ).toEqual({ b: ["EMAIL", "WHATSAPP"] });
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual({});
  });

  it("offers every section when permissions and entitlements are unknown", () => {
    expect(visibleSections(undefined, undefined)).toEqual([
      "sales",
      "portal",
      "notifications",
      "scheduling",
    ]);
  });

  it("requires the permission, and the feature only for sales and portal", () => {
    expect(
      visibleSections(
        ["sales.settings.manage", "portal.settings.manage", "notifications.settings.manage"],
        ["portal"]
      )
    ).toEqual(["portal", "notifications"]);
  });
});
