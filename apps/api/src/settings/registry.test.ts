import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { FEATURE_CODE_SEEDS, PERMISSION_SEEDS } from "@newsaas/database";
import {
  getSettingsDefinition,
  portalSettingsDefinition,
  salesSettingsDefinition,
  schedulingAvailabilityWindowSchema,
  schedulingBlockSchema,
  schedulingSettingsDefinition,
  SETTINGS_REGISTRY,
} from "./registry.js";

const MEMBERSHIP_ID = "11111111-1111-1111-1111-111111111111";
const BRANCH_ID = "22222222-2222-2222-2222-222222222222";

describe("Settings registry", () => {
  it("registers exactly the v1 sales, scheduling and portal namespaces", () => {
    expect(Object.keys(SETTINGS_REGISTRY)).toEqual(["sales", "scheduling", "portal"]);
    expect(salesSettingsDefinition.namespace).toBe("sales");
    expect(salesSettingsDefinition.version).toBe(1);
    expect(schedulingSettingsDefinition.namespace).toBe("scheduling");
    expect(schedulingSettingsDefinition.version).toBe(1);
    expect(portalSettingsDefinition.namespace).toBe("portal");
    expect(portalSettingsDefinition.version).toBe(1);
  });

  it("requires every registered permission key to exist in PERMISSION_SEEDS", () => {
    const seededKeys = new Set<string>(PERMISSION_SEEDS.map((entry) => entry.key));
    for (const definition of Object.values(SETTINGS_REGISTRY)) {
      expect(seededKeys.has(definition.requiredPermissionKey)).toBe(true);
    }
  });

  it("requires every registered feature code to exist in FEATURE_CODE_SEEDS", () => {
    const seededFeatures = new Set<string>(FEATURE_CODE_SEEDS);
    for (const definition of Object.values(SETTINGS_REGISTRY)) {
      if (definition.requiresFeature !== undefined) {
        expect(seededFeatures.has(definition.requiresFeature)).toBe(true);
      }
    }
  });

  it("rejects unknown namespaces with NOT_FOUND", () => {
    expect(() => getSettingsDefinition("nope")).toThrow(DomainError);
    expect(() => getSettingsDefinition("nope")).toThrow("Unknown settings namespace");
    try {
      getSettingsDefinition("nope");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("NOT_FOUND");
    }
  });

  it("sales defaults match the architecture spec", () => {
    expect(salesSettingsDefinition.defaults).toEqual({
      defaultCurrency: "PYG",
      requireCustomerForInvoice: false,
    });
  });

  it("sales schema accepts valid data and rejects secrets / unknown fields", () => {
    const valid = { defaultCurrency: "USD", requireCustomerForInvoice: true };
    expect(salesSettingsDefinition.schema.safeParse(valid).success).toBe(true);

    const secretPayload = { defaultCurrency: "PYG", apiKey: "super-secret" };
    expect(salesSettingsDefinition.schema.safeParse(secretPayload).success).toBe(false);

    const badCurrency = { defaultCurrency: "pyg", requireCustomerForInvoice: false };
    expect(salesSettingsDefinition.schema.safeParse(badCurrency).success).toBe(false);

    const wrongType = { defaultCurrency: "PYG", requireCustomerForInvoice: "false" };
    expect(salesSettingsDefinition.schema.safeParse(wrongType).success).toBe(false);
  });

  it("portal defaults to requiring staff approval (PRD §14)", () => {
    expect(portalSettingsDefinition.defaults).toEqual({ bookingRequiresApproval: true });
  });

  it("portal is gated by the portal feature and its own settings key", () => {
    expect(portalSettingsDefinition.requiresFeature).toBe("portal");
    expect(portalSettingsDefinition.requiredPermissionKey).toBe("portal.settings.manage");
  });

  it("portal schema is a closed boolean and rejects invalid / unknown values", () => {
    expect(
      portalSettingsDefinition.schema.safeParse({ bookingRequiresApproval: false }).success
    ).toBe(true);

    const wrongType = { bookingRequiresApproval: "true" };
    expect(portalSettingsDefinition.schema.safeParse(wrongType).success).toBe(false);

    const unknownField = { bookingRequiresApproval: true, apiKey: "x" };
    expect(portalSettingsDefinition.schema.safeParse(unknownField).success).toBe(false);
  });

  it("scheduling defaults match the EPIC-07 spec", () => {
    expect(schedulingSettingsDefinition.defaults).toEqual({
      conflictPolicy: "REJECT",
      availability: [],
      blocks: [],
    });
  });

  it("scheduling has no feature gate and is governed by its own settings key", () => {
    expect(schedulingSettingsDefinition.requiresFeature).toBeUndefined();
    expect(schedulingSettingsDefinition.requiredPermissionKey).toBe("scheduling.settings.manage");
  });

  it("scheduling schema accepts valid data and rejects invalid values / unknown fields", () => {
    const valid = {
      conflictPolicy: "ALLOW",
      availability: [
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          weekday: 1,
          startMinute: 540,
          endMinute: 720,
        },
      ],
      blocks: [
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          startsAt: "2026-01-16T13:00:00.000Z",
          endsAt: "2026-01-16T14:00:00.000Z",
        },
      ],
    };
    expect(schedulingSettingsDefinition.schema.safeParse(valid).success).toBe(true);

    const badPolicy = { conflictPolicy: "WARN", availability: [], blocks: [] };
    expect(schedulingSettingsDefinition.schema.safeParse(badPolicy).success).toBe(false);

    const unknownField = { conflictPolicy: "REJECT", availability: [], blocks: [], apiKey: "x" };
    expect(schedulingSettingsDefinition.schema.safeParse(unknownField).success).toBe(false);

    const badWindow = {
      conflictPolicy: "REJECT",
      availability: [
        {
          membershipId: "not-a-uuid",
          branchId: BRANCH_ID,
          weekday: 1,
          startMinute: 0,
          endMinute: 60,
        },
      ],
      blocks: [],
    };
    expect(schedulingSettingsDefinition.schema.safeParse(badWindow).success).toBe(false);
  });

  it("rejects an availability window whose end is not strictly after its start", () => {
    const base = { membershipId: MEMBERSHIP_ID, branchId: BRANCH_ID, weekday: 1 };

    // Each bound is inside its own numeric range; only the cross-field ordering
    // rule can reject these.
    const equalEdges = { ...base, startMinute: 600, endMinute: 600 };
    const inverted = { ...base, startMinute: 720, endMinute: 540 };
    const valid = { ...base, startMinute: 540, endMinute: 720 };

    expect(schedulingAvailabilityWindowSchema.safeParse(equalEdges).success).toBe(false);
    expect(schedulingAvailabilityWindowSchema.safeParse(inverted).success).toBe(false);
    expect(schedulingAvailabilityWindowSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a one-off block whose end is not strictly after its start", () => {
    const base = { membershipId: MEMBERSHIP_ID, branchId: BRANCH_ID };

    // Both datetimes are individually valid ISO strings; only the cross-field
    // ordering rule can reject these.
    const equalEdges = {
      ...base,
      startsAt: "2026-01-16T13:00:00.000Z",
      endsAt: "2026-01-16T13:00:00.000Z",
    };
    const inverted = {
      ...base,
      startsAt: "2026-01-16T14:00:00.000Z",
      endsAt: "2026-01-16T13:00:00.000Z",
    };
    const valid = {
      ...base,
      startsAt: "2026-01-16T13:00:00.000Z",
      endsAt: "2026-01-16T14:00:00.000Z",
    };

    expect(schedulingBlockSchema.safeParse(equalEdges).success).toBe(false);
    expect(schedulingBlockSchema.safeParse(inverted).success).toBe(false);
    expect(schedulingBlockSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects inverted ranges nested inside a full scheduling settings patch", () => {
    const invertedAvailability = {
      conflictPolicy: "REJECT",
      availability: [
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          weekday: 3,
          startMinute: 720,
          endMinute: 540,
        },
      ],
      blocks: [],
    };
    expect(schedulingSettingsDefinition.schema.safeParse(invertedAvailability).success).toBe(false);

    const invertedBlock = {
      conflictPolicy: "REJECT",
      availability: [],
      blocks: [
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          startsAt: "2026-01-16T14:00:00.000Z",
          endsAt: "2026-01-16T13:00:00.000Z",
        },
      ],
    };
    expect(schedulingSettingsDefinition.schema.safeParse(invertedBlock).success).toBe(false);
  });
});
