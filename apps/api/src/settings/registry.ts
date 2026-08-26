import { z } from "zod";
import { PERMISSION_SEEDS, FEATURE_CODE_SEEDS } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";

/** The settings namespaces currently supported by the API. */
export type SettingsNamespace = "sales";

export interface SalesSettings extends Record<string, unknown> {
  readonly defaultCurrency: string;
  readonly requireCustomerForInvoice: boolean;
}

/**
 * Backend-owned namespace definition. The schema is deliberately a strict
 * object: settings are configuration, not an escape hatch for arbitrary JSON.
 */
export interface SettingsDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly namespace: SettingsNamespace;
  readonly version: number;
  readonly schema: z.AnyZodObject;
  readonly defaults: T;
  readonly requiresFeature?: string;
  readonly requiredPermissionKey: string;
}

export const salesSettingsSchema = z
  .object({
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
    requireCustomerForInvoice: z.boolean(),
  })
  .strict();

export const salesSettingsDefinition: SettingsDefinition<SalesSettings> = {
  namespace: "sales",
  version: 1,
  schema: salesSettingsSchema,
  defaults: {
    defaultCurrency: "PYG",
    requireCustomerForInvoice: false,
  },
  requiresFeature: "sales",
  requiredPermissionKey: "sales.settings.manage",
};

/** The single v1 namespace; future namespaces must be added explicitly here. */
export const SETTINGS_REGISTRY: Record<SettingsNamespace, SettingsDefinition> = Object.freeze({
  sales: salesSettingsDefinition,
});

/** Alias named after the conceptual registry collection. */
export const SETTINGS_DEFINITIONS = SETTINGS_REGISTRY;

/**
 * Ensures registry additions remain synchronized with the seed-owned catalogs.
 * This is also a runtime guard against a definition that can never authorize.
 */
function assertCatalogSynchronization(definition: SettingsDefinition): void {
  if (!PERMISSION_SEEDS.some((entry) => entry.key === definition.requiredPermissionKey)) {
    throw new Error(
      `Settings registry permission is not seeded: ${definition.requiredPermissionKey}`
    );
  }
  if (
    definition.requiresFeature !== undefined &&
    !FEATURE_CODE_SEEDS.some((code) => code === definition.requiresFeature)
  ) {
    throw new Error(`Settings registry feature is not seeded: ${definition.requiresFeature}`);
  }
}

for (const definition of Object.values(SETTINGS_REGISTRY)) {
  assertCatalogSynchronization(definition);
}

/** Looks up a namespace or returns NOT_FOUND for unknown input. */
export function getSettingsDefinition(namespace: string): SettingsDefinition {
  const definition = Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, namespace)
    ? SETTINGS_REGISTRY[namespace as SettingsNamespace]
    : undefined;
  if (!definition) {
    throw new DomainError("NOT_FOUND", "Unknown settings namespace.");
  }
  return definition;
}
