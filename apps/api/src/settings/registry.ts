import { z } from "zod";
import { PERMISSION_SEEDS, FEATURE_CODE_SEEDS } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";

/** The settings namespaces currently supported by the API. */
export type SettingsNamespace = "sales" | "scheduling";

export interface SalesSettings extends Record<string, unknown> {
  readonly defaultCurrency: string;
  readonly requireCustomerForInvoice: boolean;
}

/** One local wall-clock availability window for a (professional, branch) pair. */
export interface SchedulingAvailabilityWindow extends Record<string, unknown> {
  readonly membershipId: string;
  readonly branchId: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** One non-recurring block covering an absolute UTC range for a professional. */
export interface SchedulingBlock extends Record<string, unknown> {
  readonly membershipId: string;
  readonly branchId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface SchedulingSettings extends Record<string, unknown> {
  readonly conflictPolicy: "REJECT" | "ALLOW";
  readonly availability: SchedulingAvailabilityWindow[];
  readonly blocks: SchedulingBlock[];
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

/**
 * A single local wall-clock availability window. `weekday` is 0 (Sunday) to 6
 * (Saturday) and minutes are minutes past local midnight in the tenant timezone,
 * so DST conversion happens at read time rather than being frozen into storage.
 * `endMinute` MUST be strictly after `startMinute`: both bounds individually pass
 * their numeric range, so the ordering is enforced as a cross-field rule.
 */
export const schedulingAvailabilityWindowSchema = z
  .object({
    membershipId: z.string().uuid(),
    branchId: z.string().uuid(),
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .superRefine((window, ctx) => {
    if (window.endMinute <= window.startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endMinute"],
        message: "endMinute must be greater than startMinute.",
      });
    }
  });

/**
 * A non-recurring block over an absolute UTC range for one professional.
 * `endsAt` MUST be strictly after `startsAt`: both are valid ISO datetimes on
 * their own, so the ordering is enforced as a cross-field rule.
 */
export const schedulingBlockSchema = z
  .object({
    membershipId: z.string().uuid(),
    branchId: z.string().uuid(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .strict()
  .superRefine((block, ctx) => {
    if (Date.parse(block.endsAt) <= Date.parse(block.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "endsAt must be after startsAt.",
      });
    }
  });

export const schedulingSettingsSchema = z
  .object({
    conflictPolicy: z.enum(["REJECT", "ALLOW"]),
    availability: z.array(schedulingAvailabilityWindowSchema),
    blocks: z.array(schedulingBlockSchema),
  })
  .strict();

/**
 * The `scheduling` namespace consumed by the Scheduling capability. It has no
 * `requiresFeature`: the twelve MVP feature codes contain no `scheduling` code,
 * so writes are gated only by `scheduling.settings.manage` (OWNER/ADMIN).
 */
export const schedulingSettingsDefinition: SettingsDefinition<SchedulingSettings> = {
  namespace: "scheduling",
  version: 1,
  schema: schedulingSettingsSchema,
  defaults: {
    conflictPolicy: "REJECT",
    availability: [],
    blocks: [],
  },
  requiredPermissionKey: "scheduling.settings.manage",
};


/** The v1 namespaces; future namespaces must be added explicitly here. */
export const SETTINGS_REGISTRY: Record<SettingsNamespace, SettingsDefinition> = Object.freeze({
  sales: salesSettingsDefinition,
  scheduling: schedulingSettingsDefinition,
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
