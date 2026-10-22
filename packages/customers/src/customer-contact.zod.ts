import { z } from "zod";

/**
 * Current contract version of the CustomerContact DTO. Bumped when the accepted
 * key set or value formats change.
 */
export const CONTACT_DTO_SCHEMA_VERSION = 1;

export const customerContactKind = z.enum(["EMAIL", "PHONE"]);
export type CustomerContactKind = z.infer<typeof customerContactKind>;

/**
 * Create payload for a CustomerContact. Strict: unknown keys are rejected at the
 * boundary.
 *
 * WHY THE CREATE HALF LIVES HERE: [[DEC-073]] moved the create contracts into
 * packages so the import worker — which cannot import from `apps/api` — can
 * validate with the SAME rules the API enforces, and [[IMP-002]] forbids a
 * second copy of any validation rule ([[DEC-073]]: one rule, one home). A CSV
 * row's `phone`/`email` column is exactly such a caller.
 *
 * WHAT DID NOT MOVE: the update payload and the route params stay in
 * `apps/api/src/customers/customer-contact.zod.ts`, because only the HTTP surface
 * needs them; that module re-exports everything here so its own importers keep
 * resolving the contract where they always did.
 *
 * SHAPE RULE — LENGTH ONLY, deliberately: `value` is free text bounded 1..255.
 * There is no e-mail regex and no phone pattern in this contract, and none
 * exists anywhere else in the repository (see
 * `apps/api/src/suppliers/suppliers.zod.ts`, which states the same rule and the
 * same reasoning for the supplier contact columns). An importer must NOT add
 * one: a format rule invented at the import boundary would refuse values the
 * endpoint accepts, and the import would stop being a caller of this contract.
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
