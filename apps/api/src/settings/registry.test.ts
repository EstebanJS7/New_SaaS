import { describe, expect, it } from "vitest";
import { DomainError } from "@newsaas/shared";
import { FEATURE_CODE_SEEDS, PERMISSION_SEEDS } from "@newsaas/database";
import { getSettingsDefinition, salesSettingsDefinition, SETTINGS_REGISTRY } from "./registry.js";

describe("Settings registry", () => {
  it("registers exactly the v1 sales namespace", () => {
    expect(Object.keys(SETTINGS_REGISTRY)).toEqual(["sales"]);
    expect(salesSettingsDefinition.namespace).toBe("sales");
    expect(salesSettingsDefinition.version).toBe(1);
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
});
