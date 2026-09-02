import { z } from "zod";

/**
 * Current contract version of the customer address DTO. Bumped when the
 * accepted key set or value formats change.
 */
export const ADDRESS_DTO_SCHEMA_VERSION = 1;

/**
 * Create payload for a CustomerAddress.
 * Strict: unknown keys are rejected at the API boundary.
 */
export const createCustomerAddressBody = z
  .object({
    label: z.string().min(1).max(100).optional(),
    line1: z.string().min(1).max(200),
    line2: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(100).optional(),
    state: z.string().min(1).max(100).optional(),
    postalCode: z.string().min(1).max(20).optional(),
    countryCode: z.string().length(2).optional(),
  })
  .strict();

export type CreateCustomerAddressInput = z.infer<typeof createCustomerAddressBody>;

/**
 * Update payload for a CustomerAddress. All fields are optional; absent fields
 * are left unchanged.
 */
export const updateCustomerAddressBody = z
  .object({
    label: z.string().min(1).max(100).optional(),
    line1: z.string().min(1).max(200).optional(),
    line2: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(100).optional(),
    state: z.string().min(1).max(100).optional(),
    postalCode: z.string().min(1).max(20).optional(),
    countryCode: z.string().length(2).optional(),
  })
  .strict();

export type UpdateCustomerAddressInput = z.infer<typeof updateCustomerAddressBody>;

export const customerAddressParentParam = z.object({
  customerId: z.string().uuid(),
});

export const customerAddressIdParam = z.object({
  customerId: z.string().uuid(),
  id: z.string().uuid(),
});
