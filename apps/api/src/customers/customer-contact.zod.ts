import { z } from "zod";

/**
 * Current contract version of the customer contact DTO. Bumped when the
 * accepted key set or value formats change.
 */
export const CONTACT_DTO_SCHEMA_VERSION = 1;

export const customerContactKind = z.enum(["EMAIL", "PHONE"]);
export type CustomerContactKind = z.infer<typeof customerContactKind>;

/**
 * Create payload for a CustomerContact.
 * Strict: unknown keys are rejected at the API boundary.
 */
export const createCustomerContactBody = z
  .object({
    kind: customerContactKind,
    label: z.string().min(1).max(100).optional(),
    value: z.string().min(1).max(255),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export type CreateCustomerContactInput = z.infer<typeof createCustomerContactBody>;

/**
 * Update payload for a CustomerContact. All fields are optional; absent fields
 * are left unchanged.
 */
export const updateCustomerContactBody = z
  .object({
    kind: customerContactKind.optional(),
    label: z.string().min(1).max(100).optional(),
    value: z.string().min(1).max(255).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export type UpdateCustomerContactInput = z.infer<typeof updateCustomerContactBody>;

export const customerContactParentParam = z.object({
  customerId: z.string().uuid(),
});

export const customerContactIdParam = z.object({
  customerId: z.string().uuid(),
  id: z.string().uuid(),
});
