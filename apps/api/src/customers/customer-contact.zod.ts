import { customerContactKind } from "@newsaas/customers";
import { z } from "zod";

/**
 * Deliberate re-export shim ([[DEC-073]], [[IMP-002]]).
 *
 * The CustomerContact CREATE contract now lives in `@newsaas/customers`, so the
 * import worker can validate a row's phone/e-mail with the SAME rule the
 * `POST /customers/:customerId/contacts` endpoint enforces. Everything this
 * module used to own of the create path is forwarded unchanged, which keeps the
 * change a MOVE: the rule has one home, the API's import graph does not churn,
 * and the existing customer suite keeps importing from the path it always used
 * with no assertion touched.
 *
 * What did NOT move: the UPDATE payload and the route params below. The import
 * never updates a contact ([[DEC-069]] is create-only), so exporting them from a
 * package the worker consumes would widen a contract nobody outside the HTTP
 * surface needs.
 *
 * Collapsing this shim — repointing every importer at `@newsaas/customers` and
 * deleting these re-exports — is a separate cleanup, deliberately not part of a
 * move that must change no behaviour.
 */
export {
  CONTACT_DTO_SCHEMA_VERSION,
  createCustomerContactBody,
  customerContactKind,
} from "@newsaas/customers";
export type { CreateCustomerContactInput, CustomerContactKind } from "@newsaas/customers";

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
